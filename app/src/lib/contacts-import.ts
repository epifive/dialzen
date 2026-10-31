import "server-only";
import { auditSafe } from "./audit";
import { normalizeFields } from "./contacts";
import { parseCsv } from "./csv";
import { type ImportField, type ImportMapping } from "./import-fields";
import { getDb, now } from "./db";
import { chunk } from "./jobs/shared";
import { canonicalTimeZone, isValidTimeZone, normalizeEmail, normalizeLanguageTag, normalizeTags, parseJson, parseJsonList, parsePhone, str, text, asObj } from "@/voice/normalize";
import type { CampaignPurpose, ConsentSource, ConsentType } from "@/voice/types";

/**
 * CSV import of contacts with their consent records, in two steps: a dry run that returns a
 * validation report (invalid numbers, duplicates in the file, numbers already in the workspace,
 * do-not-call hits, consent problems), then the import itself.
 *
 * Consent columns (one consent per row): type ("express written" / "express" / "existing
 * customer" / "none", or pewc / pec / ai_voice / marketing), source, captured at, IP, the consent
 * wording (text snapshot), the form URL and the purpose. Consent records are evidence: the import
 * adds new ones, it never changes existing ones.
 */

/** Rows per import (a bigger file is split into several imports). */
export const MAX_IMPORT_ROWS = 10_000;
/** CSV text per import, in characters (the Server Action body limit is 5 MB). */
export const MAX_IMPORT_CHARS = 4_500_000;

/** Consent types written the way people write them in spreadsheets. null = none, "invalid" = unknown. */
export function parseConsentType(raw: string): { type: ConsentType; purpose: CampaignPurpose | "any"; ebr: boolean } | null | "invalid" {
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!k || ["none", "no", "n", "false", "noconsent", "na"].includes(k)) return null;
  if (["pewc", "expresswritten", "expresswrittenconsent", "priorexpresswrittenconsent", "written", "writtenconsent"].includes(k)) return { type: "pewc", purpose: "any", ebr: false };
  if (["pec", "express", "expressconsent", "priorexpressconsent", "yes", "y", "true"].includes(k)) return { type: "pec", purpose: "any", ebr: false };
  // An existing business relationship covers informational calls only (not AI-voice telemarketing).
  if (["existingcustomer", "customer", "ebr", "existingbusinessrelationship", "existingrelationship"].includes(k)) return { type: "pec", purpose: "informational", ebr: true };
  if (["aivoice", "ai", "automated", "automatedcalls", "artificialvoice"].includes(k)) return { type: "ai_voice", purpose: "any", ebr: false };
  if (["marketing", "marketingconsent", "optin", "gdpr"].includes(k)) return { type: "marketing", purpose: "any", ebr: false };
  if (k === "recording") return { type: "recording", purpose: "any", ebr: false };
  return "invalid";
}

function parseConsentSource(raw: string, fallback: ConsentSource): ConsentSource {
  const k = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return fallback;
  if (/web|form|site|landing|online/.test(k)) return "web_form";
  if (/verbal|phone|call|recorded/.test(k)) return k.includes("inbound") ? "inbound_call" : "verbal";
  if (/paper|signed|written|contract/.test(k)) return "paper";
  if (k === "api") return "api";
  if (k === "csv" || k === "import") return "csv";
  return "other";
}

function parsePurpose(raw: string, fallback: CampaignPurpose | "any"): CampaignPurpose | "any" {
  const k = raw.toLowerCase();
  if (/market|sales|promo|tele/.test(k)) return "telemarketing";
  if (/info|service|remind|transact|account/.test(k)) return "informational";
  if (/any|all|both/.test(k)) return "any";
  return fallback;
}

/** A consent date: ISO, "YYYY-MM-DD[ HH:MM]" (UTC) or anything Date.parse understands. null = invalid. */
export function parseConsentDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)) : Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  // Consent can't be given in the future (a minute of clock skew is fine) or before 1990.
  if (ms > Date.now() + 60_000 || ms < Date.UTC(1990, 0, 1)) return null;
  return new Date(ms).toISOString();
}

export type ImportProblem = "invalid_phone" | "duplicate" | "dnc_workspace" | "dnc_global" | "opted_out" | "consent_type" | "consent_text" | "consent_date" | "consent_date_required" | "consent_date_missing" | "timezone";

export interface ImportIssue {
  /** 1-based line of the CSV file (the header is line 1). */
  line: number;
  value: string;
  problem: ImportProblem;
}

export interface ImportRecord {
  line: number;
  phone: string;
  country: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  timezone: string;
  state: string;
  language: string;
  tags: string[];
  fields: Record<string, string>;
  consent: { type: ConsentType; purpose: CampaignPurpose | "any"; source: ConsentSource; sourceUrl: string; capturedAt: string; ip: string; textSnapshot: string; ebr: boolean } | null;
  dnc: "workspace" | "global" | null;
  optedOut: boolean;
  exists: boolean;
}

export interface ImportReport {
  rows: number;
  /** Rows that will be imported (new + updated). */
  valid: number;
  created: number;
  updated: number;
  invalid: number;
  duplicates: number;
  dncWorkspace: number;
  dncGlobal: number;
  optedOut: number;
  /** Rows with a valid consent record. */
  withConsent: number;
  consentProblems: number;
  /** Rows skipped because they are on a DNC list (option skipDnc). */
  skipped: number;
  truncated: boolean;
  /** At most 200 issues, in file order. */
  issues: ImportIssue[];
  /** The first rows as they will be imported. */
  preview: Array<Pick<ImportRecord, "line" | "phone" | "firstName" | "lastName" | "email" | "timezone"> & { consent: ConsentType | null; status: "new" | "update" | "dnc" | "opted_out" }>;
}

export interface ImportOptions {
  defaultCountry: string;
  /** Used when a row has a consent type but the file has no consent wording column. */
  defaultConsentText?: string;
  /** Consent source when the file doesn't say ("csv"). */
  defaultConsentSource?: ConsentSource;
  /** Don't import numbers that are on a DNC list or opted out (default true). */
  skipDnc?: boolean;
  /** Tags added to every imported contact. */
  tags?: string[];
}

const MAX_ISSUES = 200;

export { IMPORT_FIELDS, suggestMapping, type ImportField, type ImportMapping } from "./import-fields";

/** Reads and checks the rows (no writes). The records come back for runImport(). */
export async function analyzeImport(workspaceId: number, csv: string, mapping: ImportMapping, options: ImportOptions): Promise<{ report: ImportReport; records: ImportRecord[]; headers: string[] }> {
  const parsed = parseCsv(csv.slice(0, MAX_IMPORT_CHARS), MAX_IMPORT_ROWS);
  const report: ImportReport = { rows: parsed.rows.length, valid: 0, created: 0, updated: 0, invalid: 0, duplicates: 0, dncWorkspace: 0, dncGlobal: 0, optedOut: 0, withConsent: 0, consentProblems: 0, skipped: 0, truncated: parsed.truncated || csv.length > MAX_IMPORT_CHARS, issues: [], preview: [] };
  const issue = (line: number, value: string, problem: ImportProblem) => {
    if (report.issues.length < MAX_ISSUES) report.issues.push({ line, value: value.slice(0, 80), problem });
  };
  const col = (field: ImportField) => mapping.indexOf(field);
  const at = (row: string[], field: ImportField) => {
    const i = col(field);
    return i >= 0 ? (row[i] ?? "").trim() : "";
  };
  const customCols = mapping.map((m, i) => (m === "custom" ? i : -1)).filter((i) => i >= 0);
  const extraTags = normalizeTags(options.tags ?? [], 10);
  const fallbackText = text(options.defaultConsentText ?? "", 5000);
  const seen = new Set<string>();
  const records: ImportRecord[] = [];

  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const rawPhone = at(row, "phone");
    const phone = parsePhone(rawPhone, options.defaultCountry);
    if (!phone) {
      report.invalid += 1;
      issue(line, rawPhone, "invalid_phone");
      return;
    }
    if (seen.has(phone.e164)) {
      report.duplicates += 1;
      issue(line, phone.e164, "duplicate");
      return;
    }
    seen.add(phone.e164);

    let firstName = str(at(row, "first_name"), "", 120);
    let lastName = str(at(row, "last_name"), "", 120);
    const full = str(at(row, "name"), "", 240);
    if (full && !firstName && !lastName) {
      const parts = full.split(/\s+/);
      firstName = parts.shift()!.slice(0, 120);
      lastName = parts.join(" ").slice(0, 120);
    }
    const tzRaw = at(row, "timezone");
    let timezone = "";
    if (tzRaw) {
      if (isValidTimeZone(tzRaw)) timezone = canonicalTimeZone(tzRaw);
      else issue(line, tzRaw, "timezone");
    }
    const fields: Record<string, string> = {};
    for (const i of customCols) if (row[i]) fields[parsed.headers[i]] = row[i];

    let consent: ImportRecord["consent"] = null;
    const typeRaw = at(row, "consent_type");
    const kind = parseConsentType(typeRaw);
    if (kind === "invalid") {
      report.consentProblems += 1;
      issue(line, typeRaw, "consent_type");
    } else if (kind) {
      const snapshot = text(at(row, "consent_text"), 5000) || fallbackText;
      const dateRaw = at(row, "consent_captured_at");
      // Express written consent must be provable: its real date is required. Other kinds without a
      // date are recorded with the import time (reported, so the file can be fixed and re-imported).
      const capturedAt = dateRaw ? parseConsentDate(dateRaw) : kind.type === "pewc" ? null : now();
      if (snapshot.length < 10) {
        report.consentProblems += 1;
        issue(line, phone.e164, "consent_text");
      } else if (!dateRaw && kind.type === "pewc") {
        report.consentProblems += 1;
        issue(line, phone.e164, "consent_date_required");
      } else if (!capturedAt) {
        report.consentProblems += 1;
        issue(line, dateRaw, "consent_date");
      } else {
        if (!dateRaw) issue(line, phone.e164, "consent_date_missing");
        consent = {
          type: kind.type,
          purpose: kind.ebr ? "informational" : parsePurpose(at(row, "consent_purpose"), kind.purpose),
          source: parseConsentSource(at(row, "consent_source"), options.defaultConsentSource ?? "csv"),
          sourceUrl: str(at(row, "consent_url"), "", 1000),
          capturedAt,
          ip: str(at(row, "consent_ip"), "", 64),
          textSnapshot: snapshot,
          ebr: kind.ebr,
        };
      }
    }

    records.push({
      line,
      phone: phone.e164,
      country: (at(row, "country").length === 2 ? at(row, "country").toUpperCase() : "") || phone.country,
      firstName,
      lastName,
      email: normalizeEmail(at(row, "email")),
      company: str(at(row, "company"), "", 190),
      timezone,
      state: str(at(row, "state"), "", 8).toUpperCase(),
      language: at(row, "language") ? normalizeLanguageTag(at(row, "language"), "") : "",
      tags: normalizeTags([...normalizeTags(at(row, "tags").replace(/[;|]/g, ",")), ...extraTags], 30),
      fields: normalizeFields(fields),
      consent,
      dnc: null,
      optedOut: false,
      exists: false,
    });
  });

  // Existing contacts and DNC entries, in chunks.
  const db = await getDb();
  const phones = records.map((r) => r.phone);
  const existing = new Map<string, boolean>();
  const dnc = new Map<string, "workspace" | "global">();
  const nowIso = now();
  for (const part of chunk(phones, 500)) {
    if (!part.length) continue;
    const [contacts, entries] = await Promise.all([
      db.selectFrom("contacts").select(["phone_e164", "opted_out_at"]).where("workspace_id", "=", workspaceId).where("phone_e164", "in", part).execute(),
      db
        .selectFrom("dnc_entries")
        .select(["phone_e164", "scope", "expires_at"])
        .where("phone_e164", "in", part)
        .where((eb) => eb.or([eb.and([eb("scope", "=", "workspace"), eb("workspace_id", "=", workspaceId)]), eb("scope", "=", "global")]))
        .execute(),
    ]);
    for (const c of contacts) existing.set(c.phone_e164, Boolean(c.opted_out_at));
    for (const e of entries) {
      if (e.expires_at && e.expires_at <= nowIso) continue;
      if (e.scope === "global" || !dnc.has(e.phone_e164)) dnc.set(e.phone_e164, e.scope);
    }
  }
  const skipDnc = options.skipDnc !== false;
  const kept: ImportRecord[] = [];
  for (const r of records) {
    r.exists = existing.has(r.phone);
    r.optedOut = existing.get(r.phone) === true;
    r.dnc = dnc.get(r.phone) ?? null;
    if (r.dnc === "workspace") {
      report.dncWorkspace += 1;
      issue(r.line, r.phone, "dnc_workspace");
    } else if (r.dnc === "global") {
      report.dncGlobal += 1;
      issue(r.line, r.phone, "dnc_global");
    } else if (r.optedOut) {
      report.optedOut += 1;
      issue(r.line, r.phone, "opted_out");
    }
    if (skipDnc && (r.dnc || r.optedOut)) {
      report.skipped += 1;
      continue;
    }
    kept.push(r);
    if (r.exists) report.updated += 1;
    else report.created += 1;
    if (r.consent) report.withConsent += 1;
  }
  report.valid = kept.length;
  report.issues.sort((a, b) => a.line - b.line);
  report.preview = records.slice(0, 10).map((r) => ({
    line: r.line,
    phone: r.phone,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    timezone: r.timezone,
    consent: r.consent?.type ?? null,
    status: r.dnc ? "dnc" : r.optedOut ? "opted_out" : r.exists ? "update" : "new",
  }));
  return { report, records: kept, headers: parsed.headers };
}

export interface ImportResult {
  created: number;
  updated: number;
  consents: number;
  addedToList: number;
}

/**
 * Writes analysed records: new contacts in batches, updates of existing ones (empty values never
 * overwrite), list membership and the consent records. Audited once per import.
 */
export async function runImport(workspaceId: number, records: ImportRecord[], options: { listId?: number | null; userId: number | null; filename?: string; source?: "csv" | "api" }): Promise<ImportResult> {
  const db = await getDb();
  const ts = now();
  const source = options.source ?? "csv";
  const result: ImportResult = { created: 0, updated: 0, consents: 0, addedToList: 0 };
  const ids = new Map<string, number>();

  for (const part of chunk(records, 200)) {
    const phones = part.map((r) => r.phone);
    const rows = await db.selectFrom("contacts").select(["id", "phone_e164", "fields", "tags"]).where("workspace_id", "=", workspaceId).where("phone_e164", "in", phones).execute();
    const have = new Map(rows.map((r) => [r.phone_e164, r]));
    const fresh = part.filter((r) => !have.has(r.phone));
    if (fresh.length) {
      try {
        await db
          .insertInto("contacts")
          .values(
            fresh.map((r) => ({
              workspace_id: workspaceId,
              phone_e164: r.phone,
              first_name: r.firstName,
              last_name: r.lastName,
              email: r.email,
              company: r.company,
              country: r.country,
              timezone: r.timezone,
              state: r.state,
              language: r.language,
              fields: JSON.stringify(r.fields),
              tags: JSON.stringify(r.tags),
              source,
              opted_out_at: null,
              last_called_at: null,
              calls_count: 0,
              created_at: ts,
              updated_at: ts,
            })),
          )
          .execute();
        result.created += fresh.length;
      } catch {
        // A concurrent import added some of these numbers: insert one by one, skipping those.
        for (const r of fresh) {
          try {
            await db
              .insertInto("contacts")
              .values({ workspace_id: workspaceId, phone_e164: r.phone, first_name: r.firstName, last_name: r.lastName, email: r.email, company: r.company, country: r.country, timezone: r.timezone, state: r.state, language: r.language, fields: JSON.stringify(r.fields), tags: JSON.stringify(r.tags), source, opted_out_at: null, last_called_at: null, calls_count: 0, created_at: ts, updated_at: ts })
              .execute();
            result.created += 1;
          } catch {
            // Exists now: left as it is.
          }
        }
      }
    }
    for (const r of part) {
      const old = have.get(r.phone);
      if (!old) continue;
      const fields = Object.keys(r.fields).length ? { ...asObj(parseJson(old.fields)), ...r.fields } : null;
      const tags = r.tags.length ? normalizeTags([...parseJsonList(old.tags), ...r.tags], 30) : null;
      await db
        .updateTable("contacts")
        .set({
          ...(r.firstName ? { first_name: r.firstName } : {}),
          ...(r.lastName ? { last_name: r.lastName } : {}),
          ...(r.email ? { email: r.email } : {}),
          ...(r.company ? { company: r.company } : {}),
          ...(r.timezone ? { timezone: r.timezone } : {}),
          ...(r.state ? { state: r.state } : {}),
          ...(r.language ? { language: r.language } : {}),
          ...(fields ? { fields: JSON.stringify(fields) } : {}),
          ...(tags ? { tags: JSON.stringify(tags) } : {}),
          updated_at: ts,
        })
        .where("id", "=", old.id)
        .execute();
      result.updated += 1;
    }
    const all = await db.selectFrom("contacts").select(["id", "phone_e164"]).where("workspace_id", "=", workspaceId).where("phone_e164", "in", phones).execute();
    for (const r of all) ids.set(r.phone_e164, r.id);

    const consents = part.filter((r) => r.consent && ids.has(r.phone));
    if (consents.length) {
      await db
        .insertInto("consents")
        .values(
          consents.map((r) => ({
            workspace_id: workspaceId,
            contact_id: ids.get(r.phone)!,
            phone_e164: r.phone,
            type: r.consent!.type,
            purpose: r.consent!.purpose,
            source: r.consent!.source,
            source_url: r.consent!.sourceUrl,
            captured_at: r.consent!.capturedAt,
            ip: r.consent!.ip,
            user_agent: r.consent!.ebr ? "existing customer (CSV import)" : "",
            text_snapshot: r.consent!.textSnapshot,
            expires_at: null,
            revoked_at: null,
            revoked_reason: null,
            created_by: options.userId,
            created_at: ts,
          })),
        )
        .execute();
      result.consents += consents.length;
    }
  }

  if (options.listId) {
    const list = await db.selectFrom("contact_lists").select("id").where("id", "=", options.listId).where("workspace_id", "=", workspaceId).executeTakeFirst();
    if (list) {
      const contactIds = [...ids.values()];
      for (const part of chunk(contactIds, 500)) {
        const present = new Set((await db.selectFrom("list_members").select("contact_id").where("list_id", "=", list.id).where("contact_id", "in", part).execute()).map((r) => r.contact_id));
        const add = part.filter((id) => !present.has(id));
        if (add.length) await db.insertInto("list_members").values(add.map((contact_id) => ({ list_id: list.id, contact_id, workspace_id: workspaceId, added_at: ts }))).execute();
        result.addedToList += add.length;
      }
    }
  }

  const actor = { type: (source === "api" ? "api" : "user") as "api" | "user", id: options.userId };
  await auditSafe({ workspaceId, actor, action: "contacts.imported", entityType: "import", entityId: str(options.filename, "", 64), data: { created: result.created, updated: result.updated, list: options.listId ?? null } });
  if (result.consents) await auditSafe({ workspaceId, actor, action: "consent.imported", entityType: "import", entityId: str(options.filename, "", 64), data: { consents: result.consents } });
  return result;
}
