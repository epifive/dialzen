import "server-only";
import { auditSafe, type AuditActorType } from "../audit";
import { getDb, now } from "../db";
import type { CampaignContactRow, CampaignRow } from "../db/schema";
import { chunk } from "../jobs/shared";
import { asObj, idList, int, isValidTimeZone, normalizeCallingWindow, normalizeCampaignPurpose, normalizeRetryOn, oneOf, parseJson, str } from "@/voice/normalize";
import { RETRYABLE_OUTCOMES, type CallingWindow, type CampaignContactState, type CampaignPurpose, type CampaignStatus, type RetryableOutcome } from "@/voice/types";

/**
 * Outbound campaigns: an agent calls the contacts of one or more lists from a number (or a pool of
 * numbers), inside a calling window, with retries per outcome and a concurrency limit. The engine
 * (./engine.ts) dials; this module holds the campaign records, their lifecycle and progress.
 *
 *   draft ──start──▶ scheduled (starts later) ──▶ running ⇄ paused ──▶ completed
 *                                                    └──stop──▶ canceled
 *
 * Starting copies the members of the campaign's lists into campaign_contacts (resume and "add new
 * list members" do it again: existing rows are kept, unique (campaign_id, contact_id)).
 */

export { onCallEnded, resumeCampaignsAfterTopUp } from "./outcomes";

export const CAMPAIGN_LIMITS = {
  maxAttempts: 10,
  maxConcurrency: 50,
  maxDailyCap: 10_000,
  minRetryMin: 5,
  maxRetryMin: 10_080,
  maxLists: 10,
  maxNumbers: 10,
} as const;

/** Default retry delays (minutes) per outcome. */
export const DEFAULT_RETRY_DELAYS: Record<RetryableOutcome, number> = { no_answer: 240, busy: 30, voicemail: 1440, failed: 60 };

export type TimezoneMode = "contact" | "campaign";

export interface CampaignRecord {
  id: number;
  workspaceId: number;
  name: string;
  agentId: number;
  /** Caller ids, first = `number_id` (the engine uses the first one under its daily cap). */
  numberIds: number[];
  listIds: number[];
  purpose: CampaignPurpose;
  status: CampaignStatus;
  pausedReason: string | null;
  startsAt: string | null;
  endsAt: string | null;
  window: CallingWindow;
  timezoneMode: TimezoneMode;
  timezone: string;
  maxAttempts: number;
  retryOn: RetryableOutcome[];
  retryDelays: Record<RetryableOutcome, number>;
  concurrency: number;
  dailyCap: number;
  variables: Record<string, string>;
  abandonMaxPct: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function normalizeRetryDelays(v: unknown, fallbackMin = 240): Record<RetryableOutcome, number> {
  const o = asObj(v);
  const out = {} as Record<RetryableOutcome, number>;
  for (const k of RETRYABLE_OUTCOMES) out[k] = int(o[k], k === "no_answer" ? fallbackMin : DEFAULT_RETRY_DELAYS[k], CAMPAIGN_LIMITS.minRetryMin, CAMPAIGN_LIMITS.maxRetryMin);
  return out;
}

function variablesOf(text: string): Record<string, string> {
  const o = asObj(parseJson(text));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o).slice(0, 30)) if (/^[a-z][a-z0-9_]{0,39}$/.test(k)) out[k] = str(v, "", 500);
  return out;
}

export function toCampaignRecord(row: CampaignRow): CampaignRecord {
  const pool = idList(row.number_ids, CAMPAIGN_LIMITS.maxNumbers);
  const lists = idList(row.list_ids, CAMPAIGN_LIMITS.maxLists);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    agentId: row.agent_id,
    numberIds: [row.number_id, ...pool.filter((n) => n !== row.number_id)],
    listIds: row.list_id ? [row.list_id, ...lists.filter((l) => l !== row.list_id)] : lists,
    purpose: normalizeCampaignPurpose(row.purpose),
    status: row.status,
    pausedReason: row.paused_reason,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    window: normalizeCallingWindow(parseJson(row.calling_window)),
    timezoneMode: row.timezone_mode === "campaign" ? "campaign" : "contact",
    timezone: isValidTimeZone(row.timezone) ? row.timezone : "UTC",
    maxAttempts: Number(row.max_attempts),
    retryOn: normalizeRetryOn(parseJson(row.retry_on)),
    retryDelays: normalizeRetryDelays(parseJson(row.retry_delays), Number(row.retry_delay_min)),
    concurrency: Number(row.concurrency),
    dailyCap: Number(row.daily_cap),
    variables: variablesOf(row.variables),
    abandonMaxPct: Number(row.abandon_max_pct),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function listCampaigns(workspaceId: number, options: { status?: CampaignStatus } = {}): Promise<CampaignRecord[]> {
  const db = await getDb();
  let q = db.selectFrom("campaigns").selectAll().where("workspace_id", "=", workspaceId);
  if (options.status) q = q.where("status", "=", options.status);
  return (await q.orderBy("id", "desc").limit(500).execute()).map(toCampaignRecord);
}

export async function getCampaign(workspaceId: number, campaignId: number): Promise<CampaignRecord | undefined> {
  if (!Number.isInteger(campaignId) || campaignId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("campaigns").selectAll().where("id", "=", campaignId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toCampaignRecord(row) : undefined;
}

// ── Create / update ──

export interface CampaignInput {
  name: string;
  agentId: number;
  numberIds: number[];
  listIds: number[];
  purpose: string;
  startsAt?: string | null;
  endsAt?: string | null;
  window?: unknown;
  timezoneMode?: string;
  timezone?: string;
  maxAttempts?: number;
  retryOn?: unknown;
  retryDelays?: unknown;
  concurrency?: number;
  dailyCap?: number;
  variables?: Record<string, unknown>;
  abandonMaxPct?: number;
}

export type CampaignError = "name" | "agent" | "number" | "list" | "dates" | "window" | "timezone" | "concurrency" | "status" | "not_found" | "plan";

/** Validates against the workspace's agents, numbers and lists. `maxConcurrency` = the plan's cap (-1 = none). */
export async function validateCampaign(workspaceId: number, input: CampaignInput, maxConcurrency: number): Promise<{ ok: true; values: Omit<CampaignRow, "id" | "workspace_id" | "status" | "stats" | "created_by" | "created_at" | "updated_at" | "completed_at" | "paused_reason"> } | { ok: false; error: CampaignError }> {
  const name = str(input.name, "", 120);
  if (!name) return { ok: false, error: "name" };
  const db = await getDb();
  const agent = await db.selectFrom("agents").select("id").where("id", "=", input.agentId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!agent) return { ok: false, error: "agent" };
  const numberIds = idList(input.numberIds, CAMPAIGN_LIMITS.maxNumbers);
  const numbers = numberIds.length ? await db.selectFrom("phone_numbers").select("id").where("workspace_id", "=", workspaceId).where("id", "in", numberIds).where("status", "!=", "released").execute() : [];
  const validNumbers = numberIds.filter((id) => numbers.some((n) => n.id === id));
  if (!validNumbers.length) return { ok: false, error: "number" };
  const listIds = idList(input.listIds, CAMPAIGN_LIMITS.maxLists);
  const lists = listIds.length ? await db.selectFrom("contact_lists").select("id").where("workspace_id", "=", workspaceId).where("id", "in", listIds).execute() : [];
  const validLists = listIds.filter((id) => lists.some((l) => l.id === id));
  if (!validLists.length) return { ok: false, error: "list" };
  const startsAt = input.startsAt && Number.isFinite(Date.parse(input.startsAt)) ? new Date(input.startsAt).toISOString() : null;
  const endsAt = input.endsAt && Number.isFinite(Date.parse(input.endsAt)) ? new Date(input.endsAt).toISOString() : null;
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, error: "dates" };
  const window = normalizeCallingWindow(input.window ?? {});
  if (!window.days.length) return { ok: false, error: "window" };
  const timezoneMode: TimezoneMode = input.timezoneMode === "campaign" ? "campaign" : "contact";
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  if (timezoneMode === "campaign" && !(input.timezone && isValidTimeZone(input.timezone))) return { ok: false, error: "timezone" };
  const cap = maxConcurrency < 0 ? CAMPAIGN_LIMITS.maxConcurrency : Math.min(CAMPAIGN_LIMITS.maxConcurrency, Math.max(1, maxConcurrency));
  const concurrency = int(input.concurrency, 1, 1, CAMPAIGN_LIMITS.maxConcurrency);
  if (concurrency > cap) return { ok: false, error: "concurrency" };
  const delays = normalizeRetryDelays(input.retryDelays ?? {});
  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.variables ?? {}).slice(0, 30)) {
    const key = k.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (/^[a-z][a-z0-9_]{0,39}$/.test(key)) variables[key] = str(v, "", 500);
  }
  return {
    ok: true,
    values: {
      name,
      agent_id: agent.id,
      number_id: validNumbers[0],
      number_ids: JSON.stringify(validNumbers),
      list_id: validLists[0],
      list_ids: JSON.stringify(validLists),
      purpose: normalizeCampaignPurpose(input.purpose),
      starts_at: startsAt,
      ends_at: endsAt,
      calling_window: JSON.stringify(window),
      timezone_mode: timezoneMode,
      timezone,
      max_attempts: int(input.maxAttempts, 3, 1, CAMPAIGN_LIMITS.maxAttempts),
      retry_delay_min: delays.no_answer,
      retry_on: JSON.stringify(normalizeRetryOn(Array.isArray(input.retryOn) ? input.retryOn : ["no_answer", "busy"])),
      retry_delays: JSON.stringify(delays),
      concurrency,
      daily_cap: int(input.dailyCap, 0, 0, CAMPAIGN_LIMITS.maxDailyCap),
      variables: JSON.stringify(variables),
      abandon_max_pct: int(input.abandonMaxPct, 3, 0, 20),
    },
  };
}

export async function createCampaign(workspaceId: number, input: CampaignInput, options: { maxConcurrency: number; userId: number | null; actor?: AuditActorType }): Promise<{ ok: true; campaign: CampaignRecord } | { ok: false; error: CampaignError }> {
  const v = await validateCampaign(workspaceId, input, options.maxConcurrency);
  if (!v.ok) return v;
  const db = await getDb();
  const ts = now();
  const res = await db
    .insertInto("campaigns")
    .values({ workspace_id: workspaceId, ...v.values, status: "draft", paused_reason: null, stats: "{}", created_by: options.userId, created_at: ts, updated_at: ts, completed_at: null })
    .executeTakeFirstOrThrow();
  const id = Number(res.insertId);
  await auditSafe({ workspaceId, actor: { type: options.actor ?? "user", id: options.userId }, action: "campaign.created", entityType: "campaign", entityId: id, data: { name: v.values.name, purpose: v.values.purpose } });
  return { ok: true, campaign: (await getCampaign(workspaceId, id))! };
}

/** Edits a campaign that isn't running (draft, scheduled, paused). */
export async function updateCampaign(workspaceId: number, campaignId: number, input: CampaignInput, options: { maxConcurrency: number; userId: number | null }): Promise<{ ok: true; campaign: CampaignRecord } | { ok: false; error: CampaignError }> {
  const current = await getCampaign(workspaceId, campaignId);
  if (!current) return { ok: false, error: "not_found" };
  if (!["draft", "scheduled", "paused"].includes(current.status)) return { ok: false, error: "status" };
  const v = await validateCampaign(workspaceId, input, options.maxConcurrency);
  if (!v.ok) return v;
  const db = await getDb();
  await db.updateTable("campaigns").set({ ...v.values, updated_at: now() }).where("id", "=", campaignId).where("workspace_id", "=", workspaceId).execute();
  await auditSafe({ workspaceId, actor: { type: "user", id: options.userId }, action: "campaign.updated", entityType: "campaign", entityId: campaignId, data: { purpose: v.values.purpose } });
  return { ok: true, campaign: (await getCampaign(workspaceId, campaignId))! };
}

/** Deletes a campaign that isn't running and its contact rows (calls keep their campaign id). */
export async function deleteCampaign(workspaceId: number, campaignId: number, userId: number | null): Promise<boolean> {
  const current = await getCampaign(workspaceId, campaignId);
  if (!current || current.status === "running" || current.status === "scheduled") return false;
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("campaign_contacts").where("campaign_id", "=", campaignId).execute();
    await trx.deleteFrom("campaigns").where("id", "=", campaignId).execute();
  });
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "campaign.deleted", entityType: "campaign", entityId: campaignId, data: { name: current.name } });
  return true;
}

// ── Lifecycle ──

/** Copies the current members of the campaign's lists into campaign_contacts (new ones only). Returns the rows added. */
export async function syncCampaignContacts(campaign: Pick<CampaignRecord, "id" | "workspaceId" | "listIds">): Promise<number> {
  const db = await getDb();
  if (!campaign.listIds.length) return 0;
  const members = await db
    .selectFrom("list_members")
    .innerJoin("contacts", "contacts.id", "list_members.contact_id")
    .select(["contacts.id", "contacts.phone_e164"])
    .where("list_members.workspace_id", "=", campaign.workspaceId)
    .where("list_members.list_id", "in", campaign.listIds)
    .execute();
  const unique = new Map(members.map((m) => [m.id, m.phone_e164]));
  let added = 0;
  const ts = now();
  for (const part of chunk([...unique.keys()], 400)) {
    const have = new Set((await db.selectFrom("campaign_contacts").select("contact_id").where("campaign_id", "=", campaign.id).where("contact_id", "in", part).execute()).map((r) => r.contact_id));
    const fresh = part.filter((id) => !have.has(id));
    if (!fresh.length) continue;
    const row = (contactId: number) => ({
      campaign_id: campaign.id,
      workspace_id: campaign.workspaceId,
      contact_id: contactId,
      phone_e164: unique.get(contactId)!,
      state: "pending" as const,
      attempts: 0,
      next_attempt_at: null,
      lease_token: null,
      lease_until: null,
      last_call_id: null,
      last_outcome: null,
      skip_reason: null,
      created_at: ts,
      updated_at: ts,
    });
    try {
      await db.insertInto("campaign_contacts").values(fresh.map(row)).execute();
      added += fresh.length;
    } catch {
      // Another start / sync added some of them at the same time: one by one.
      for (const id of fresh) {
        try {
          await db.insertInto("campaign_contacts").values(row(id)).execute();
          added += 1;
        } catch {
          // Exists.
        }
      }
    }
  }
  return added;
}

export type LifecycleError = "not_found" | "status" | "empty" | "plan";

async function setStatus(campaignId: number, from: CampaignStatus[], to: CampaignStatus, extra: Partial<Pick<CampaignRow, "paused_reason" | "completed_at">> = {}): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .updateTable("campaigns")
    .set({ status: to, updated_at: now(), ...extra })
    .where("id", "=", campaignId)
    .where("status", "in", from)
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1;
}

/** Starts a draft (or restarts a finished copy's rows): loads the list members and lets the engine dial. */
export async function startCampaign(workspaceId: number, campaignId: number, actor: { type: AuditActorType; id: number | null }, allowCampaigns: boolean): Promise<{ ok: true; status: CampaignStatus; contacts: number } | { ok: false; error: LifecycleError }> {
  if (!allowCampaigns) return { ok: false, error: "plan" };
  const c = await getCampaign(workspaceId, campaignId);
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "draft") return { ok: false, error: "status" };
  await syncCampaignContacts(c);
  const db = await getDb();
  const total = Number((await db.selectFrom("campaign_contacts").select((eb) => eb.fn.countAll<number>().as("n")).where("campaign_id", "=", campaignId).executeTakeFirst())?.n ?? 0);
  if (!total) return { ok: false, error: "empty" };
  const to: CampaignStatus = c.startsAt && c.startsAt > now() ? "scheduled" : "running";
  if (!(await setStatus(campaignId, ["draft"], to, { paused_reason: null }))) return { ok: false, error: "status" };
  await auditSafe({ workspaceId, actor, action: "campaign.started", entityType: "campaign", entityId: campaignId, data: { contacts: total, purpose: c.purpose, status: to } });
  return { ok: true, status: to, contacts: total };
}

export async function pauseCampaign(workspaceId: number, campaignId: number, actor: { type: AuditActorType; id: number | null }, reason: string | null = null): Promise<boolean> {
  const c = await getCampaign(workspaceId, campaignId);
  if (!c) return false;
  const ok = await setStatus(campaignId, ["running", "scheduled"], "paused", { paused_reason: reason });
  if (ok) await auditSafe({ workspaceId, actor, action: reason ? "campaign.auto_paused" : "campaign.paused", entityType: "campaign", entityId: campaignId, data: reason ? { reason } : undefined });
  return ok;
}

/** Pauses every running or scheduled campaign of an owner's workspaces (the admin banned the account). Returns how many. */
export async function pauseOwnerCampaigns(ownerId: number, reason: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .selectFrom("campaigns as c")
    .innerJoin("workspaces as w", "w.id", "c.workspace_id")
    .select(["c.id", "c.workspace_id"])
    .where("w.owner_id", "=", ownerId)
    .where("c.status", "in", ["running", "scheduled"])
    .execute();
  let n = 0;
  for (const r of rows) if (await pauseCampaign(r.workspace_id, r.id, { type: "system", id: null }, reason)) n++;
  return n;
}

/** Resumes a paused campaign (new list members are added first). */
export async function resumeCampaign(workspaceId: number, campaignId: number, actor: { type: AuditActorType; id: number | null }, allowCampaigns: boolean): Promise<{ ok: true } | { ok: false; error: LifecycleError }> {
  if (!allowCampaigns) return { ok: false, error: "plan" };
  const c = await getCampaign(workspaceId, campaignId);
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "paused") return { ok: false, error: "status" };
  await syncCampaignContacts(c);
  const to: CampaignStatus = c.startsAt && c.startsAt > now() ? "scheduled" : "running";
  if (!(await setStatus(campaignId, ["paused"], to, { paused_reason: null }))) return { ok: false, error: "status" };
  await auditSafe({ workspaceId, actor, action: "campaign.resumed", entityType: "campaign", entityId: campaignId });
  return { ok: true };
}

/** Stops a campaign for good: waiting rows are canceled; calls in progress finish. */
export async function stopCampaign(workspaceId: number, campaignId: number, actor: { type: AuditActorType; id: number | null }): Promise<boolean> {
  const c = await getCampaign(workspaceId, campaignId);
  if (!c) return false;
  const ok = await setStatus(campaignId, ["draft", "scheduled", "running", "paused"], "canceled", { completed_at: now() });
  if (!ok) return false;
  await cancelOpenRows(campaignId);
  await auditSafe({ workspaceId, actor, action: "campaign.stopped", entityType: "campaign", entityId: campaignId });
  return true;
}

export async function cancelOpenRows(campaignId: number): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("campaign_contacts")
    .set({ state: "canceled", next_attempt_at: null, lease_token: null, lease_until: null, updated_at: now() })
    .where("campaign_id", "=", campaignId)
    .where("state", "in", ["pending", "retry"])
    .execute();
}

/** Marks a running campaign completed (the engine, once nothing is left). */
export async function completeCampaign(campaignId: number): Promise<boolean> {
  return setStatus(campaignId, ["running", "scheduled", "paused"], "completed", { completed_at: now(), paused_reason: null });
}

// ── Progress ──

export interface CampaignProgress {
  total: number;
  /** By campaign_contacts.state. */
  states: Record<CampaignContactState, number>;
  /** By the last call's outcome (completed, no_answer, busy, voicemail, failed, opt_out…). */
  outcomes: Record<string, number>;
  /** Dial attempts so far. */
  attempts: number;
  /** Rows finished (completed, failed, skipped, canceled). */
  done: number;
  /** Earliest time a waiting row is due. */
  nextAttemptAt: string | null;
}

const EMPTY_STATES: Record<CampaignContactState, number> = { pending: 0, dialing: 0, in_call: 0, retry: 0, completed: 0, failed: 0, skipped: 0, canceled: 0 };

export async function campaignProgress(campaignIds: number[]): Promise<Map<number, CampaignProgress>> {
  const out = new Map<number, CampaignProgress>();
  for (const id of campaignIds) out.set(id, { total: 0, states: { ...EMPTY_STATES }, outcomes: {}, attempts: 0, done: 0, nextAttemptAt: null });
  if (!campaignIds.length) return out;
  const db = await getDb();
  const [states, outcomes, next] = await Promise.all([
    db
      .selectFrom("campaign_contacts")
      .select(["campaign_id", "state", (eb) => eb.fn.countAll<number>().as("n"), (eb) => eb.fn.sum<number>("attempts").as("attempts")])
      .where("campaign_id", "in", campaignIds)
      .groupBy(["campaign_id", "state"])
      .execute(),
    db
      .selectFrom("campaign_contacts")
      .select(["campaign_id", "last_outcome", (eb) => eb.fn.countAll<number>().as("n")])
      .where("campaign_id", "in", campaignIds)
      .where("last_outcome", "is not", null)
      .groupBy(["campaign_id", "last_outcome"])
      .execute(),
    db
      .selectFrom("campaign_contacts")
      .select(["campaign_id", (eb) => eb.fn.min("next_attempt_at").as("next")])
      .where("campaign_id", "in", campaignIds)
      .where("state", "in", ["pending", "retry"])
      .groupBy("campaign_id")
      .execute(),
  ]);
  for (const r of states) {
    const p = out.get(r.campaign_id)!;
    const n = Number(r.n);
    p.states[r.state as CampaignContactState] = n;
    p.total += n;
    p.attempts += Number(r.attempts ?? 0);
    if (["completed", "failed", "skipped", "canceled"].includes(r.state)) p.done += n;
  }
  for (const r of outcomes) out.get(r.campaign_id)!.outcomes[r.last_outcome!] = Number(r.n);
  for (const r of next) out.get(r.campaign_id)!.nextAttemptAt = (r.next as string | null) ?? null;
  return out;
}

export interface CampaignContactView {
  id: number;
  contactId: number;
  phone: string;
  name: string;
  state: CampaignContactState;
  attempts: number;
  nextAttemptAt: string | null;
  lastOutcome: string | null;
  lastCallId: number | null;
  skipReason: string | null;
  updatedAt: string;
}

/** Rows of a campaign for the live view (filter by state), most recently changed first. */
export async function listCampaignContacts(campaignId: number, options: { state?: CampaignContactState; limit?: number; offset?: number } = {}): Promise<{ rows: CampaignContactView[]; total: number }> {
  const db = await getDb();
  let q = db.selectFrom("campaign_contacts").leftJoin("contacts", "contacts.id", "campaign_contacts.contact_id").where("campaign_contacts.campaign_id", "=", campaignId);
  if (options.state) q = q.where("campaign_contacts.state", "=", options.state);
  const [rows, count] = await Promise.all([
    q
      .select(["campaign_contacts.id", "campaign_contacts.contact_id", "campaign_contacts.phone_e164", "campaign_contacts.state", "campaign_contacts.attempts", "campaign_contacts.next_attempt_at", "campaign_contacts.last_outcome", "campaign_contacts.last_call_id", "campaign_contacts.skip_reason", "campaign_contacts.updated_at", "contacts.first_name", "contacts.last_name"])
      .orderBy("campaign_contacts.updated_at", "desc")
      .orderBy("campaign_contacts.id", "desc")
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 500))
      .offset(Math.max(0, options.offset ?? 0))
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      contactId: r.contact_id,
      phone: r.phone_e164,
      name: [r.first_name ?? "", r.last_name ?? ""].filter(Boolean).join(" "),
      state: r.state,
      attempts: Number(r.attempts),
      nextAttemptAt: r.next_attempt_at,
      lastOutcome: r.last_outcome,
      lastCallId: r.last_call_id,
      skipReason: r.skip_reason,
      updatedAt: r.updated_at,
    })),
    total: Number(count?.n ?? 0),
  };
}

/** Campaign rows of a contact (contact detail page). */
export async function contactCampaigns(workspaceId: number, contactId: number): Promise<Array<CampaignContactRow & { campaign_name: string }>> {
  const db = await getDb();
  return db
    .selectFrom("campaign_contacts")
    .innerJoin("campaigns", "campaigns.id", "campaign_contacts.campaign_id")
    .selectAll("campaign_contacts")
    .select("campaigns.name as campaign_name")
    .where("campaign_contacts.workspace_id", "=", workspaceId)
    .where("campaign_contacts.contact_id", "=", contactId)
    .orderBy("campaign_contacts.id", "desc")
    .limit(50)
    .execute();
}

/** Writes engine counters into campaigns.stats (merged). */
export async function mergeCampaignStats(campaignId: number, patch: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  const row = await db.selectFrom("campaigns").select("stats").where("id", "=", campaignId).executeTakeFirst();
  if (!row) return;
  const stats = { ...asObj(parseJson(row.stats)), ...patch };
  await db.updateTable("campaigns").set({ stats: JSON.stringify(stats) }).where("id", "=", campaignId).execute();
}

export function campaignStats(row: Pick<CampaignRow, "stats">): Record<string, unknown> {
  return asObj(parseJson(row.stats));
}

/** Running campaigns of a workspace (home page). */
export async function activeCampaigns(workspaceId: number): Promise<CampaignRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("campaigns").selectAll().where("workspace_id", "=", workspaceId).where("status", "in", ["running", "scheduled", "paused"]).orderBy("id", "desc").limit(10).execute();
  return rows.map(toCampaignRecord);
}

export const isRetryable = (v: string): v is RetryableOutcome => (RETRYABLE_OUTCOMES as readonly string[]).includes(v);
export const campaignStatusOf = (v: unknown): CampaignStatus => oneOf(["draft", "scheduled", "running", "paused", "completed", "canceled"] as const, v, "draft");
