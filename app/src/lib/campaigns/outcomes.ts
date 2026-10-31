import "server-only";
import { auditSafe } from "../audit";
import { toCallRecord, type CallRecord } from "../calls";
import { getDb, now } from "../db";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "../notify";
import { parseJson } from "@/voice/normalize";
import { FINAL_CALL_STATUSES, type CampaignContactState, type TranscriptTurn } from "@/voice/types";
import { cancelOpenRows, completeCampaign, getCampaign, isRetryable, pauseCampaign, toCampaignRecord, type CampaignRecord } from "./index";

/**
 * What happens to a campaign row when its call ends: completed, retried later (per outcome and
 * delay) or given up, plus the abandonment guard (answered calls where the agent said nothing
 * within 2 seconds count as abandoned: too many of them pause the campaign) and the completion of
 * campaigns with nothing left to dial.
 *
 * onCallEnded() is registered as a call hook of the webhook ingest (src/lib/voice/hooks.ts) and
 * the engine also polls calls of rows still "in_call", so a missed hook only delays the update.
 */

/** Answered calls needed before the abandonment rate is judged. */
export const ABANDON_MIN_ANSWERED = 10;
/** The agent must speak within this many seconds of the answer (TCPA / Ofcom silent-call rules). */
export const ABANDON_SILENCE_SEC = 2;

/** An answered call where the agent never spoke, or only after ABANDON_SILENCE_SEC. */
export function isAbandoned(call: Pick<CallRecord, "status" | "transcript">): boolean {
  if (call.status !== "completed") return false;
  const first = call.transcript.find((t) => t.role === "agent" && t.text.trim());
  return !first || first.at > ABANDON_SILENCE_SEC;
}

/** The campaign row outcome of a finished call. */
export function rowOutcome(call: Pick<CallRecord, "status" | "endReason" | "outcome">): string {
  if (call.endReason === "opt_out" || call.outcome === "opted_out") return "opt_out";
  if (call.status === "completed") return "completed";
  if (call.status === "canceled") return "failed";
  return call.status;
}

/**
 * Applies a finished call to its campaign row. Idempotent (only a row still waiting for this very
 * call changes). Returns what happened.
 */
export async function onCallEnded(input: number | CallRecord): Promise<"updated" | "ignored"> {
  const db = await getDb();
  let call: CallRecord | undefined;
  if (typeof input === "number") {
    const row = await db.selectFrom("calls").selectAll().where("id", "=", input).executeTakeFirst();
    call = row ? toCallRecord(row) : undefined;
  } else call = input;
  if (!call || !call.campaignId || !FINAL_CALL_STATUSES.includes(call.status)) return "ignored";

  // Only a row the engine marked "in_call" for this very call (a call that fails while the engine
  // is still dialing is handled by the engine itself).
  let q = db.selectFrom("campaign_contacts").selectAll().where("campaign_id", "=", call.campaignId).where("last_call_id", "=", call.id);
  if (call.campaignContactId) q = q.where("id", "=", call.campaignContactId);
  const row = await q.executeTakeFirst();
  if (!row || row.state !== "in_call") return "ignored";

  const campaign = await getCampaign(row.workspace_id, row.campaign_id);
  if (!campaign) return "ignored";
  const outcome = rowOutcome(call);
  let state: CampaignContactState;
  let next: string | null = null;
  const attempts = Math.max(row.attempts, 1);
  const open = campaign.status === "running" || campaign.status === "paused" || campaign.status === "scheduled";
  if (outcome === "completed" || outcome === "opt_out") state = "completed";
  else if (open && isRetryable(outcome) && campaign.retryOn.includes(outcome) && attempts < campaign.maxAttempts) {
    state = "retry";
    next = new Date(Date.now() + campaign.retryDelays[outcome] * 60_000).toISOString();
  } else state = campaign.status === "canceled" ? "canceled" : "failed";

  const res = await db
    .updateTable("campaign_contacts")
    .set({ state, last_outcome: outcome, last_call_id: call.id, next_attempt_at: next, lease_token: null, lease_until: null, updated_at: now() })
    .where("id", "=", row.id)
    .where("state", "=", "in_call")
    .where("last_call_id", "=", call.id)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) !== 1) return "ignored";

  if (isAbandoned(call)) await checkAbandonment(campaign);
  if (state !== "retry") await maybeCompleteCampaign(campaign.id);
  return "updated";
}

/** Abandoned share of the campaign's answered calls (last 30 days, at most the last 200). */
export async function abandonmentRate(campaignId: number): Promise<{ answered: number; abandoned: number; pct: number }> {
  const db = await getDb();
  const rows = await db
    .selectFrom("calls")
    .select(["status", "transcript"])
    .where("campaign_id", "=", campaignId)
    .where("status", "=", "completed")
    .where("created_at", ">=", new Date(Date.now() - 30 * 86_400_000).toISOString())
    .orderBy("id", "desc")
    .limit(200)
    .execute();
  let abandoned = 0;
  for (const r of rows) {
    const t = parseJson(r.transcript);
    if (isAbandoned({ status: "completed", transcript: Array.isArray(t) ? (t as TranscriptTurn[]) : [] })) abandoned += 1;
  }
  return { answered: rows.length, abandoned, pct: rows.length ? Math.round((abandoned / rows.length) * 1000) / 10 : 0 };
}

async function checkAbandonment(campaign: CampaignRecord): Promise<void> {
  if (campaign.abandonMaxPct <= 0 || campaign.status !== "running") return;
  const rate = await abandonmentRate(campaign.id);
  if (rate.answered < ABANDON_MIN_ANSWERED || rate.pct <= campaign.abandonMaxPct) return;
  const paused = await pauseCampaign(campaign.workspaceId, campaign.id, { type: "system", id: null }, "abandonment");
  if (!paused) return;
  await auditSafe({ workspaceId: campaign.workspaceId, actor: { type: "system", id: null }, action: "campaign.abandonment", entityType: "campaign", entityId: campaign.id, data: { ...rate, max: campaign.abandonMaxPct } });
  const ws = await workspaceRef(campaign.workspaceId);
  const payload = await buildNotifyPayload(
    ws,
    "campaign_finished",
    `Campaign "${campaign.name}" was paused: ${rate.pct}% of answered calls were abandoned (the agent didn't speak within ${ABANDON_SILENCE_SEC} seconds); the limit is ${campaign.abandonMaxPct}%.`,
    { campaign: campaign.name, status: "paused", reason: "abandonment", abandoned_pct: rate.pct, answered: rate.answered },
    workspaceDashboardPath(campaign.workspaceId, `campaigns/${campaign.id}`),
  );
  await notifyWorkspace(campaign.workspaceId, payload, { ownerFallback: true });
}

async function workspaceRef(workspaceId: number): Promise<{ id: number; name: string }> {
  const db = await getDb();
  const ws = await db.selectFrom("workspaces").select(["id", "name"]).where("id", "=", workspaceId).executeTakeFirst();
  return ws ?? { id: workspaceId, name: "" };
}

/** Completes a running campaign once no row is waiting, dialing or in a call; notifies. */
export async function maybeCompleteCampaign(campaignId: number): Promise<boolean> {
  const db = await getDb();
  const open = await db.selectFrom("campaign_contacts").select("id").where("campaign_id", "=", campaignId).where("state", "in", ["pending", "retry", "dialing", "in_call"]).executeTakeFirst();
  if (open) return false;
  const row = await db.selectFrom("campaigns").selectAll().where("id", "=", campaignId).executeTakeFirst();
  if (!row || row.status !== "running") return false;
  if (!(await completeCampaign(campaignId))) return false;
  const campaign = toCampaignRecord(row);
  const counts = await db
    .selectFrom("campaign_contacts")
    .select(["state", (eb) => eb.fn.countAll<number>().as("n")])
    .where("campaign_id", "=", campaignId)
    .groupBy("state")
    .execute();
  const by = Object.fromEntries(counts.map((c) => [c.state, Number(c.n)]));
  await auditSafe({ workspaceId: campaign.workspaceId, actor: { type: "system", id: null }, action: "campaign.completed", entityType: "campaign", entityId: campaignId, data: by });
  const ws = await workspaceRef(campaign.workspaceId);
  const payload = await buildNotifyPayload(
    ws,
    "campaign_finished",
    `Campaign "${campaign.name}" finished: ${by.completed ?? 0} reached, ${by.failed ?? 0} not reached, ${by.skipped ?? 0} skipped by the compliance checks.`,
    { campaign: campaign.name, status: "completed", reached: by.completed ?? 0, not_reached: by.failed ?? 0, skipped: by.skipped ?? 0 },
    workspaceDashboardPath(campaign.workspaceId, `campaigns/${campaignId}`),
  );
  await notifyWorkspace(campaign.workspaceId, payload);
  return true;
}

/** Resumes the workspace's campaigns the engine paused for lack of call credits (after a top-up). */
export async function resumeCampaignsAfterTopUp(workspaceId: number): Promise<number> {
  const db = await getDb();
  const rows = await db.selectFrom("campaigns").select(["id", "starts_at"]).where("workspace_id", "=", workspaceId).where("status", "=", "paused").where("paused_reason", "=", "no_credits").execute();
  let n = 0;
  for (const r of rows) {
    const to = r.starts_at && r.starts_at > now() ? "scheduled" : "running";
    const res = await db.updateTable("campaigns").set({ status: to, paused_reason: null, updated_at: now() }).where("id", "=", r.id).where("status", "=", "paused").executeTakeFirst();
    if (Number(res.numUpdatedRows) === 1) {
      n += 1;
      await auditSafe({ workspaceId, actor: { type: "system", id: null }, action: "campaign.resumed", entityType: "campaign", entityId: r.id, data: { reason: "credits_added" } });
    }
  }
  return n;
}

/** The engine's end-of-window housekeeping: campaigns past their end date are completed and their waiting rows canceled. */
export async function finishExpiredCampaigns(nowIso = now()): Promise<number> {
  const db = await getDb();
  const rows = await db.selectFrom("campaigns").select(["id", "workspace_id"]).where("status", "in", ["running", "scheduled", "paused"]).where("ends_at", "is not", null).where("ends_at", "<=", nowIso).limit(50).execute();
  let n = 0;
  for (const r of rows) {
    await cancelOpenRows(r.id);
    if (await completeCampaign(r.id)) {
      n += 1;
      await auditSafe({ workspaceId: r.workspace_id, actor: { type: "system", id: null }, action: "campaign.completed", entityType: "campaign", entityId: r.id, data: { reason: "end_date" } });
    }
  }
  return n;
}
