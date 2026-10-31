import "server-only";
import { auditSafe, type AuditActorType } from "./audit";
import { parseCsvRecords } from "./csv";
import { getDb, now } from "./db";
import type { DncEntryRow } from "./db/schema";
import { chunk } from "./jobs/shared";
import { parsePhone, str } from "@/voice/normalize";
import { DNC_REASONS, type DncReason, type DncScope } from "@/voice/types";

/**
 * Do-not-call lists beyond single entries (src/lib/contacts.ts): bulk uploads of national DNC /
 * TPS extracts and internal lists, the opt-out register with its 10-business-day deadline, and
 * the expiry of entries that have an end date (national-list copies must be refreshed; the
 * campaign engine already ignores expired entries).
 */

/** Numbers per upload. */
export const MAX_DNC_UPLOAD = 50_000;

/** National DNC copies are only a safe harbour while fresh (US: 31 days), so uploads expire by default. */
export const NATIONAL_LIST_DAYS = 31;

/** Phone numbers from pasted text or a CSV/TXT file: the first cell of each line that parses. */
export function parsePhoneList(input: string, defaultCountry: string, max = MAX_DNC_UPLOAD): { phones: string[]; invalid: number; duplicates: number } {
  const records = parseCsvRecords(input.slice(0, 2_000_000));
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const record of records) {
    const cell = record.find((c) => /\d{6,}/.test(c.replace(/\D/g, ""))) ?? record[0] ?? "";
    const p = parsePhone(cell, defaultCountry);
    if (!p) {
      // A header line ("phone", "number") is not an error.
      if (/[a-z]/i.test(cell) && seen.size === 0 && invalid === 0) continue;
      invalid += 1;
      continue;
    }
    if (seen.has(p.e164)) {
      duplicates += 1;
      continue;
    }
    seen.add(p.e164);
    if (seen.size >= max) break;
  }
  return { phones: [...seen], invalid, duplicates };
}

export interface DncBulkInput {
  scope: DncScope;
  workspaceId: number;
  phones: string[];
  reason: DncReason;
  source: string;
  listRef?: string;
  note?: string;
  expiresAt?: string | null;
  actor: { type: AuditActorType; id: number | null };
}

/** Adds E.164 numbers to a DNC list in batches (existing entries are kept as they are). One audit entry per upload. */
export async function addDncBulk(input: DncBulkInput): Promise<{ added: number; existing: number }> {
  const ws = input.scope === "global" ? 0 : input.workspaceId;
  const reason = (DNC_REASONS as readonly string[]).includes(input.reason) ? input.reason : "manual";
  const db = await getDb();
  const ts = now();
  let added = 0;
  let existing = 0;
  for (const part of chunk(input.phones, 400)) {
    const have = new Set((await db.selectFrom("dnc_entries").select("phone_e164").where("scope", "=", input.scope).where("workspace_id", "=", ws).where("phone_e164", "in", part).execute()).map((r) => r.phone_e164));
    existing += have.size;
    const fresh = part.filter((p) => !have.has(p));
    if (!fresh.length) continue;
    const row = (phone: string) => ({
      scope: input.scope,
      workspace_id: ws,
      phone_e164: phone,
      reason,
      source: str(input.source, "", 60),
      list_ref: str(input.listRef, "", 120),
      note: str(input.note, "", 500),
      expires_at: input.expiresAt ?? null,
      created_by: input.actor.type === "user" || input.actor.type === "admin" ? input.actor.id : null,
      created_at: ts,
    });
    try {
      await db.insertInto("dnc_entries").values(fresh.map(row)).execute();
      added += fresh.length;
    } catch {
      for (const phone of fresh) {
        try {
          await db.insertInto("dnc_entries").values(row(phone)).execute();
          added += 1;
        } catch {
          existing += 1;
        }
      }
    }
  }
  await auditSafe({
    workspaceId: input.scope === "global" ? null : input.workspaceId,
    actor: input.actor,
    action: "dnc.uploaded",
    entityType: "dnc",
    entityId: str(input.listRef, "", 64),
    data: { scope: input.scope, reason, added, existing, expires: input.expiresAt ?? null },
  });
  return { added, existing };
}

/** The date `n` business days (Monday–Friday) after an instant: when an opt-out must be honoured at the latest. */
export function businessDaysAfter(iso: string, n: number): string {
  const d = new Date(iso);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d.toISOString();
}

export interface OptOutRecord {
  phone: string;
  contactId: number | null;
  name: string;
  source: string;
  /** When the person revoked consent / asked not to be called. */
  at: string;
  /** The legal deadline to honour it (10 business days); the campaign engine applies it at once. */
  honourBy: string;
  revokedConsents: number;
}

/** Opt-outs of a workspace, newest first. */
export async function listOptOuts(workspaceId: number, options: { limit?: number; offset?: number; q?: string } = {}): Promise<{ items: OptOutRecord[]; total: number }> {
  const db = await getDb();
  let q = db.selectFrom("dnc_entries").where("scope", "=", "workspace").where("workspace_id", "=", workspaceId).where("reason", "=", "opt_out");
  const digits = (options.q ?? "").replace(/\D/g, "").slice(0, 15);
  if (digits) q = q.where("phone_e164", "like", `%${digits}%`);
  const [rows, count] = await Promise.all([
    q
      .selectAll()
      .orderBy("id", "desc")
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 500))
      .offset(Math.max(0, options.offset ?? 0))
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  const phones = rows.map((r) => r.phone_e164);
  const contacts = phones.length ? await db.selectFrom("contacts").select(["id", "phone_e164", "first_name", "last_name"]).where("workspace_id", "=", workspaceId).where("phone_e164", "in", phones).execute() : [];
  const revoked = phones.length
    ? await db
        .selectFrom("consents")
        .select(["phone_e164", (eb) => eb.fn.countAll<number>().as("n")])
        .where("workspace_id", "=", workspaceId)
        .where("phone_e164", "in", phones)
        .where("revoked_at", "is not", null)
        .groupBy("phone_e164")
        .execute()
    : [];
  const byPhone = new Map(contacts.map((c) => [c.phone_e164, c]));
  const revokedBy = new Map(revoked.map((r) => [r.phone_e164, Number(r.n)]));
  return {
    items: rows.map((r: DncEntryRow) => {
      const c = byPhone.get(r.phone_e164);
      return {
        phone: r.phone_e164,
        contactId: c?.id ?? null,
        name: c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "",
        source: r.source,
        at: r.created_at,
        honourBy: businessDaysAfter(r.created_at, 10),
        revokedConsents: revokedBy.get(r.phone_e164) ?? 0,
      };
    }),
    total: Number(count?.n ?? 0),
  };
}

/** DNC status of one number in a workspace (workspace list and the platform's global list). */
export async function dncStatus(workspaceId: number, phone: string): Promise<{ workspace: DncEntryRow | null; global: DncEntryRow | null }> {
  const p = parsePhone(phone);
  if (!p) return { workspace: null, global: null };
  const db = await getDb();
  const nowIso = now();
  const rows = await db
    .selectFrom("dnc_entries")
    .selectAll()
    .where("phone_e164", "=", p.e164)
    .where((eb) => eb.or([eb.and([eb("scope", "=", "workspace"), eb("workspace_id", "=", workspaceId)]), eb("scope", "=", "global")]))
    .execute();
  const live = rows.filter((r) => !r.expires_at || r.expires_at > nowIso);
  return { workspace: live.find((r) => r.scope === "workspace") ?? null, global: live.find((r) => r.scope === "global") ?? null };
}

/** Counts of a workspace's DNC list by reason (live entries). */
export async function dncCounts(scope: DncScope, workspaceId: number): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .selectFrom("dnc_entries")
    .select(["reason", (eb) => eb.fn.countAll<number>().as("n")])
    .where("scope", "=", scope)
    .where("workspace_id", "=", scope === "global" ? 0 : workspaceId)
    .groupBy("reason")
    .execute();
  return Object.fromEntries(rows.map((r) => [r.reason, Number(r.n)]));
}

/** Deletes DNC entries whose end date passed (expiry job). Returns the deleted entries per workspace (0 = global). */
export async function expireDncEntries(limit = 2000): Promise<Map<number, number>> {
  const db = await getDb();
  const nowIso = now();
  const rows = await db.selectFrom("dnc_entries").select(["id", "workspace_id"]).where("expires_at", "is not", null).where("expires_at", "<=", nowIso).orderBy("id").limit(limit).execute();
  const out = new Map<number, number>();
  for (const part of chunk(rows, 400)) {
    await db
      .deleteFrom("dnc_entries")
      .where(
        "id",
        "in",
        part.map((r) => r.id),
      )
      .execute();
    for (const r of part) out.set(r.workspace_id, (out.get(r.workspace_id) ?? 0) + 1);
  }
  for (const [ws, n] of out) await auditSafe({ workspaceId: ws === 0 ? null : ws, actor: { type: "system", id: null }, action: "dnc.expired", entityType: "dnc", data: { entries: n } });
  return out;
}
