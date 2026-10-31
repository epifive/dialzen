import "server-only";
import { auditSafe } from "@/lib/audit";
import { toCallRecord, updateCall, type CallRecord } from "@/lib/calls";
import { getDb } from "@/lib/db";
import { readRaw, writeRaw } from "@/lib/scheduler";
import { callAccountContext, type ResolvedContext } from "@/lib/providers";
import { isProvider } from "@/voice/normalize";
import { LIVE_CALL_STATUSES, type NormalizedCallEvent, type ProviderCallDetails, type ProviderId } from "@/voice/types";
import { callById, failCall, finalizeCall, processEvent } from "./ingest";
import "./index";

/**
 * Nightly reconciliation (job "reconcile"): compares our calls of the last 48 hours with the
 * provider's records (getCall). Calls whose final webhook never arrived are completed through the
 * normal ingest path (same event ids as the webhooks, so nothing is applied twice); duration and
 * cost drift on finished calls is corrected and written to the audit log; calls the provider
 * doesn't know and that are stuck "live" are failed (their reservation comes back).
 *
 * Also: the per-tenant P&L read model for Admin → Billing (getTenantPnl).
 */

export interface ReconcileSummary {
  checked: number;
  completed: number;
  drift: number;
  failed: number;
  errors: number;
}

const STUCK_MS = 3 * 3600_000;
const SIM_STUCK_MS = 3600_000;

const isLive = (s: string) => (LIVE_CALL_STATUSES as readonly string[]).includes(s);

/** Events equivalent to the provider's final webhooks (same ids as the adapters use). */
function eventsFromDetails(provider: ProviderId, d: ProviderCallDetails, success: boolean | null = null): NormalizedCallEvent[] {
  const at = d.endedAt ?? new Date().toISOString();
  const base = { provider, providerCallId: d.providerCallId, metadata: d.metadata };
  const out: NormalizedCallEvent[] = [];
  if (isLive(d.status)) return out;
  out.push({ ...base, eventId: `${d.providerCallId}:ended`, at, type: "ended", status: d.status, endReason: d.endReason ?? "unknown", durationSec: d.durationSec, costMicros: d.costMicros, startedAt: d.startedAt, endedAt: at, transcript: d.transcript, recordingUrl: d.recordingUrl, disclosurePlayed: null, latencyMs: d.latencyMs });
  if (d.summary || Object.keys(d.extracted).length || d.sentiment !== "unknown") out.push({ ...base, eventId: `${d.providerCallId}:analyzed`, at, type: "analysis_ready", summary: d.summary, sentiment: d.sentiment, extracted: d.extracted, success });
  return out;
}

async function settled(callId: number): Promise<boolean> {
  const db = await getDb();
  return Boolean(await db.selectFrom("credit_transactions").select("id").where("call_id", "=", callId).where("kind", "=", "settle").executeTakeFirst());
}

/** Reconciles one call with the provider's record. */
export async function reconcileCall(call: CallRecord, details: ProviderCallDetails | null): Promise<"ok" | "completed" | "drift" | "failed"> {
  const provider = call.provider as ProviderId;
  if (!details) {
    if (isLive(call.status) && Date.now() - Date.parse(call.updatedAt) > STUCK_MS) {
      await failCall(call.id, "The provider has no record of this call.");
      return "failed";
    }
    return "ok";
  }
  if (isLive(call.status)) {
    const events = eventsFromDetails(provider, details);
    if (!events.length) return "ok";
    for (const e of events) await processEvent(provider, e, JSON.stringify({ reconcile: e.eventId }), call.keySource);
    await auditSafe({ workspaceId: call.workspaceId, actor: { type: "system", id: null }, action: "call.reconciled", entityType: "call", entityId: call.id, data: { reason: "missed_webhook", status: details.status, durationSec: details.durationSec } });
    return "completed";
  }
  const drift: Record<string, unknown> = {};
  const patch: Parameters<typeof updateCall>[1] = {};
  if (Math.abs(details.durationSec - call.durationSec) > 1) {
    drift.durationSec = { ours: call.durationSec, provider: details.durationSec };
    patch.duration_sec = details.durationSec;
  }
  if (details.costMicros !== null && (call.providerCostMicros === null || Math.abs(details.costMicros - call.providerCostMicros) > 1000)) {
    drift.costMicros = { ours: call.providerCostMicros, provider: details.costMicros };
    patch.provider_cost_micros = details.costMicros;
  }
  if (!Object.keys(drift).length) {
    if (!(await settled(call.id))) await finalizeCall(call);
    return "ok";
  }
  const wasSettled = await settled(call.id);
  await updateCall(call.id, { ...patch, metadata: JSON.stringify({ ...call.metadata, reconcile_drift: drift }) });
  // Not billed yet (e.g. the ended webhook crashed): bill with the provider's duration now.
  if (!wasSettled) {
    const fresh = await callById(call.id);
    if (fresh) await finalizeCall(fresh);
  }
  await auditSafe({ workspaceId: call.workspaceId, actor: { type: "system", id: null }, action: "call.reconcile_drift", entityType: "call", entityId: call.id, data: { ...drift, billed: wasSettled ? "already settled (not re-billed)" : "billed now" } });
  return "drift";
}

const CURSOR_KEY = "voice_reconcile_cursor";

/**
 * The nightly job's work over the last `hours` hours, until the deadline:
 *   1. first the calls that need it most: still live, or finished but never billed (no settle row)
 *   2. then the other finished calls not confirmed yet (reconciled_at null), by id from a cursor
 *      kept between runs (setting "voice_reconcile_cursor"), so busy sites get through all of
 *      them over several runs instead of re-checking the oldest ones
 * A finished call the provider confirmed (or no longer knows) gets reconciled_at and is skipped
 * from then on.
 */
export async function reconcileRecentCalls(options: { hours?: number; limit?: number; deadline?: number } = {}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, completed: 0, drift: 0, failed: 0, errors: 0 };
  const db = await getDb();
  const since = new Date(Date.now() - (options.hours ?? 48) * 3600_000).toISOString();
  const limit = options.limit ?? 300;
  await sweepStuckSimulated(summary);

  const base = () =>
    db.selectFrom("calls").selectAll().where("provider", "!=", "simulated").where("provider_call_id", "is not", null).where("created_at", ">=", since).where("reconciled_at", "is", null);
  const urgent = await base()
    .where((eb) =>
      eb.or([
        eb("status", "in", [...LIVE_CALL_STATUSES]),
        eb.not(eb.exists(eb.selectFrom("credit_transactions as ct").select("ct.id").whereRef("ct.call_id", "=", "calls.id").where("ct.kind", "=", "settle"))),
      ]),
    )
    .orderBy("created_at")
    .limit(Math.max(1, Math.floor(limit / 3)))
    .execute();
  await checkWithProviders(urgent.map(toCallRecord), summary, options.deadline);

  const cursor = Number(await readRaw(CURSOR_KEY)) || 0;
  const rest = await base()
    .where("id", ">", cursor)
    .where("status", "not in", [...LIVE_CALL_STATUSES])
    .orderBy("id")
    .limit(limit)
    .execute();
  const done = await checkWithProviders(rest.map(toCallRecord), summary, options.deadline);
  // Next run goes on after the last call checked; a short page means the end: start over.
  await writeRaw(CURSOR_KEY, rest.length < limit && done.all ? "0" : String(done.lastId ?? cursor));
  return summary;
}

/** Simulated calls have no provider record: phone calls stuck live for an hour are closed (browser chats: expireIdleWebCalls). */
async function sweepStuckSimulated(summary: ReconcileSummary): Promise<void> {
  const db = await getDb();
  const stuckSim = await db
    .selectFrom("calls")
    .select("id")
    .where("provider", "=", "simulated")
    .where("direction", "!=", "web")
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .where("updated_at", "<", new Date(Date.now() - SIM_STUCK_MS).toISOString())
    .limit(100)
    .execute();
  for (const r of stuckSim) {
    await failCall(r.id, "The simulated call timed out.");
    summary.failed++;
  }
}

/**
 * The stuck-call sweep (every 10 minutes): live phone calls (ElevenLabs, Retell) without news for
 * `olderThanMs` are checked with the provider, so a missed final webhook doesn't hold the call's
 * credits and a concurrency slot (and its campaign row) until the nightly run; stuck simulated
 * phone calls are closed. Browser calls are handled by expireIdleWebCalls().
 */
export async function reconcileLiveCalls(options: { olderThanMs?: number; limit?: number; deadline?: number } = {}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, completed: 0, drift: 0, failed: 0, errors: 0 };
  await sweepStuckSimulated(summary);
  const db = await getDb();
  const rows = await db
    .selectFrom("calls")
    .selectAll()
    .where("provider", "!=", "simulated")
    .where("direction", "!=", "web")
    .where("provider_call_id", "is not", null)
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .where("updated_at", "<", new Date(Date.now() - (options.olderThanMs ?? 10 * 60_000)).toISOString())
    .orderBy("updated_at")
    .limit(options.limit ?? 50)
    .execute();
  await checkWithProviders(rows.map(toCallRecord), summary, options.deadline);
  return summary;
}

/** Checks calls with their providers; returns the id of the last call handled and whether all were. */
async function checkWithProviders(calls: CallRecord[], summary: ReconcileSummary, deadline?: number): Promise<{ lastId: number | null; all: boolean }> {
  const contexts = new Map<string, ResolvedContext | null>();
  let lastId: number | null = null;
  for (const call of calls) {
    if (deadline && Date.now() > deadline) return { lastId, all: false };
    lastId = call.id;
    if (!isProvider(call.provider)) continue;
    // The account the call was made in (own keys while still saved, else the site's).
    const key = `${call.workspaceId}:${call.provider}:${call.keySource}`;
    if (!contexts.has(key)) contexts.set(key, await callAccountContext(call, 10_000));
    const resolved = contexts.get(key);
    if (!resolved) continue;
    summary.checked++;
    try {
      const details = await resolved.provider.getCall(resolved.ctx, call.providerCallId!);
      const result = await reconcileCall(call, details);
      if (result === "completed") summary.completed++;
      else if (result === "drift") summary.drift++;
      else if (result === "failed") summary.failed++;
      // Confirmed (or forgotten by the provider) and finished: not checked again.
      const fresh = await callById(call.id);
      if (fresh && !isLive(fresh.status) && (!details || !isLive(details.status))) await getDb().then((db) => db.updateTable("calls").set({ reconciled_at: new Date().toISOString() }).where("id", "=", call.id).execute());
    } catch {
      summary.errors++;
    }
  }
  return { lastId, all: true };
}

// ── Per-tenant P&L ──

export interface TenantPnlRow {
  workspaceId: number;
  workspaceName: string;
  ownerId: number;
  ownerEmail: string;
  /**
   * Internal workspace: owned by a site administrator (the operator's own or demo use). Its calls
   * are usually covered by the admin's plan minutes, so they are cost without revenue; the default
   * P&L view ("customers only") leaves them out.
   */
  internal: boolean;
  calls: number;
  /** Talk time and billed time (seconds). */
  durationSec: number;
  billedSec: number;
  /** Seconds covered by the owner's plan minutes (revenue of the subscription, not the wallet). */
  includedSec: number;
  /** Charged from the wallet for calls (micros). */
  callRevenueMicros: number;
  /** Monthly number rentals charged (micros). */
  rentalRevenueMicros: number;
  revenueMicros: number;
  /** What the providers charged the platform (micros, known costs only). */
  providerCostMicros: number;
  /** Calls whose provider cost is unknown (BYO keys or not reported yet). */
  unknownCostCalls: number;
  byoCalls: number;
  marginMicros: number;
  /** margin ÷ revenue (null without revenue). */
  marginPct: number | null;
}

export type TenantPnlTotals = Omit<TenantPnlRow, "workspaceId" | "workspaceName" | "ownerId" | "ownerEmail" | "internal">;

export interface TenantPnl {
  month: string;
  /** Every workspace with calls or rentals in the month (internal ones flagged). */
  rows: TenantPnlRow[];
  /** All workspaces, internal ones included. */
  totals: TenantPnlTotals;
  /** Customers only: the same sums without internal (admin-owned) workspaces. */
  customerTotals: TenantPnlTotals;
  /** How many of the rows are internal. */
  internalWorkspaces: number;
}

const pctOf = (margin: number, revenue: number) => (revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null);

function pnlTotals(rows: TenantPnlRow[]): TenantPnlTotals {
  const sum = (k: keyof TenantPnlTotals) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0);
  const revenue = sum("revenueMicros");
  const margin = sum("marginMicros");
  return {
    calls: sum("calls"),
    durationSec: sum("durationSec"),
    billedSec: sum("billedSec"),
    includedSec: sum("includedSec"),
    callRevenueMicros: sum("callRevenueMicros"),
    rentalRevenueMicros: sum("rentalRevenueMicros"),
    revenueMicros: revenue,
    providerCostMicros: sum("providerCostMicros"),
    unknownCostCalls: sum("unknownCostCalls"),
    byoCalls: sum("byoCalls"),
    marginMicros: margin,
    marginPct: pctOf(margin, revenue),
  };
}

/**
 * Sell price vs provider cost by workspace for a UTC month ("YYYY-MM"), most revenue first, with
 * totals for all workspaces and for customers only (without admin-owned, internal workspaces).
 */
export async function getTenantPnl(month: string): Promise<TenantPnl> {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1)).toISOString();
  const to = new Date(Date.UTC(y, mo, 1)).toISOString();
  const db = await getDb();
  const calls = await db
    .selectFrom("calls")
    .select([
      "workspace_id",
      (eb) => eb.fn.countAll<number>().as("n"),
      (eb) => eb.fn.sum<number>("duration_sec").as("duration"),
      (eb) => eb.fn.sum<number>("billed_seconds").as("billed"),
      (eb) => eb.fn.sum<number>("included_seconds").as("included"),
      (eb) => eb.fn.sum<number>("credits_settled_micros").as("revenue"),
      (eb) => eb.fn.sum<number>("provider_cost_micros").as("cost"),
      (eb) => eb.fn.sum<number>(eb.case().when("provider_cost_micros", "is", null).then(1).else(0).end()).as("unknown"),
      (eb) => eb.fn.sum<number>(eb.case().when("key_source", "=", "byo").then(1).else(0).end()).as("byo"),
    ])
    .where("created_at", ">=", from)
    .where("created_at", "<", to)
    .groupBy("workspace_id")
    .execute();
  const rentals = await db
    .selectFrom("number_rentals")
    .select(["workspace_id", (eb) => eb.fn.sum<number>("amount_micros").as("amount")])
    .where("month", "=", m)
    .where("transaction_id", "is not", null)
    .groupBy("workspace_id")
    .execute();
  const ids = [...new Set([...calls.map((c) => c.workspace_id), ...rentals.map((r) => r.workspace_id)])];
  const names = ids.length
    ? await db.selectFrom("workspaces as w").leftJoin("users as u", "u.id", "w.owner_id").select(["w.id", "w.name", "w.owner_id", "u.email", "u.role"]).where("w.id", "in", ids).execute()
    : [];
  const rows: TenantPnlRow[] = ids.map((id) => {
    const c = calls.find((x) => x.workspace_id === id);
    const r = rentals.find((x) => x.workspace_id === id);
    const w = names.find((x) => x.id === id);
    const callRevenue = Number(c?.revenue ?? 0);
    const rental = Number(r?.amount ?? 0);
    const revenue = callRevenue + rental;
    const cost = Number(c?.cost ?? 0);
    const margin = revenue - cost;
    return {
      workspaceId: id,
      workspaceName: w?.name ?? `#${id}`,
      ownerId: w?.owner_id ?? 0,
      ownerEmail: w?.email ?? "",
      internal: w?.role === "admin",
      calls: Number(c?.n ?? 0),
      durationSec: Number(c?.duration ?? 0),
      billedSec: Number(c?.billed ?? 0),
      includedSec: Number(c?.included ?? 0),
      callRevenueMicros: callRevenue,
      rentalRevenueMicros: rental,
      revenueMicros: revenue,
      providerCostMicros: cost,
      unknownCostCalls: Number(c?.unknown ?? 0),
      byoCalls: Number(c?.byo ?? 0),
      marginMicros: margin,
      marginPct: pctOf(margin, revenue),
    };
  });
  rows.sort((a, b) => b.revenueMicros - a.revenueMicros || b.calls - a.calls);
  return { month: m, rows, totals: pnlTotals(rows), customerTotals: pnlTotals(rows.filter((r) => !r.internal)), internalWorkspaces: rows.filter((r) => r.internal).length };
}
