import "server-only";
import crypto from "node:crypto";
import { auditSafe } from "../audit";
import { checkCallFunds } from "../billing";
import { countLiveCalls, toCallRecord } from "../calls";
import { checkDial, getCompliance, outboundAccess } from "../compliance";
import { getContact } from "../contacts";
import { getDb, now } from "../db";
import type { CampaignContactRow } from "../db/schema";
import { dayBoundsIso, localDay, addDays } from "../jobs/shared";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "../notify";
import { dialsToday } from "../numbers";
import type { Entitlements } from "../plans";
import { getSettings } from "../settings";
import { getAgent, type AgentRecord } from "../agents";
import { startOutboundCall, type StartCallError } from "../voice/outbound";
import { getWorkspace, getWorkspaceEntitlements, ownedWorkspaceIds, type WorkspaceRecord } from "../workspaces";
import { buildCallingRules, isWithinCallingHours, nextCallingTime } from "@/voice/normalize";
import { FINAL_CALL_STATUSES, type DialBlockReason } from "@/voice/types";
import { getCampaign, mergeCampaignStats, pauseCampaign, type CampaignRecord } from "./index";
import { finishExpiredCampaigns, maybeCompleteCampaign, onCallEnded } from "./outcomes";

/**
 * The campaign dialer. One run (a scheduler tick, the fast /api/cron/campaigns endpoint, or
 * several of them at once) does, within its deadline:
 *
 *   1. housekeeping: scheduled campaigns that reached their start become running, campaigns past
 *      their end date complete, leases of crashed runs are recovered, rows whose call ended are
 *      updated (fallback for the ingest's call hook);
 *   2. for every running campaign, while there is capacity and a row is due:
 *        admit  — under a short platform-wide lock: count calls in progress plus rows being dialed
 *                 (campaign concurrency, the owner's plan cap, the platform cap), then lease ONE
 *                 due row with a conditional UPDATE (state pending/retry → dialing + token)
 *        check  — checkDial() at dial time (consent, DNC incl. global, opt-out, calling hours in
 *                 the contact's zone or the campaign's, holidays, frequency caps, country rules,
 *                 kill switches, outbound approval), the campaign's daily cap, a number of the
 *                 pool under its daily cap, call credits / included minutes
 *        dial   — startOutboundCall() (src/lib/voice/outbound.ts); the row becomes "in_call"
 *      Blocks that pass with time (calling hours, holidays, frequency caps) reschedule the row to
 *      the next allowed moment; permanent ones (DNC, no consent…) skip it, audited.
 *
 * Why no double dial: a row is dialed only by the run whose token is on it, and the token is set
 * by one conditional UPDATE; the admit lock makes the capacity count + lease atomic across runs.
 */

/** A leased row must be dialed within this time, else another run takes it back. */
export const LEASE_MS = 2 * 60_000;
const ADMIT_LOCK = "campaign_admit_lock";
const ADMIT_LOCK_TTL_MS = 5_000;
/** Rows handled per run before the engine yields (each dial costs a provider request). */
const MAX_DIALS_PER_RUN = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();

export interface EngineResult {
  dialed: number;
  rescheduled: number;
  skipped: number;
  ended: number;
  recovered: number;
}

// ── The admit lock (a settings row, like the scheduler's tick lock) ──

async function acquireAdmitLock(): Promise<string | null> {
  const db = await getDb();
  const token = crypto.randomBytes(8).toString("hex");
  for (let attempt = 0; attempt < 60; attempt++) {
    const nowIso = now();
    const value = `${iso(Date.now() + ADMIT_LOCK_TTL_MS)}#${token}`;
    const exists = await db.selectFrom("settings").select("key").where("key", "=", ADMIT_LOCK).executeTakeFirst();
    if (!exists) {
      try {
        await db.insertInto("settings").values({ key: ADMIT_LOCK, value }).execute();
        return value;
      } catch {
        // Created concurrently: try the update.
      }
    }
    const res = await db
      .updateTable("settings")
      .set({ value })
      .where("key", "=", ADMIT_LOCK)
      .where((eb) => eb.or([eb("value", "is", null), eb("value", "=", ""), eb("value", "<", nowIso)]))
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 1) return value;
    await sleep(15 + Math.floor(Math.random() * 25));
  }
  return null;
}

async function releaseAdmitLock(value: string): Promise<void> {
  const db = await getDb();
  await db.updateTable("settings").set({ value: null }).where("key", "=", ADMIT_LOCK).where("value", "=", value).execute();
}

/** Rows being dialed right now (leased, call not created yet) in the given workspaces (null = all). */
async function dialingRows(workspaceIds: number[] | null, campaignId?: number): Promise<number> {
  const db = await getDb();
  let q = db.selectFrom("campaign_contacts").select((eb) => eb.fn.countAll<number>().as("n")).where("state", "=", "dialing").where("lease_until", ">", now());
  if (campaignId) q = q.where("campaign_id", "=", campaignId);
  if (workspaceIds) {
    if (!workspaceIds.length) return 0;
    q = q.where("workspace_id", "in", workspaceIds);
  }
  return Number((await q.executeTakeFirst())?.n ?? 0);
}

interface Context {
  campaign: CampaignRecord;
  workspace: WorkspaceRecord;
  entitlements: Entitlements;
  agent: AgentRecord;
  ownerWorkspaces: number[];
  platformCap: number;
  /** Why the campaign is waiting after this run (shown on its page), null = not waiting. */
  waiting: string | null;
}

type Admit = { row: CampaignContactRow; token: string } | { stop: "capacity" | "nothing_due" | "lock" };

/** Capacity check + lease of one due row, atomically across concurrent runs. */
async function admitOne(ctx: Context): Promise<Admit> {
  const lock = await acquireAdmitLock();
  if (!lock) return { stop: "lock" };
  try {
    const db = await getDb();
    const nowIso = now();
    const inflight = Number(
      (
        await db
          .selectFrom("campaign_contacts")
          .select((eb) => eb.fn.countAll<number>().as("n"))
          .where("campaign_id", "=", ctx.campaign.id)
          .where((eb) => eb.or([eb("state", "=", "in_call"), eb.and([eb("state", "=", "dialing"), eb("lease_until", ">", nowIso)])]))
          .executeTakeFirst()
      )?.n ?? 0,
    );
    if (inflight >= ctx.campaign.concurrency) return { stop: "capacity" };
    const planCap = ctx.entitlements.maxConcurrentCalls;
    if (planCap >= 0 && (await countLiveCalls(ctx.ownerWorkspaces)) + (await dialingRows(ctx.ownerWorkspaces)) >= planCap) return { stop: "capacity" };
    if (ctx.platformCap > 0 && (await countLiveCalls(null)) + (await dialingRows(null)) >= ctx.platformCap) return { stop: "capacity" };

    const candidates = await db
      .selectFrom("campaign_contacts")
      .select("id")
      .where("campaign_id", "=", ctx.campaign.id)
      .where("state", "in", ["pending", "retry"])
      .where((eb) => eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", nowIso)]))
      .orderBy("next_attempt_at")
      .orderBy("id")
      .limit(5)
      .execute();
    const token = crypto.randomBytes(12).toString("hex");
    for (const c of candidates) {
      const res = await db
        .updateTable("campaign_contacts")
        .set({ state: "dialing", lease_token: token, lease_until: iso(Date.now() + LEASE_MS), updated_at: now() })
        .where("id", "=", c.id)
        .where("state", "in", ["pending", "retry"])
        .where((eb) => eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", nowIso)]))
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 1) {
        const row = await db.selectFrom("campaign_contacts").selectAll().where("id", "=", c.id).executeTakeFirstOrThrow();
        return { row, token };
      }
    }
    return { stop: "nothing_due" };
  } finally {
    await releaseAdmitLock(lock);
  }
}

/** Gives a leased row back without counting an attempt (optionally later). */
async function releaseRow(row: CampaignContactRow, token: string, nextAt?: string | null): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("campaign_contacts")
    .set({ state: row.attempts > 0 ? "retry" : "pending", lease_token: null, lease_until: null, next_attempt_at: nextAt === undefined ? row.next_attempt_at : nextAt, updated_at: now() })
    .where("id", "=", row.id)
    .where("state", "=", "dialing")
    .where("lease_token", "=", token)
    .execute();
}

async function finishRow(row: CampaignContactRow, token: string, patch: { state: "skipped" | "failed" | "retry"; outcome: string; skipReason?: string | null; nextAt?: string | null; attempts?: number; callId?: number | null }): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("campaign_contacts")
    .set({
      state: patch.state,
      last_outcome: patch.outcome.slice(0, 20),
      skip_reason: patch.skipReason ? patch.skipReason.slice(0, 255) : null,
      next_attempt_at: patch.nextAt ?? null,
      attempts: patch.attempts ?? row.attempts,
      ...(patch.callId ? { last_call_id: patch.callId } : {}),
      lease_token: null,
      lease_until: null,
      updated_at: now(),
    })
    .where("id", "=", row.id)
    .where("state", "=", "dialing")
    .where("lease_token", "=", token)
    .execute();
}

/** Start of the next local day in a zone. */
function nextLocalMidnight(tz: string, nowMs = Date.now()): string {
  return dayBoundsIso(addDays(localDay(nowMs, tz), 1), tz).start;
}

const TIME_REASONS: readonly DialBlockReason[] = ["outside_hours", "holiday", "frequency_24h", "frequency_30d"];

/** Pauses the campaign with a reason and tells the workspace (low-balance alerts themselves come from the call ingest). */
async function autoPause(ctx: Context, reason: string, message: string): Promise<void> {
  if (!(await pauseCampaign(ctx.workspace.id, ctx.campaign.id, { type: "system", id: null }, reason.slice(0, 30)))) return;
  const payload = await buildNotifyPayload(ctx.workspace, "campaign_finished", message, { campaign: ctx.campaign.name, status: "paused", reason }, workspaceDashboardPath(ctx.workspace.id, `campaigns/${ctx.campaign.id}`));
  await notifyWorkspace(ctx.workspace.id, payload, { ownerFallback: true });
}

type RowResult = "next" | "stop";

/** Checks and dials one leased row. */
async function processRow(ctx: Context, row: CampaignContactRow, token: string, result: EngineResult): Promise<RowResult> {
  const { campaign, workspace, entitlements, agent } = ctx;
  const contact = await getContact(workspace.id, row.contact_id);
  if (!contact) {
    await finishRow(row, token, { state: "skipped", outcome: "blocked", skipReason: "contact_deleted" });
    result.skipped += 1;
    return "next";
  }
  const nowMs = Date.now();
  const check = await checkDial({
    workspace,
    entitlements,
    phone: contact.phone,
    contact: { id: contact.id, timezone: contact.timezone, country: contact.country, state: contact.state, optedOut: Boolean(contact.optedOutAt) },
    campaign: { id: campaign.id, status: "running", purpose: campaign.purpose, window: campaign.timezoneMode === "contact" ? campaign.window : null },
    now: nowMs,
  });
  const reasons = [...check.reasons];
  let retryAt = check.retryAt ? Date.parse(check.retryAt) : null;
  if (campaign.timezoneMode === "campaign") {
    // The campaign's window in the campaign's own zone, on top of the contact's calling hours.
    const rules = buildCallingRules(campaign.window);
    if (!isWithinCallingHours(campaign.timezone, rules, nowMs)) {
      if (!reasons.includes("outside_hours")) reasons.push("outside_hours");
      const next = nextCallingTime(campaign.timezone, rules, nowMs);
      if (next !== null) retryAt = Math.max(retryAt ?? 0, next);
    }
  }
  if (reasons.length) {
    if (reasons.includes("outbound_disabled") || reasons.includes("campaign_inactive")) {
      await releaseRow(row, token);
      return "stop";
    }
    if (reasons.every((r) => TIME_REASONS.includes(r))) {
      let next = retryAt ?? nowMs + 3600_000;
      if (reasons.includes("frequency_30d")) next = Math.max(next, nowMs + 86_400_000);
      else if (reasons.includes("frequency_24h")) next = Math.max(next, nowMs + 3600_000);
      await releaseRow(row, token, iso(next));
      result.rescheduled += 1;
      return "next";
    }
    const permanent = reasons.filter((r) => !TIME_REASONS.includes(r));
    await finishRow(row, token, { state: "skipped", outcome: "blocked", skipReason: permanent.join(",") });
    await auditSafe({ workspaceId: workspace.id, actor: { type: "system", id: null }, action: "call.blocked", entityType: "phone", entityId: contact.phone, data: { reasons: permanent, campaignId: campaign.id, contactId: contact.id } });
    result.skipped += 1;
    return "next";
  }

  // The campaign's own daily cap (local day of the workspace).
  const db = await getDb();
  if (campaign.dailyCap > 0) {
    const { start } = dayBoundsIso(localDay(nowMs, workspace.timezone), workspace.timezone);
    const today = Number((await db.selectFrom("calls").select((eb) => eb.fn.countAll<number>().as("n")).where("campaign_id", "=", campaign.id).where("created_at", ">=", start).executeTakeFirst())?.n ?? 0);
    if (today >= campaign.dailyCap) {
      await releaseRow(row, token, nextLocalMidnight(workspace.timezone, nowMs));
      ctx.waiting = "daily_cap";
      return "stop";
    }
  }

  // A caller id of the pool under its daily cap.
  const numbers = await db.selectFrom("phone_numbers").selectAll().where("workspace_id", "=", workspace.id).where("id", "in", campaign.numberIds).execute();
  const usable = campaign.numberIds.map((id) => numbers.find((n) => n.id === id)).filter((n) => n && n.status === "active" && n.outbound_enabled === 1 && n.provider === agent.provider);
  if (!usable.length) {
    await releaseRow(row, token);
    await autoPause(ctx, "number", `Campaign "${campaign.name}" was paused: none of its phone numbers can place outbound calls for this agent (active, outbound on, same provider).`);
    return "stop";
  }
  let numberId: number | null = null;
  for (const n of usable) {
    if ((await dialsToday(n!.id, workspace.timezone, nowMs)) < Number(n!.daily_dial_cap)) {
      numberId = n!.id;
      break;
    }
  }
  if (!numberId) {
    await releaseRow(row, token, nextLocalMidnight(workspace.timezone, nowMs));
    ctx.waiting = "number_cap";
    return "stop";
  }

  const funds = await checkCallFunds({ workspaceId: workspace.id, ownerId: workspace.ownerId, entitlements, provider: agent.provider, maxDurationSec: agent.settings.maxDurationSec });
  if (!funds.ok) {
    await releaseRow(row, token);
    await autoPause(ctx, "no_credits", `Campaign "${campaign.name}" was paused: the call credits ran out. Add credits and it resumes by itself.`);
    return "stop";
  }

  const variables: Record<string, string> = { ...campaign.variables, campaign_name: campaign.name };
  // Demo and tests: a contact field forces the simulated provider's outcome.
  if (agent.provider === "simulated" && contact.fields.sim_scenario) variables.sim_scenario = contact.fields.sim_scenario;
  const res = await startOutboundCall({
    workspace,
    entitlements,
    agentId: agent.id,
    numberId,
    to: contact.phone,
    contactId: contact.id,
    campaignId: campaign.id,
    campaignContactId: row.id,
    variables,
    purpose: campaign.purpose,
    campaign: { id: campaign.id, status: "running", purpose: campaign.purpose, window: campaign.timezoneMode === "contact" ? campaign.window : null },
    complianceChecked: true,
    actor: { type: "system", id: null },
  });

  if (res.ok) {
    const ts = now();
    const upd = await db
      .updateTable("campaign_contacts")
      .set({ state: "in_call", last_call_id: res.callId, attempts: row.attempts + 1, lease_token: null, lease_until: null, next_attempt_at: null, updated_at: ts })
      .where("id", "=", row.id)
      .where("state", "=", "dialing")
      .where("lease_token", "=", token)
      .executeTakeFirst();
    await db.updateTable("contacts").set({ last_called_at: ts, calls_count: contact.callsCount + 1, updated_at: ts }).where("id", "=", contact.id).execute();
    result.dialed += 1;
    if (Number(upd.numUpdatedRows) === 1) {
      // The call may already be over (fast failure): apply it now.
      const call = await db.selectFrom("calls").selectAll().where("id", "=", res.callId).executeTakeFirst();
      if (call && (FINAL_CALL_STATUSES as readonly string[]).includes(call.status)) await onCallEnded(toCallRecord(call));
    }
    return "next";
  }

  const error: StartCallError = res.error;
  switch (error) {
    case "concurrency":
    case "number_daily_cap":
      await releaseRow(row, token);
      ctx.waiting = error === "concurrency" ? "concurrency" : "number_cap";
      return "stop";
    case "insufficient_credits":
      await releaseRow(row, token);
      await autoPause(ctx, "no_credits", `Campaign "${campaign.name}" was paused: the call credits ran out. Add credits and it resumes by itself.`);
      return "stop";
    case "blocked": {
      const permanent = (res.reasons ?? []).filter((r) => !TIME_REASONS.includes(r));
      if (!permanent.length) {
        await releaseRow(row, token, res.retryAt ?? iso(nowMs + 3600_000));
        result.rescheduled += 1;
        return "next";
      }
      await finishRow(row, token, { state: "skipped", outcome: "blocked", skipReason: permanent.join(",") });
      result.skipped += 1;
      return "next";
    }
    case "provider_error": {
      // A dial attempt that failed at the provider: retried like a failed call.
      const attempts = row.attempts + 1;
      const retry = campaign.retryOn.includes("failed") && attempts < campaign.maxAttempts;
      await finishRow(row, token, { state: retry ? "retry" : "failed", outcome: "failed", attempts, callId: res.callId ?? null, nextAt: retry ? iso(nowMs + campaign.retryDelays.failed * 60_000) : null });
      await mergeCampaignStats(campaign.id, { lastError: res.message.slice(0, 200), checkedAt: now() });
      return "next";
    }
    default:
      // agent_not_found, agent_not_synced, number_*, provider_mismatch, provider_unavailable: a setup problem.
      await releaseRow(row, token);
      await autoPause(ctx, error, `Campaign "${campaign.name}" was paused: ${res.message}`);
      return "stop";
  }
}

// ── Housekeeping ──

/** Rows whose lease expired (a run crashed mid-dial): back in the queue, or "in_call" when the call was placed. */
async function recoverLeases(): Promise<number> {
  const db = await getDb();
  const rows = await db.selectFrom("campaign_contacts").selectAll().where("state", "=", "dialing").where("lease_until", "<", now()).limit(200).execute();
  let n = 0;
  for (const row of rows) {
    const claimedAt = iso(Date.parse(row.lease_until ?? now()) - LEASE_MS - 1000);
    const call = await db.selectFrom("calls").select(["id"]).where("campaign_contact_id", "=", row.id).where("created_at", ">=", claimedAt).orderBy("id", "desc").executeTakeFirst();
    const res = await db
      .updateTable("campaign_contacts")
      .set(
        call
          ? { state: "in_call", last_call_id: call.id, attempts: row.attempts + 1, lease_token: null, lease_until: null, updated_at: now() }
          : { state: row.attempts > 0 ? "retry" : "pending", lease_token: null, lease_until: null, updated_at: now() },
      )
      .where("id", "=", row.id)
      .where("state", "=", "dialing")
      .where("lease_token", "=", row.lease_token)
      .executeTakeFirst();
    n += Number(res.numUpdatedRows ?? 0);
  }
  return n;
}

/** Rows still "in_call" whose call reached a final status (the hook was missed or ran first). */
async function syncEndedCalls(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .selectFrom("campaign_contacts")
    .innerJoin("calls", "calls.id", "campaign_contacts.last_call_id")
    .selectAll("calls")
    .where("campaign_contacts.state", "=", "in_call")
    .where("calls.status", "in", [...FINAL_CALL_STATUSES])
    .limit(200)
    .execute();
  let n = 0;
  for (const call of rows) if ((await onCallEnded(toCallRecord(call))) === "updated") n += 1;
  // A row whose call row vanished can't finish: give it up.
  const orphans = await db
    .selectFrom("campaign_contacts")
    .leftJoin("calls", "calls.id", "campaign_contacts.last_call_id")
    .select(["campaign_contacts.id"])
    .where("campaign_contacts.state", "=", "in_call")
    .where("calls.id", "is", null)
    .limit(100)
    .execute();
  for (const o of orphans) {
    await db.updateTable("campaign_contacts").set({ state: "failed", last_outcome: "failed", updated_at: now() }).where("id", "=", o.id).where("state", "=", "in_call").execute();
    n += 1;
  }
  return n;
}

async function activateScheduled(): Promise<void> {
  const db = await getDb();
  const nowIso = now();
  await db
    .updateTable("campaigns")
    .set({ status: "running", updated_at: nowIso })
    .where("status", "=", "scheduled")
    .where((eb) => eb.or([eb("starts_at", "is", null), eb("starts_at", "<=", nowIso)]))
    .execute();
}

// ── The run ──

async function loadContext(campaign: CampaignRecord, platformCap: number): Promise<Context | { pause: string; message: string } | null> {
  const workspace = await getWorkspace(campaign.workspaceId);
  if (!workspace) return null;
  const entitlements = await getWorkspaceEntitlements(workspace);
  if (entitlements.suspended) return { pause: "suspended", message: `Campaign "${campaign.name}" was paused: the account that owns this workspace is suspended.` };
  if (!entitlements.allowCampaigns) return { pause: "plan", message: `Campaign "${campaign.name}" was paused: the owner's plan no longer includes campaigns.` };
  const agent = await getAgent(workspace.id, campaign.agentId);
  if (!agent) return { pause: "agent", message: `Campaign "${campaign.name}" was paused: its agent was deleted.` };
  return { campaign, workspace, entitlements, agent, ownerWorkspaces: await ownedWorkspaceIds(workspace.ownerId), platformCap, waiting: null };
}

/**
 * One engine run. Safe to run concurrently (several ticks, the fast endpoint): see the module
 * comment. `campaignId` limits the dialing to one campaign (the "Start" button).
 */
export async function runCampaignEngine(options: { deadline: number; campaignId?: number; maxDials?: number }): Promise<EngineResult> {
  const result: EngineResult = { dialed: 0, rescheduled: 0, skipped: 0, ended: 0, recovered: 0 };
  await activateScheduled();
  await finishExpiredCampaigns();
  result.recovered = await recoverLeases();
  result.ended = await syncEndedCalls();

  const db = await getDb();
  let q = db.selectFrom("campaigns").select(["id", "workspace_id"]).where("status", "=", "running");
  if (options.campaignId) q = q.where("id", "=", options.campaignId);
  const running = await q.orderBy("updated_at").orderBy("id").limit(100).execute();
  if (!running.length) return result;
  const settings = await getSettings();
  const platformCap = Math.max(0, Number(settings.voice_global_concurrency) || 0);
  const maxDials = options.maxDials ?? MAX_DIALS_PER_RUN;

  for (const r of running) {
    if (Date.now() >= options.deadline || result.dialed >= maxDials) break;
    const campaign = await getCampaign(r.workspace_id, r.id);
    if (!campaign || campaign.status !== "running") continue;
    const ctx = await loadContext(campaign, platformCap);
    if (!ctx) continue;
    if ("pause" in ctx) {
      if (await pauseCampaign(campaign.workspaceId, campaign.id, { type: "system", id: null }, ctx.pause)) {
        const ws = await getWorkspace(campaign.workspaceId);
        if (ws) await notifyWorkspace(ws.id, await buildNotifyPayload(ws, "campaign_finished", ctx.message, { campaign: campaign.name, status: "paused", reason: ctx.pause }, workspaceDashboardPath(ws.id, `campaigns/${campaign.id}`)), { ownerFallback: true });
      }
      continue;
    }
    // Outbound access (plan, kill switches, the workspace's own stop, approval): wait, don't pause.
    const access = await outboundAccess(await getCompliance(ctx.workspace), ctx.entitlements);
    if (!access.ok) {
      await mergeCampaignStats(campaign.id, { waiting: `outbound_${access.reason}`, checkedAt: now() });
      continue;
    }
    while (Date.now() < options.deadline && result.dialed < maxDials) {
      const admit = await admitOne(ctx);
      if ("stop" in admit) {
        if (admit.stop === "capacity") ctx.waiting = "concurrency";
        break;
      }
      if ((await processRow(ctx, admit.row, admit.token, result)) === "stop") break;
    }
    await mergeCampaignStats(campaign.id, { waiting: ctx.waiting, checkedAt: now() });
    await maybeCompleteCampaign(campaign.id);
  }
  return result;
}
