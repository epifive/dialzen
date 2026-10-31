import "server-only";
import { audit, auditSafe, type AuditActorType } from "./audit";
import { getDb, now } from "./db";
import type { ContactListRow, ContactRow, DncEntryRow } from "./db/schema";
import {
  asObj,
  int,
  isConsentType,
  isValidTimeZone,
  normalizeCampaignPurpose,
  normalizeConsentSource,
  normalizeEmail,
  normalizeLanguageTag,
  normalizeTags,
  parseJson,
  parseJsonList,
  parsePhone,
  str,
  text,
  canonicalTimeZone,
} from "@/voice/normalize";
import { CONTACT_SOURCES, DNC_REASONS, type ConsentType, type ContactSource, type DncReason, type DncScope } from "@/voice/types";

/**
 * Contacts, contact lists, consent records and do-not-call entries of a workspace.
 *
 * - Contacts are unique per workspace and E.164 number; numbers typed without a country code use
 *   the workspace's default country.
 * - Consent records are evidence: added once, never edited, only revoked (with a reason).
 * - DNC entries: scope "workspace" (internal list, opt-outs, uploaded national lists) or "global"
 *   (the operator's list, workspace_id 0). Unique (scope, workspace_id, phone_e164).
 * - Opting out = contacts.opted_out_at + a workspace DNC entry with reason "opt_out", recorded in
 *   the audit log. Every change here is audited.
 */

export interface ContactRecord {
  id: number;
  workspaceId: number;
  phone: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  country: string;
  timezone: string;
  state: string;
  language: string;
  fields: Record<string, string>;
  tags: string[];
  source: ContactSource;
  optedOutAt: string | null;
  lastCalledAt: string | null;
  callsCount: number;
  createdAt: string;
  updatedAt: string;
}

export function toContactRecord(row: ContactRow): ContactRecord {
  const fields = asObj(parseJson(row.fields));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    phone: row.phone_e164,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    company: row.company,
    country: row.country,
    timezone: row.timezone,
    state: row.state,
    language: row.language,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v ?? "")])),
    tags: parseJsonList(row.tags),
    source: row.source,
    optedOutAt: row.opted_out_at,
    lastCalledAt: row.last_called_at,
    callsCount: Number(row.calls_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Custom fields: snake_case keys, string values, at most 30. */
export function normalizeFields(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(asObj(v))) {
    const key = k
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) continue;
    out[key] = str(val, "", 500);
    if (Object.keys(out).length >= 30) break;
  }
  return out;
}

export interface ContactInput {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  timezone?: string;
  state?: string;
  language?: string;
  fields?: unknown;
  tags?: unknown;
}

export type UpsertContactResult = { ok: true; contact: ContactRecord; created: boolean } | { ok: false; error: "invalid_phone" };

/**
 * Creates the contact, or updates the given fields of the existing one with the same number
 * (empty values don't overwrite). `defaultCountry` parses numbers typed without "+".
 */
export async function upsertContact(workspaceId: number, input: ContactInput, options: { defaultCountry: string; source: ContactSource }): Promise<UpsertContactResult> {
  const phone = parsePhone(input.phone, options.defaultCountry);
  if (!phone) return { ok: false, error: "invalid_phone" };
  const db = await getDb();
  const ts = now();
  const tz = input.timezone && isValidTimeZone(input.timezone) ? canonicalTimeZone(input.timezone) : "";
  const patch = {
    ...(input.firstName ? { first_name: str(input.firstName, "", 120) } : {}),
    ...(input.lastName ? { last_name: str(input.lastName, "", 120) } : {}),
    ...(input.email && normalizeEmail(input.email) ? { email: normalizeEmail(input.email) } : {}),
    ...(input.company ? { company: str(input.company, "", 190) } : {}),
    ...(tz ? { timezone: tz } : {}),
    ...(input.state ? { state: str(input.state, "", 8).toUpperCase() } : {}),
    ...(input.language ? { language: normalizeLanguageTag(input.language, "") } : {}),
  };
  const existing = await db.selectFrom("contacts").selectAll().where("workspace_id", "=", workspaceId).where("phone_e164", "=", phone.e164).executeTakeFirst();
  if (existing) {
    const fields = input.fields !== undefined ? { ...asObj(parseJson(existing.fields)), ...normalizeFields(input.fields) } : null;
    const tags = input.tags !== undefined ? normalizeTags([...parseJsonList(existing.tags), ...normalizeTags(input.tags)], 30) : null;
    await db
      .updateTable("contacts")
      .set({ ...patch, ...(fields ? { fields: JSON.stringify(fields) } : {}), ...(tags ? { tags: JSON.stringify(tags) } : {}), updated_at: ts })
      .where("id", "=", existing.id)
      .execute();
    return { ok: true, contact: (await getContact(workspaceId, existing.id))!, created: false };
  }
  try {
    const res = await db
      .insertInto("contacts")
      .values({
        workspace_id: workspaceId,
        phone_e164: phone.e164,
        first_name: "",
        last_name: "",
        email: "",
        company: "",
        country: phone.country,
        timezone: "",
        state: "",
        language: "",
        ...patch,
        fields: JSON.stringify(normalizeFields(input.fields)),
        tags: JSON.stringify(normalizeTags(input.tags, 30)),
        source: (CONTACT_SOURCES as readonly string[]).includes(options.source) ? options.source : "manual",
        opted_out_at: null,
        last_called_at: null,
        calls_count: 0,
        created_at: ts,
        updated_at: ts,
      })
      .executeTakeFirstOrThrow();
    return { ok: true, contact: (await getContact(workspaceId, Number(res.insertId)))!, created: true };
  } catch {
    // Created by a concurrent import: update that one instead.
    return upsertContact(workspaceId, input, options);
  }
}

export async function getContact(workspaceId: number, contactId: number): Promise<ContactRecord | undefined> {
  if (!Number.isInteger(contactId) || contactId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("contacts").selectAll().where("id", "=", contactId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toContactRecord(row) : undefined;
}

export async function findContactByPhone(workspaceId: number, e164: string): Promise<ContactRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("contacts").selectAll().where("workspace_id", "=", workspaceId).where("phone_e164", "=", e164).executeTakeFirst();
  return row ? toContactRecord(row) : undefined;
}

export interface ContactFilter {
  q?: string;
  listId?: number;
  optedOut?: boolean;
  /** Contacts with this tag (exact, case-sensitive as stored). */
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function listContacts(workspaceId: number, filter: ContactFilter = {}): Promise<{ contacts: ContactRecord[]; total: number }> {
  const db = await getDb();
  let q = db.selectFrom("contacts").where("contacts.workspace_id", "=", workspaceId);
  if (filter.listId) q = q.where("contacts.id", "in", (eb) => eb.selectFrom("list_members").select("contact_id").where("list_id", "=", filter.listId!));
  if (filter.optedOut !== undefined) q = filter.optedOut ? q.where("opted_out_at", "is not", null) : q.where("opted_out_at", "is", null);
  const tag = (filter.tag ?? "").trim().slice(0, 40).replace(/[%_\\"]/g, "");
  if (tag) q = q.where("tags", "like", `%"${tag}"%`);
  const term = (filter.q ?? "").trim().slice(0, 100).replace(/[%_\\]/g, "");
  if (term) {
    const digits = term.replace(/[^\d]/g, "");
    q = q.where((eb) =>
      eb.or([
        eb("first_name", "like", `%${term}%`),
        eb("last_name", "like", `%${term}%`),
        eb("email", "like", `%${term}%`),
        eb("company", "like", `%${term}%`),
        ...(digits.length >= 3 ? [eb("phone_e164", "like", `%${digits}%`)] : []),
      ]),
    );
  }
  const [rows, count] = await Promise.all([
    q
      .selectAll("contacts")
      .orderBy("contacts.created_at", "desc")
      .orderBy("contacts.id", "desc")
      .limit(Math.min(Math.max(filter.limit ?? 50, 1), 1000))
      .offset(Math.max(0, filter.offset ?? 0))
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return { contacts: rows.map(toContactRecord), total: Number(count?.n ?? 0) };
}

/** Deletes a contact, its list memberships and campaign rows that haven't been dialed. Consent and DNC records are kept (evidence). */
export async function deleteContact(workspaceId: number, contactId: number, userId: number | null): Promise<boolean> {
  const db = await getDb();
  const contact = await getContact(workspaceId, contactId);
  if (!contact) return false;
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("list_members").where("contact_id", "=", contactId).execute();
    await trx.deleteFrom("campaign_contacts").where("contact_id", "=", contactId).where("state", "=", "pending").execute();
    await trx.deleteFrom("contacts").where("id", "=", contactId).execute();
  });
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "contact.deleted", entityType: "contact", entityId: contactId, data: { phone: contact.phone } });
  return true;
}

// ── Lists ──

export interface ContactList {
  id: number;
  name: string;
  description: string;
  members: number;
  createdAt: string;
}

export async function listContactLists(workspaceId: number): Promise<ContactList[]> {
  const db = await getDb();
  const [lists, counts] = await Promise.all([
    db.selectFrom("contact_lists").selectAll().where("workspace_id", "=", workspaceId).orderBy("name").execute(),
    db.selectFrom("list_members").select(["list_id", (eb) => eb.fn.countAll<number>().as("n")]).where("workspace_id", "=", workspaceId).groupBy("list_id").execute(),
  ]);
  const byList = new Map(counts.map((c) => [c.list_id, Number(c.n)]));
  return lists.map((l: ContactListRow) => ({ id: l.id, name: l.name, description: l.description, members: byList.get(l.id) ?? 0, createdAt: l.created_at }));
}

export async function createContactList(workspaceId: number, name: string, description = ""): Promise<number> {
  const db = await getDb();
  const ts = now();
  const res = await db
    .insertInto("contact_lists")
    .values({ workspace_id: workspaceId, name: str(name, "List", 120) || "List", description: str(description, "", 500), created_at: ts, updated_at: ts })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}

/** Adds contacts to a list (other workspaces' contacts and existing members are skipped). Returns how many were added. */
export async function addToList(workspaceId: number, listId: number, contactIds: number[]): Promise<number> {
  const db = await getDb();
  const list = await db.selectFrom("contact_lists").select("id").where("id", "=", listId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!list || !contactIds.length) return 0;
  let added = 0;
  const ts = now();
  for (let i = 0; i < contactIds.length; i += 500) {
    const chunk = contactIds.slice(i, i + 500);
    const valid = (await db.selectFrom("contacts").select("id").where("workspace_id", "=", workspaceId).where("id", "in", chunk).execute()).map((r) => r.id);
    const present = new Set((await db.selectFrom("list_members").select("contact_id").where("list_id", "=", listId).where("contact_id", "in", valid.length ? valid : [0]).execute()).map((r) => r.contact_id));
    const fresh = valid.filter((id) => !present.has(id));
    if (fresh.length) await db.insertInto("list_members").values(fresh.map((contact_id) => ({ list_id: listId, contact_id, workspace_id: workspaceId, added_at: ts }))).execute();
    added += fresh.length;
  }
  return added;
}

export async function removeFromList(workspaceId: number, listId: number, contactIds: number[]): Promise<void> {
  if (!contactIds.length) return;
  const db = await getDb();
  await db.deleteFrom("list_members").where("workspace_id", "=", workspaceId).where("list_id", "=", listId).where("contact_id", "in", contactIds).execute();
}

export async function deleteContactList(workspaceId: number, listId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.transaction().execute(async (trx) => {
    const del = await trx.deleteFrom("contact_lists").where("id", "=", listId).where("workspace_id", "=", workspaceId).executeTakeFirst();
    if (Number(del.numDeletedRows)) await trx.deleteFrom("list_members").where("list_id", "=", listId).execute();
    return Number(del.numDeletedRows) > 0;
  });
  return res;
}

// ── Consent ──

export interface ConsentInput {
  type: ConsentType;
  purpose?: string;
  source?: string;
  sourceUrl?: string;
  /** ISO time the person gave consent ("" = now). */
  capturedAt?: string;
  ip?: string;
  userAgent?: string;
  /** The exact wording they agreed to. */
  textSnapshot: string;
  expiresAt?: string | null;
}

export type AddConsentResult = { ok: true; id: number } | { ok: false; error: "type" | "text" | "contact" };

/** Records a consent (append-only evidence) and audits it. */
export async function addConsent(workspaceId: number, contactId: number, input: ConsentInput, actor: { type: AuditActorType; id: number | null }): Promise<AddConsentResult> {
  if (!isConsentType(input.type)) return { ok: false, error: "type" };
  const snapshot = text(input.textSnapshot, 5000);
  if (snapshot.length < 10) return { ok: false, error: "text" };
  const contact = await getContact(workspaceId, contactId);
  if (!contact) return { ok: false, error: "contact" };
  const captured = input.capturedAt && Number.isFinite(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : now();
  const expires = input.expiresAt && Number.isFinite(Date.parse(input.expiresAt)) ? new Date(input.expiresAt).toISOString() : null;
  const purpose = input.purpose === "any" || !input.purpose ? "any" : normalizeCampaignPurpose(input.purpose);
  const db = await getDb();
  const id = await db.transaction().execute(async (trx) => {
    const res = await trx
      .insertInto("consents")
      .values({
        workspace_id: workspaceId,
        contact_id: contactId,
        phone_e164: contact.phone,
        type: input.type,
        purpose,
        source: normalizeConsentSource(input.source),
        source_url: str(input.sourceUrl, "", 1000),
        captured_at: captured,
        ip: str(input.ip, "", 64),
        user_agent: str(input.userAgent, "", 255),
        text_snapshot: snapshot,
        expires_at: expires,
        revoked_at: null,
        revoked_reason: null,
        created_by: actor.type === "user" ? actor.id : null,
        created_at: now(),
      })
      .executeTakeFirstOrThrow();
    const consentId = Number(res.insertId);
    await audit({ workspaceId, actor, action: "consent.added", entityType: "consent", entityId: consentId, data: { contact: contactId, phone: contact.phone, type: input.type, purpose, source: input.source ?? "other" } }, trx);
    return consentId;
  });
  return { ok: true, id };
}

/** Revokes a consent (it stays as evidence with the revocation time and reason). */
export async function revokeConsent(workspaceId: number, consentId: number, reason: string, actor: { type: AuditActorType; id: number | null }): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .updateTable("consents")
    .set({ revoked_at: now(), revoked_reason: str(reason, "", 255) || "revoked" })
    .where("id", "=", consentId)
    .where("workspace_id", "=", workspaceId)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  const ok = Number(res.numUpdatedRows) === 1;
  if (ok) await auditSafe({ workspaceId, actor, action: "consent.revoked", entityType: "consent", entityId: consentId, data: { reason } });
  return ok;
}

// ── Do-not-call ──

export interface DncInput {
  scope: DncScope;
  /** Ignored for "global" (0). */
  workspaceId: number;
  phone: string;
  reason: DncReason;
  source?: string;
  listRef?: string;
  note?: string;
  expiresAt?: string | null;
  createdBy?: number | null;
}

/** Adds a number to a DNC list (idempotent: an existing entry is kept). Returns false for an invalid number. */
export async function addDnc(input: DncInput, actor: { type: AuditActorType; id: number | null } = { type: "system", id: null }): Promise<boolean> {
  const phone = parsePhone(input.phone);
  if (!phone) return false;
  const workspaceId = input.scope === "global" ? 0 : input.workspaceId;
  const db = await getDb();
  const exists = await db.selectFrom("dnc_entries").select("id").where("scope", "=", input.scope).where("workspace_id", "=", workspaceId).where("phone_e164", "=", phone.e164).executeTakeFirst();
  if (exists) return true;
  try {
    await db
      .insertInto("dnc_entries")
      .values({
        scope: input.scope,
        workspace_id: workspaceId,
        phone_e164: phone.e164,
        reason: (DNC_REASONS as readonly string[]).includes(input.reason) ? input.reason : "manual",
        source: str(input.source, "", 60),
        list_ref: str(input.listRef, "", 120),
        note: str(input.note, "", 500),
        expires_at: input.expiresAt ?? null,
        created_by: input.createdBy ?? null,
        created_at: now(),
      })
      .execute();
  } catch {
    return true; // Added concurrently.
  }
  await auditSafe({ workspaceId: input.scope === "global" ? null : workspaceId, actor, action: "dnc.added", entityType: "dnc", entityId: phone.e164, data: { scope: input.scope, reason: input.reason, source: input.source ?? "" } });
  return true;
}

export async function removeDnc(scope: DncScope, workspaceId: number, phone: string, actor: { type: AuditActorType; id: number | null }): Promise<boolean> {
  const p = parsePhone(phone);
  if (!p) return false;
  const ws = scope === "global" ? 0 : workspaceId;
  const db = await getDb();
  const res = await db.deleteFrom("dnc_entries").where("scope", "=", scope).where("workspace_id", "=", ws).where("phone_e164", "=", p.e164).executeTakeFirst();
  const ok = Number(res.numDeletedRows) > 0;
  if (ok) await auditSafe({ workspaceId: scope === "global" ? null : workspaceId, actor, action: "dnc.removed", entityType: "dnc", entityId: p.e164, data: { scope } });
  return ok;
}

export async function listDnc(scope: DncScope, workspaceId: number, options: { q?: string; limit?: number; offset?: number } = {}): Promise<{ entries: DncEntryRow[]; total: number }> {
  const db = await getDb();
  let q = db.selectFrom("dnc_entries").where("scope", "=", scope).where("workspace_id", "=", scope === "global" ? 0 : workspaceId);
  const digits = (options.q ?? "").replace(/[^\d]/g, "").slice(0, 15);
  if (digits) q = q.where("phone_e164", "like", `%${digits}%`);
  const [entries, count] = await Promise.all([
    q
      .selectAll()
      .orderBy("id", "desc")
      .limit(int(options.limit, 50, 1, 1000))
      .offset(Math.max(0, options.offset ?? 0))
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return { entries, total: Number(count?.n ?? 0) };
}

/**
 * The person asked not to be called again (detected in a call, said to the team, or by API):
 * marks the contact, adds a workspace DNC entry with reason "opt_out" and audits it.
 */
export async function recordOptOut(workspaceId: number, phone: string, source: string, actor: { type: AuditActorType; id: number | null }, detail: Record<string, unknown> = {}): Promise<boolean> {
  const p = parsePhone(phone);
  if (!p) return false;
  const db = await getDb();
  const ts = now();
  await db.updateTable("contacts").set({ opted_out_at: ts, updated_at: ts }).where("workspace_id", "=", workspaceId).where("phone_e164", "=", p.e164).where("opted_out_at", "is", null).execute();
  await addDnc({ scope: "workspace", workspaceId, phone: p.e164, reason: "opt_out", source }, actor);
  // An opt-out revokes consent to be called (records stay as evidence; a recording consent is not about calling).
  const revoked = await db
    .updateTable("consents")
    .set({ revoked_at: ts, revoked_reason: `opt_out: ${source}`.slice(0, 255) })
    .where("workspace_id", "=", workspaceId)
    .where("phone_e164", "=", p.e164)
    .where("revoked_at", "is", null)
    .where("type", "!=", "recording")
    .executeTakeFirst();
  await auditSafe({ workspaceId, actor, action: "opt_out.recorded", entityType: "contact", entityId: p.e164, data: { source, revoked: Number(revoked.numUpdatedRows ?? 0), ...detail } });
  return true;
}

/** Normalises a stored purpose for display ("any", "informational", "telemarketing"). */
export function consentPurposeLabel(purpose: string): "any" | "informational" | "telemarketing" {
  return purpose === "informational" || purpose === "telemarketing" ? purpose : "any";
}

