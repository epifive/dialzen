import "server-only";
import { auditSafe } from "./audit";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb, now } from "./db";
import type { PhoneNumberRow } from "./db/schema";
import { atLimit, type Entitlements } from "./plans";
import { ownedWorkspaceIds } from "./workspaces";
import { asObj, int, isProvider, parsePhone, str, localDay, zonedTimeToUtc } from "@/voice/normalize";
import { CARRIERS, type Carrier, type KycStatus, type NumberStatus, type ProviderId } from "@/voice/types";

/**
 * Phone numbers of a workspace: bought through a provider (Retell US/CA) or imported (Twilio,
 * SIP trunk, Exotel…) into the provider that runs the agents. A number is active in at most one
 * workspace at a time. Carrier credentials (Twilio SID/token, SIP login) are stored encrypted.
 *
 * Limits: the owner's plan max_numbers counts numbers that aren't released, across all the
 * workspaces the owner owns (0 = browser test calls only).
 */

export interface NumberRecord {
  id: number;
  workspaceId: number;
  e164: string;
  country: string;
  label: string;
  provider: ProviderId;
  carrier: Carrier;
  providerNumberId: string | null;
  hasCredentials: boolean;
  inboundAgentId: number | null;
  outboundAgentId: number | null;
  outboundEnabled: boolean;
  kycStatus: KycStatus;
  dailyDialCap: number;
  monthlyPriceMicros: number;
  status: NumberStatus;
  lastError: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const CRED_PURPOSE = "number-credentials";

export function toNumberRecord(row: PhoneNumberRow): NumberRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    e164: row.e164,
    country: row.country,
    label: row.label,
    provider: isProvider(row.provider) ? row.provider : "simulated",
    carrier: (CARRIERS as readonly string[]).includes(row.carrier) ? (row.carrier as Carrier) : "sip",
    providerNumberId: row.provider_number_id,
    hasCredentials: Boolean(row.credentials),
    inboundAgentId: row.inbound_agent_id,
    outboundAgentId: row.outbound_agent_id,
    outboundEnabled: row.outbound_enabled === 1,
    kycStatus: row.kyc_status,
    dailyDialCap: Number(row.daily_dial_cap),
    monthlyPriceMicros: Number(row.monthly_price_micros),
    status: row.status,
    lastError: row.last_error,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Numbers of a workspace (released ones last, only when asked for). */
export async function listNumbers(workspaceId: number, options: { includeReleased?: boolean } = {}): Promise<NumberRecord[]> {
  const db = await getDb();
  let q = db.selectFrom("phone_numbers").selectAll().where("workspace_id", "=", workspaceId);
  if (!options.includeReleased) q = q.where("status", "!=", "released");
  return (await q.orderBy("created_at").execute()).map(toNumberRecord);
}

export async function getNumber(workspaceId: number, numberId: number): Promise<NumberRecord | undefined> {
  if (!Number.isInteger(numberId) || numberId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("phone_numbers").selectAll().where("id", "=", numberId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toNumberRecord(row) : undefined;
}

/** The workspace number that owns an E.164 number right now (inbound routing), any workspace. */
export async function findActiveNumber(e164: string): Promise<NumberRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("phone_numbers").selectAll().where("e164", "=", e164).where("status", "in", ["active", "pending"]).orderBy("id", "desc").executeTakeFirst();
  return row ? toNumberRecord(row) : undefined;
}

/** A number by the provider's id (webhook routing). */
export async function findNumberByProviderId(provider: string, providerNumberId: string): Promise<NumberRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("phone_numbers").selectAll().where("provider", "=", provider).where("provider_number_id", "=", providerNumberId).where("status", "!=", "released").executeTakeFirst();
  return row ? toNumberRecord(row) : undefined;
}

/** Numbers that aren't released, across all the workspaces the owner owns (the plan's max_numbers). */
export async function countOwnerNumbers(ownerId: number): Promise<number> {
  const ids = await ownedWorkspaceIds(ownerId);
  if (!ids.length) return 0;
  const db = await getDb();
  const row = await db.selectFrom("phone_numbers").select((eb) => eb.fn.countAll<number>().as("n")).where("workspace_id", "in", ids).where("status", "!=", "released").executeTakeFirst();
  return Number(row?.n ?? 0);
}

export interface NumberInput {
  e164: string;
  provider: string;
  carrier: string;
  label?: string;
  providerNumberId?: string | null;
  /** Carrier credentials (Twilio SID/token, SIP login): stored encrypted, never shown again. */
  credentials?: Record<string, string> | null;
  status?: NumberStatus;
  kycStatus?: KycStatus;
  dailyDialCap?: number;
  monthlyPriceMicros?: number;
}

export type AddNumberResult = { ok: true; number: NumberRecord } | { ok: false; error: "limit" | "invalid" | "taken" | "provider"; used?: number; limit?: number };

/** Adds a number to a workspace after the provider bought or imported it (plan limit checked). */
export async function addNumber(workspace: { id: number; ownerId: number }, entitlements: Pick<Entitlements, "maxNumbers">, input: NumberInput, userId: number | null): Promise<AddNumberResult> {
  const phone = parsePhone(input.e164);
  if (!phone) return { ok: false, error: "invalid" };
  if (!isProvider(input.provider) || !(CARRIERS as readonly string[]).includes(input.carrier)) return { ok: false, error: "provider" };
  const used = await countOwnerNumbers(workspace.ownerId);
  if (atLimit(used, entitlements.maxNumbers)) return { ok: false, error: "limit", used, limit: entitlements.maxNumbers };
  const taken = await findActiveNumber(phone.e164);
  if (taken) return { ok: false, error: "taken" };
  const db = await getDb();
  const ts = now();
  const credentials = input.credentials && Object.keys(input.credentials).length ? await encryptSecret(JSON.stringify(input.credentials), CRED_PURPOSE) : "";
  // A number released earlier in this workspace is reused (unique workspace + number).
  const old = await db.selectFrom("phone_numbers").select("id").where("workspace_id", "=", workspace.id).where("e164", "=", phone.e164).executeTakeFirst();
  const values = {
    country: phone.country,
    label: str(input.label, "", 120),
    provider: input.provider,
    carrier: input.carrier,
    provider_number_id: input.providerNumberId ?? null,
    credentials,
    inbound_agent_id: null,
    outbound_agent_id: null,
    outbound_enabled: 0,
    kyc_status: input.kycStatus ?? "not_required",
    daily_dial_cap: int(input.dailyDialCap, 100, 1, 10_000),
    monthly_price_micros: Math.max(0, Math.round(input.monthlyPriceMicros ?? 0)),
    status: input.status ?? "active",
    last_error: null,
    released_at: null,
    updated_at: ts,
  } as const;
  let id: number;
  if (old) {
    await db.updateTable("phone_numbers").set(values).where("id", "=", old.id).execute();
    id = old.id;
  } else {
    const res = await db
      .insertInto("phone_numbers")
      .values({ workspace_id: workspace.id, e164: phone.e164, ...values, created_by: userId, created_at: ts })
      .executeTakeFirstOrThrow();
    id = Number(res.insertId);
  }
  await auditSafe({ workspaceId: workspace.id, actor: { type: "user", id: userId }, action: "number.added", entityType: "number", entityId: id, data: { e164: phone.e164, provider: input.provider, carrier: input.carrier } });
  return { ok: true, number: (await getNumber(workspace.id, id))! };
}

export async function updateNumber(
  workspaceId: number,
  numberId: number,
  patch: Partial<{ label: string; inboundAgentId: number | null; outboundAgentId: number | null; outboundEnabled: boolean; dailyDialCap: number; status: NumberStatus; kycStatus: KycStatus; providerNumberId: string | null; lastError: string | null }>,
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("phone_numbers")
    .set({
      ...(patch.label !== undefined ? { label: str(patch.label, "", 120) } : {}),
      ...(patch.inboundAgentId !== undefined ? { inbound_agent_id: patch.inboundAgentId } : {}),
      ...(patch.outboundAgentId !== undefined ? { outbound_agent_id: patch.outboundAgentId } : {}),
      ...(patch.outboundEnabled !== undefined ? { outbound_enabled: patch.outboundEnabled ? 1 : 0 } : {}),
      ...(patch.dailyDialCap !== undefined ? { daily_dial_cap: int(patch.dailyDialCap, 100, 1, 10_000) } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.kycStatus !== undefined ? { kyc_status: patch.kycStatus } : {}),
      ...(patch.providerNumberId !== undefined ? { provider_number_id: patch.providerNumberId } : {}),
      ...(patch.lastError !== undefined ? { last_error: patch.lastError ? patch.lastError.slice(0, 1000) : null } : {}),
      updated_at: now(),
    })
    .where("id", "=", numberId)
    .where("workspace_id", "=", workspaceId)
    .execute();
}

/** Marks a number released (after the provider released it); it stops counting against the plan. */
export async function markNumberReleased(workspaceId: number, numberId: number, userId: number | null): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db
    .updateTable("phone_numbers")
    .set({ status: "released", released_at: ts, inbound_agent_id: null, outbound_agent_id: null, outbound_enabled: 0, credentials: "", updated_at: ts })
    .where("id", "=", numberId)
    .where("workspace_id", "=", workspaceId)
    .execute();
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "number.released", entityType: "number", entityId: numberId });
}

/** The decrypted carrier credentials of a number ({} when none or unreadable). */
export async function numberCredentials(numberId: number): Promise<Record<string, string>> {
  const db = await getDb();
  const row = await db.selectFrom("phone_numbers").select("credentials").where("id", "=", numberId).executeTakeFirst();
  if (!row?.credentials) return {};
  try {
    const o = asObj(JSON.parse(await decryptSecret(row.credentials, CRED_PURPOSE)));
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}

/** Outbound calls placed from a number since local midnight in `timezone` (per-number daily dial cap). */
export async function dialsToday(numberId: number, timezone: string, nowMs = Date.now()): Promise<number> {
  const [y, m, d] = localDay(nowMs, timezone).split("-").map(Number);
  const start = new Date(zonedTimeToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, timezone)).toISOString();
  const db = await getDb();
  const row = await db
    .selectFrom("calls")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("number_id", "=", numberId)
    .where("direction", "=", "outbound")
    .where("created_at", ">=", start)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
