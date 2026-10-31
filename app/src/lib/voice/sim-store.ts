import "server-only";
import { getAgent, toAgentSpec } from "@/lib/agents";
import { getDb, now } from "@/lib/db";
import { findActiveNumber } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspaces";
import { getCompliance } from "@/lib/compliance";
import { ingestWebhook, simulatedWebhookSecret } from "./ingest";
import { planSimulatedCall, setSimulatedScheduler, signSimulatedBody, SIM_SIGNATURE_HEADER, type SimScheduledEvent } from "./simulated";
import type { SimOutcome } from "./sim-script";
import { toProviderVariables } from "./vars";

/**
 * Storage and delivery of simulated call events: startCall() of the Simulated provider schedules
 * webhook bodies here (voice_sim_events); pumpSimulatedCalls() (the "voice-sync" job, and the
 * dashboard's live views) delivers the due ones, signed, through the real webhook ingest.
 */

async function storeEvents(events: SimScheduledEvent[]): Promise<void> {
  if (!events.length) return;
  const db = await getDb();
  const base = Date.now();
  const ts = now();
  await db
    .insertInto("voice_sim_events")
    .values(
      events.map((e) => ({
        workspace_id: e.workspaceId ?? 0,
        provider_call_id: e.providerCallId,
        seq: e.seq,
        due_at: new Date(base + e.delayMs).toISOString(),
        body: JSON.stringify(e.body),
        delivered_at: null,
        created_at: ts,
      })),
    )
    .execute();
}

setSimulatedScheduler(storeEvents);

/**
 * Delivers due simulated events (oldest first), each exactly once (claimed with a conditional
 * UPDATE), through ingestWebhook("simulated"). `providerCallId` limits it to one call (live
 * views); `all` ignores due times (tests). Returns the number delivered.
 */
export async function pumpSimulatedCalls(options: { limit?: number; providerCallId?: string; all?: boolean; deadline?: number } = {}): Promise<number> {
  const db = await getDb();
  let q = db.selectFrom("voice_sim_events").select(["id", "body", "provider_call_id"]).where("delivered_at", "is", null);
  if (!options.all) q = q.where("due_at", "<=", new Date().toISOString());
  if (options.providerCallId) q = q.where("provider_call_id", "=", options.providerCallId);
  const rows = await q
    .orderBy("due_at")
    .orderBy("seq")
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 1000))
    .execute();
  if (!rows.length) return 0;
  const secret = await simulatedWebhookSecret();
  let delivered = 0;
  for (const row of rows) {
    if (options.deadline && Date.now() > options.deadline) break;
    const claim = await db.updateTable("voice_sim_events").set({ delivered_at: now() }).where("id", "=", row.id).where("delivered_at", "is", null).executeTakeFirst();
    if (Number(claim.numUpdatedRows) !== 1) continue;
    const body = { ...(JSON.parse(row.body) as Record<string, unknown>), at: new Date().toISOString() };
    const raw = JSON.stringify(body);
    const result = await ingestWebhook("simulated", { [SIM_SIGNATURE_HEADER]: signSimulatedBody(raw, secret) }, raw);
    if (result.status >= 500) {
      // Try again on the next run.
      await db.updateTable("voice_sim_events").set({ delivered_at: null }).where("id", "=", row.id).execute();
      continue;
    }
    delivered++;
  }
  return delivered;
}

/** Deletes delivered events older than a day (housekeeping of the job). */
export async function pruneSimulatedEvents(): Promise<number> {
  const db = await getDb();
  const res = await db.deleteFrom("voice_sim_events").where("delivered_at", "is not", null).where("delivered_at", "<", new Date(Date.now() - 86_400_000).toISOString()).executeTakeFirst();
  return Number(res.numDeletedRows ?? 0);
}

export type SimulateInboundResult = { ok: true; providerCallId: string } | { ok: false; error: "number" | "agent" | "provider" };

/**
 * A simulated inbound call to one of the workspace's numbers (demo "call this number" button,
 * tests): routed by the ingest exactly like a provider's inbound call.
 */
export async function simulateInboundCall(e164: string, options: { from?: string; outcome?: SimOutcome | null } = {}): Promise<SimulateInboundResult> {
  const number = await findActiveNumber(e164);
  if (!number) return { ok: false, error: "number" };
  if (number.provider !== "simulated") return { ok: false, error: "provider" };
  if (!number.inboundAgentId) return { ok: false, error: "agent" };
  const agent = await getAgent(number.workspaceId, number.inboundAgentId);
  const workspace = await getWorkspace(number.workspaceId);
  if (!agent || !workspace) return { ok: false, error: "agent" };
  const compliance = await getCompliance(workspace);
  const spec = await toAgentSpec(agent);
  const settings = await getSettings();
  const from = options.from ?? `+1202555${String(100 + Math.floor(Math.random() * 99)).padStart(4, "0")}`;
  const plan = planSimulatedCall({
    agent: { ...spec, providerAgentId: agent.providerAgentId ?? `sim_agent_${agent.id}` },
    direction: "inbound",
    from,
    to: number.e164,
    variables: toProviderVariables({ business_name: agent.settings.businessName || compliance.settings.businessName || settings.site_name, caller_number: from, contact_number: from, timezone: workspace.timezone || "UTC", today: new Date().toISOString().slice(0, 10) }),
    // No call tags: the ingest routes it by the number, as for a real inbound call.
    metadata: {},
    outcome: options.outcome ?? null,
  });
  await storeEvents(plan.events.map((e) => ({ ...e, workspaceId: number.workspaceId })));
  return { ok: true, providerCallId: plan.providerCallId };
}
