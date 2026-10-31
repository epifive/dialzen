import "server-only";
import { getDb, now } from "./db";
import type { CallRow, CallsTable } from "./db/schema";
import type { Entitlements } from "./plans";
import { getSettings } from "./settings";
import { sha256 } from "./tokens";
import { ownedWorkspaceIds } from "./workspaces";
import { asObj, decodeCallTags, parseJson } from "@/voice/normalize";
import { LIVE_CALL_STATUSES, type CallDirection, type CallStatus, type CallTags, type EndReason, type ProviderId, type Sentiment, type ToolCallRecord, type TranscriptTurn } from "@/voice/types";

/**
 * Calls: one row per inbound, outbound or browser (web) call, created when we dial (outbound /
 * web) or when the provider tells us about an inbound call, and completed by the webhook ingest.
 * Unique (provider, provider_call_id) makes the ingest idempotent; webhook_events records every
 * provider event once.
 */

export interface CallRecord {
  id: number;
  workspaceId: number;
  agentId: number | null;
  campaignId: number | null;
  campaignContactId: number | null;
  contactId: number | null;
  numberId: number | null;
  direction: CallDirection;
  from: string;
  to: string;
  provider: string;
  providerCallId: string | null;
  keySource: "platform" | "byo";
  status: CallStatus;
  endReason: EndReason | null;
  queuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  billedSeconds: number;
  includedSeconds: number;
  pricePerMinMicros: number;
  creditsReservedMicros: number;
  creditsSettledMicros: number;
  providerCostMicros: number | null;
  recording: { storage: string; key: string } | null;
  recordingUrl: string | null;
  recordingDeletedAt: string | null;
  transcript: TranscriptTurn[];
  summary: string;
  sentiment: Sentiment;
  outcome: string | null;
  extracted: Record<string, unknown>;
  disclosurePlayed: boolean | null;
  toolCalls: ToolCallRecord[];
  latencyMs: number | null;
  tags: CallTags;
  metadata: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function list<T>(text: string | null): T[] {
  const v = parseJson(text);
  return Array.isArray(v) ? (v as T[]) : [];
}

export function toCallRecord(row: CallRow): CallRecord {
  const metadata = asObj(parseJson(row.metadata));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    campaignId: row.campaign_id,
    campaignContactId: row.campaign_contact_id,
    contactId: row.contact_id,
    numberId: row.number_id,
    direction: row.direction,
    from: row.from_e164,
    to: row.to_e164,
    provider: row.provider,
    providerCallId: row.provider_call_id,
    keySource: row.key_source,
    status: row.status as CallStatus,
    endReason: (row.end_reason as EndReason | null) ?? null,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSec: Number(row.duration_sec),
    billedSeconds: Number(row.billed_seconds),
    includedSeconds: Number(row.included_seconds),
    pricePerMinMicros: Number(row.price_per_min_micros),
    creditsReservedMicros: Number(row.credits_reserved_micros),
    creditsSettledMicros: Number(row.credits_settled_micros),
    providerCostMicros: row.provider_cost_micros === null ? null : Number(row.provider_cost_micros),
    recording: row.recording_key && row.recording_storage && !row.recording_deleted_at ? { storage: row.recording_storage, key: row.recording_key } : null,
    recordingUrl: row.recording_url,
    recordingDeletedAt: row.recording_deleted_at,
    transcript: list<TranscriptTurn>(row.transcript),
    summary: row.summary ?? "",
    sentiment: row.sentiment,
    outcome: row.outcome,
    extracted: asObj(parseJson(row.extracted)),
    disclosurePlayed: row.disclosure_played === null ? null : row.disclosure_played === 1,
    toolCalls: list<ToolCallRecord>(row.tool_calls),
    latencyMs: row.latency_ms,
    tags: decodeCallTags(metadata),
    metadata,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewCall {
  workspaceId: number;
  agentId: number | null;
  direction: CallDirection;
  provider: ProviderId;
  keySource?: "platform" | "byo";
  from?: string;
  to?: string;
  campaignId?: number | null;
  campaignContactId?: number | null;
  contactId?: number | null;
  numberId?: number | null;
  providerCallId?: string | null;
  status?: CallStatus;
  metadata?: Record<string, unknown>;
}

/** Inserts a call (status "queued" unless given) and returns its id. */
export async function createCall(input: NewCall): Promise<number> {
  const db = await getDb();
  const ts = now();
  const res = await db
    .insertInto("calls")
    .values({
      workspace_id: input.workspaceId,
      agent_id: input.agentId,
      campaign_id: input.campaignId ?? null,
      campaign_contact_id: input.campaignContactId ?? null,
      contact_id: input.contactId ?? null,
      number_id: input.numberId ?? null,
      direction: input.direction,
      from_e164: input.from ?? "",
      to_e164: input.to ?? "",
      provider: input.provider,
      provider_call_id: input.providerCallId ?? null,
      key_source: input.keySource ?? "platform",
      status: input.status ?? "queued",
      end_reason: null,
      queued_at: ts,
      started_at: null,
      ended_at: null,
      duration_sec: 0,
      billed_seconds: 0,
      included_seconds: 0,
      price_per_min_micros: 0,
      credits_reserved_micros: 0,
      credits_settled_micros: 0,
      provider_cost_micros: null,
      recording_storage: null,
      recording_key: null,
      recording_url: null,
      recording_deleted_at: null,
      transcript: null,
      summary: null,
      sentiment: "unknown",
      outcome: null,
      extracted: null,
      disclosure_played: null,
      tool_calls: null,
      latency_ms: null,
      metadata: JSON.stringify(input.metadata ?? {}),
      error: null,
      reconciled_at: null,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

export type CallPatch = Partial<Omit<CallsTable, "id" | "workspace_id" | "created_at">>;

/** Updates columns of a call (updated_at is set automatically). */
export async function updateCall(callId: number, patch: CallPatch): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("calls")
    .set({ ...patch, updated_at: now() })
    .where("id", "=", callId)
    .execute();
}

export async function getCall(workspaceId: number, callId: number): Promise<CallRecord | undefined> {
  if (!Number.isInteger(callId) || callId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("calls").selectAll().where("id", "=", callId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toCallRecord(row) : undefined;
}

/** A call by the provider's id (webhook ingest). */
export async function findCallByProviderId(provider: string, providerCallId: string): Promise<CallRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("calls").selectAll().where("provider", "=", provider).where("provider_call_id", "=", providerCallId).executeTakeFirst();
  return row ? toCallRecord(row) : undefined;
}

export interface CallFilter {
  agentId?: number;
  campaignId?: number;
  contactId?: number;
  direction?: CallDirection;
  status?: CallStatus;
  /** ISO bounds of created_at. */
  from?: string;
  to?: string;
  /** Phone number (from or to) contains. */
  phone?: string;
  /** With `phone`: calls of these contacts match too (search by name). */
  orContactIds?: number[];
  sentiment?: Sentiment;
  /** Analysis outcome ("booked", "transferred"…). */
  outcome?: string;
  limit?: number;
  offset?: number;
}

export async function listCalls(workspaceId: number, filter: CallFilter = {}): Promise<{ calls: CallRecord[]; total: number }> {
  const db = await getDb();
  let q = db.selectFrom("calls").where("workspace_id", "=", workspaceId);
  if (filter.agentId) q = q.where("agent_id", "=", filter.agentId);
  if (filter.campaignId) q = q.where("campaign_id", "=", filter.campaignId);
  if (filter.contactId) q = q.where("contact_id", "=", filter.contactId);
  if (filter.direction) q = q.where("direction", "=", filter.direction);
  if (filter.status) q = q.where("status", "=", filter.status);
  if (filter.from) q = q.where("created_at", ">=", filter.from);
  if (filter.to) q = q.where("created_at", "<", filter.to);
  if (filter.sentiment) q = q.where("sentiment", "=", filter.sentiment);
  if (filter.outcome) q = q.where("outcome", "=", filter.outcome);
  const phone = (filter.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20);
  const contactIds = (filter.orContactIds ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  if (phone || contactIds.length) {
    q = q.where((eb) =>
      eb.or([
        ...(phone ? [eb("from_e164", "like", `%${phone}%`), eb("to_e164", "like", `%${phone}%`)] : []),
        ...(contactIds.length ? [eb("contact_id", "in", contactIds)] : []),
      ]),
    );
  }
  const [rows, count] = await Promise.all([
    q
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.min(Math.max(filter.limit ?? 50, 1), 1000))
      .offset(Math.max(0, filter.offset ?? 0))
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return { calls: rows.map(toCallRecord), total: Number(count?.n ?? 0) };
}

// ── Concurrency ──

/** Calls not updated for this long are not counted as live any more (a missed webhook must not block a workspace forever). */
const STALE_LIVE_MS = 3 * 3600_000;

/** Live calls (queued, ringing, in progress) of the given workspaces ([] = the whole platform). */
export async function countLiveCalls(workspaceIds: number[] | null): Promise<number> {
  const db = await getDb();
  let q = db
    .selectFrom("calls")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .where("updated_at", ">", new Date(Date.now() - STALE_LIVE_MS).toISOString());
  if (workspaceIds) {
    if (!workspaceIds.length) return 0;
    q = q.where("workspace_id", "in", workspaceIds);
  }
  return Number((await q.executeTakeFirst())?.n ?? 0);
}

export type ConcurrencyCheck = { ok: true } | { ok: false; reason: "plan" | "platform"; live: number; limit: number };

/**
 * Whether one more call may start now: the owner's plan cap (across their workspaces) and the
 * platform-wide cap of Admin → Voice providers (the providers' concurrency is shared).
 */
export async function canStartCall(ownerId: number, entitlements: Pick<Entitlements, "maxConcurrentCalls">): Promise<ConcurrencyCheck> {
  const limit = entitlements.maxConcurrentCalls;
  if (limit >= 0) {
    const live = await countLiveCalls(await ownedWorkspaceIds(ownerId));
    if (live >= limit) return { ok: false, reason: "plan", live, limit };
  }
  const settings = await getSettings();
  const platform = Math.max(0, Number(settings.voice_global_concurrency) || 0);
  if (platform > 0) {
    const live = await countLiveCalls(null);
    if (live >= platform) return { ok: false, reason: "platform", live, limit: platform };
  }
  return { ok: true };
}

// ── Webhook idempotency ──

/**
 * Records a provider event once. `fresh: false` = seen before (skip it). Unique (provider,
 * event_id) decides between concurrent deliveries.
 */
export async function recordWebhookEvent(provider: string, eventId: string, rawBody: string, callId: number | null = null): Promise<{ fresh: boolean; id: number | null }> {
  const db = await getDb();
  const id = eventId.slice(0, 190);
  try {
    const res = await db
      .insertInto("webhook_events")
      .values({ provider, event_id: id, received_at: now(), payload_hash: sha256(rawBody), call_id: callId, status: "processed", error: null })
      .executeTakeFirstOrThrow();
    return { fresh: true, id: Number(res.insertId) };
  } catch {
    const seen = await db.selectFrom("webhook_events").select("id").where("provider", "=", provider).where("event_id", "=", id).executeTakeFirst();
    if (seen) return { fresh: false, id: seen.id };
    throw new Error("Could not record the webhook event.");
  }
}

export async function markWebhookEvent(id: number, status: "processed" | "ignored" | "error", error: string | null = null, callId: number | null = null): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("webhook_events")
    .set({ status, error: error ? error.slice(0, 1000) : null, ...(callId ? { call_id: callId } : {}) })
    .where("id", "=", id)
    .execute();
}

// ── Small stats (home page) ──

export interface CallStats {
  calls: number;
  /** Talk time, seconds. */
  seconds: number;
  completed: number;
  /** Calls whose analysis outcome is "booked". */
  booked: number;
}

/** Totals of the workspace's calls created in [from, to). */
export async function callStats(workspaceId: number, from: string, to: string = new Date().toISOString()): Promise<CallStats> {
  const db = await getDb();
  const rows = await db
    .selectFrom("calls")
    .select(["status", "outcome", (eb) => eb.fn.countAll<number>().as("n"), (eb) => eb.fn.sum<number>("duration_sec").as("sec")])
    .where("workspace_id", "=", workspaceId)
    .where("created_at", ">=", from)
    .where("created_at", "<", to)
    .groupBy(["status", "outcome"])
    .execute();
  const out: CallStats = { calls: 0, seconds: 0, completed: 0, booked: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    out.calls += n;
    out.seconds += Number(r.sec ?? 0);
    if (r.status === "completed") out.completed += n;
    if (r.outcome === "booked") out.booked += n;
  }
  return out;
}
