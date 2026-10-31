"use server";

import { redirect } from "next/navigation";
import { addConsent, addDnc, addToList, createContactList, deleteContact, deleteContactList, getContact, recordOptOut, removeDnc, removeFromList, revokeConsent, upsertContact } from "@/lib/contacts";
import { analyzeImport, IMPORT_FIELDS, MAX_IMPORT_CHARS, runImport, type ImportMapping, type ImportReport, type ImportResult } from "@/lib/contacts-import";
import { guardWorkspace } from "@/lib/dashboard";
import { getDb, now } from "@/lib/db";
import { eraseContactData } from "@/lib/erasure";
import { addDncBulk, MAX_DNC_UPLOAD, NATIONAL_LIST_DAYS, parsePhoneList } from "@/lib/dnc";
import { getT } from "@/lib/i18n/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { canonicalTimeZone, isConsentType, isValidTimeZone, normalizeEmail, normalizeLanguageTag, normalizeTags, parseJson, parsePhone } from "@/voice/normalize";
import { CONSENT_SOURCES, type ConsentSource, type DncReason } from "@/voice/types";
import type { FormState } from "../types";
import { idOf, ids, str } from "./helpers";

/**
 * Contacts, lists, consent records, the CSV import and do-not-call lists (Workspace → Contacts).
 * Managing contacts needs contacts.manage (editors and up); removing a number from a DNC list is a
 * compliance decision (compliance.manage, admins).
 */

const base = (wid: number) => `/dashboard/w/${wid}/contacts`;

function contactInput(fd: FormData) {
  return {
    phone: str(fd.get("phone")),
    firstName: str(fd.get("first_name")),
    lastName: str(fd.get("last_name")),
    email: str(fd.get("email")),
    company: str(fd.get("company")),
    timezone: str(fd.get("timezone")),
    state: str(fd.get("state")),
    language: str(fd.get("language")),
    tags: normalizeTags(str(fd.get("tags"))),
  };
}

export async function createContactAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ws = guard.workspace;
  const res = await upsertContact(ws.id, contactInput(fd), { defaultCountry: ws.settings.defaultCountry, source: "manual" });
  if (!res.ok) return { error: t("dash.contacts.err.phone") };
  if (!res.created) return { error: t("dash.contacts.err.exists") };
  const listId = idOf(fd.get("list_id"));
  if (Number.isInteger(listId) && listId > 0) await addToList(ws.id, listId, [res.contact.id]);
  redirect(`${base(ws.id)}/${res.contact.id}?created=1`);
}

export async function updateContactAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ws = guard.workspace;
  const contact = await getContact(ws.id, idOf(fd.get("contact_id")));
  if (!contact) return { error: t("dash.contacts.err.notFound") };
  const input = contactInput(fd);
  if (input.timezone && !isValidTimeZone(input.timezone)) return { error: t("dash.contacts.err.timezone") };
  if (input.email && !normalizeEmail(input.email)) return { error: t("dash.contacts.err.email") };
  const db = await getDb();
  // Empty fields clear the value here (unlike the import, which never overwrites with blanks).
  await db
    .updateTable("contacts")
    .set({
      first_name: input.firstName.trim().slice(0, 120),
      last_name: input.lastName.trim().slice(0, 120),
      email: normalizeEmail(input.email),
      company: input.company.trim().slice(0, 190),
      timezone: input.timezone ? canonicalTimeZone(input.timezone) : "",
      state: input.state.trim().toUpperCase().slice(0, 8),
      language: input.language ? normalizeLanguageTag(input.language, "") : "",
      tags: JSON.stringify(input.tags),
      updated_at: now(),
    })
    .where("id", "=", contact.id)
    .execute();
  return { success: t("dash.contacts.saved") };
}

export async function deleteContactsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const list = ids(fd.getAll("ids")).slice(0, 500);
  const single = idOf(fd.get("contact_id"));
  const targets = list.length ? list : Number.isInteger(single) && single > 0 ? [single] : [];
  if (!targets.length) return { error: t("dash.contacts.err.select") };
  let n = 0;
  for (const id of targets) if (await deleteContact(guard.workspace.id, id, guard.user.id)) n += 1;
  if (!list.length) redirect(`${base(guard.workspace.id)}?deleted=1`);
  return { success: t("dash.contacts.deletedN", { n }) };
}

/** "Erase contact data" (erasure request): calls, recordings, transcripts, consent records and the contact are erased; a do-not-call entry stays (admins). */
export async function eraseContactAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const res = await eraseContactData(guard.workspace.id, idOf(fd.get("contact_id")), { type: "user", id: guard.user.id });
  if (!res) return { error: t("dash.contacts.err.notFound") };
  redirect(`${base(guard.workspace.id)}?erased=1`);
}

export async function listMembershipAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const listId = idOf(fd.get("list_id"));
  const contactIds = ids(fd.getAll("ids")).slice(0, 1000);
  const single = idOf(fd.get("contact_id"));
  const targets = contactIds.length ? contactIds : Number.isInteger(single) && single > 0 ? [single] : [];
  if (!Number.isInteger(listId) || listId < 1) return { error: t("dash.contacts.err.list") };
  if (!targets.length) return { error: t("dash.contacts.err.select") };
  if (str(fd.get("op")) === "remove") {
    await removeFromList(guard.workspace.id, listId, targets);
    return { success: t("dash.contacts.removedFromList") };
  }
  const added = await addToList(guard.workspace.id, listId, targets);
  return { success: t("dash.contacts.addedToList", { n: added }) };
}

/** The contacts table's bulk bar: add to / remove from a list, or delete (button "op"). */
export async function bulkContactsAction(prev: FormState, fd: FormData): Promise<FormState> {
  const op = str(fd.get("op"));
  if (op === "delete") {
    const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
    if (!guard.ok) return { error: guard.error };
    const t = await getT();
    const targets = ids(fd.getAll("ids")).slice(0, 500);
    if (!targets.length) return { error: t("dash.contacts.err.select") };
    let n = 0;
    for (const id of targets) if (await deleteContact(guard.workspace.id, id, guard.user.id)) n += 1;
    return { success: t("dash.contacts.deletedN", { n }) };
  }
  return listMembershipAction(prev, fd);
}

export async function createListAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const name = str(fd.get("name")).trim();
  if (!name || name.length > 120) return { error: t("dash.contacts.err.listName") };
  await createContactList(guard.workspace.id, name, str(fd.get("description")));
  return { success: t("dash.contacts.listCreated") };
}

export async function deleteListAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await deleteContactList(guard.workspace.id, idOf(fd.get("list_id")));
  return ok ? { success: t("dash.contacts.listDeleted") } : { error: t("dash.contacts.err.list") };
}

// ── Consent ──

export async function addConsentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const type = str(fd.get("type"));
  if (!isConsentType(type)) return { error: t("dash.consent.err.type") };
  const source = str(fd.get("source"));
  const captured = str(fd.get("captured_at"));
  if (captured && !Number.isFinite(Date.parse(captured))) return { error: t("dash.consent.err.date") };
  if (captured && Date.parse(captured) > Date.now() + 60_000) return { error: t("dash.consent.err.date") };
  const res = await addConsent(
    guard.workspace.id,
    idOf(fd.get("contact_id")),
    {
      type,
      purpose: str(fd.get("purpose")) || "any",
      source: (CONSENT_SOURCES as readonly string[]).includes(source) ? (source as ConsentSource) : "other",
      sourceUrl: str(fd.get("source_url")),
      capturedAt: captured ? new Date(captured).toISOString() : "",
      ip: str(fd.get("ip")),
      textSnapshot: str(fd.get("text")),
    },
    { type: "user", id: guard.user.id },
  );
  if (!res.ok) return { error: res.error === "text" ? t("dash.consent.err.text") : res.error === "contact" ? t("dash.contacts.err.notFound") : t("dash.consent.err.type") };
  return { success: t("dash.consent.added") };
}

export async function revokeConsentAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await revokeConsent(guard.workspace.id, idOf(fd.get("consent_id")), str(fd.get("reason")) || "Revoked by the team", { type: "user", id: guard.user.id });
  return ok ? { success: t("dash.consent.revoked") } : { error: t("dash.consent.err.revoke") };
}

/** The person asked not to be called (told to the team): opt-out + DNC + consents revoked. */
export async function optOutContactAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const contact = await getContact(guard.workspace.id, idOf(fd.get("contact_id")));
  if (!contact) return { error: t("dash.contacts.err.notFound") };
  await recordOptOut(guard.workspace.id, contact.phone, `user:${guard.user.id}`, { type: "user", id: guard.user.id }, { note: str(fd.get("note")).slice(0, 200) });
  return { success: t("dash.contacts.optedOutDone") };
}

// ── CSV import ──

export interface ImportState extends FormState {
  report?: ImportReport;
  result?: ImportResult;
}

function mappingOf(fd: FormData): ImportMapping {
  const raw = parseJson(str(fd.get("mapping")));
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).map((v) => ((IMPORT_FIELDS as readonly string[]).includes(String(v)) ? (v as ImportMapping[number]) : ""));
}

async function importInput(fd: FormData, t: Awaited<ReturnType<typeof getT>>) {
  const csv = str(fd.get("csv"));
  if (!csv.trim()) return { error: t("dash.import.err.empty") } as const;
  if (csv.length > MAX_IMPORT_CHARS) return { error: t("dash.import.err.size") } as const;
  const mapping = mappingOf(fd);
  if (!mapping.includes("phone")) return { error: t("dash.import.err.phone") } as const;
  const source = str(fd.get("consent_source"));
  return {
    csv,
    mapping,
    options: {
      defaultCountry: str(fd.get("country")) || "US",
      defaultConsentText: str(fd.get("consent_text_default")),
      defaultConsentSource: (CONSENT_SOURCES as readonly string[]).includes(source) ? (source as ConsentSource) : ("csv" as ConsentSource),
      skipDnc: fd.get("skip_dnc") === "on",
      tags: normalizeTags(str(fd.get("tags"))),
    },
  } as const;
}

/** Step 2 of the wizard: the dry run (validation report, nothing written). */
export async function previewImportAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage", allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-import-check:${guard.user.id}`, 30, 60_000)) return { error: t("dash.import.err.rate") };
  const input = await importInput(fd, t);
  if ("error" in input) return { error: input.error };
  const { report } = await analyzeImport(guard.workspace.id, input.csv, input.mapping, { ...input.options, defaultCountry: input.options.defaultCountry || guard.workspace.settings.defaultCountry });
  return { report };
}

/** Step 3: the import itself (the same analysis again, then the writes). */
export async function runImportAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-import:${guard.user.id}:${await clientIp()}`, 10, 10 * 60_000)) return { error: t("dash.import.err.rate") };
  const input = await importInput(fd, t);
  if ("error" in input) return { error: input.error };
  const ws = guard.workspace;
  let listId = idOf(fd.get("list_id"));
  const newList = str(fd.get("new_list")).trim();
  if (newList) listId = await createContactList(ws.id, newList.slice(0, 120));
  const { report, records } = await analyzeImport(ws.id, input.csv, input.mapping, { ...input.options, defaultCountry: input.options.defaultCountry || ws.settings.defaultCountry });
  if (!records.length) return { error: t("dash.import.err.nothing"), report };
  const result = await runImport(ws.id, records, { listId: Number.isInteger(listId) && listId > 0 ? listId : null, userId: guard.user.id, filename: str(fd.get("filename")) });
  return { report, result, success: t("dash.import.done", { created: result.created, updated: result.updated }) };
}

// ── Do-not-call ──

const DNC_UPLOAD_REASONS: DncReason[] = ["national_dnc", "tps", "manual", "complaint", "import"];

export async function addDncAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const p = parsePhone(str(fd.get("phone")), guard.workspace.settings.defaultCountry);
  if (!p) return { error: t("dash.contacts.err.phone") };
  const reason = str(fd.get("reason")) as DncReason;
  const days = Number(str(fd.get("expires_days")) || 0);
  await addDnc(
    {
      scope: "workspace",
      workspaceId: guard.workspace.id,
      phone: p.e164,
      reason: DNC_UPLOAD_REASONS.includes(reason) || reason === "opt_out" ? reason : "manual",
      source: `user:${guard.user.id}`,
      note: str(fd.get("note")),
      expiresAt: Number.isInteger(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      createdBy: guard.user.id,
    },
    { type: "user", id: guard.user.id },
  );
  // A number the person asked to remove is an opt-out of the contact too.
  if (reason === "opt_out") await recordOptOut(guard.workspace.id, p.e164, `user:${guard.user.id}`, { type: "user", id: guard.user.id });
  return { success: t("dash.dnc.added") };
}

export async function uploadDncAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-dnc-upload:${guard.user.id}`, 10, 10 * 60_000)) return { error: t("dash.import.err.rate") };
  const file = fd.get("file");
  let text = str(fd.get("numbers"));
  if (file instanceof File && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) return { error: t("dash.dnc.err.size") };
    text = `${text}\n${await file.text()}`;
  }
  const parsed = parsePhoneList(text, guard.workspace.settings.defaultCountry, MAX_DNC_UPLOAD);
  if (!parsed.phones.length) return { error: t("dash.dnc.err.none") };
  const reason = str(fd.get("reason")) as DncReason;
  const r: DncReason = DNC_UPLOAD_REASONS.includes(reason) ? reason : "manual";
  const daysRaw = str(fd.get("expires_days"));
  const days = daysRaw === "" ? (r === "national_dnc" || r === "tps" ? NATIONAL_LIST_DAYS : 0) : Number(daysRaw);
  const res = await addDncBulk({
    scope: "workspace",
    workspaceId: guard.workspace.id,
    phones: parsed.phones,
    reason: r,
    source: file instanceof File && file.name ? `upload:${file.name}`.slice(0, 60) : "upload",
    listRef: str(fd.get("list_ref")),
    expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
    actor: { type: "user", id: guard.user.id },
  });
  return { success: t("dash.dnc.uploaded", { added: res.added, existing: res.existing, invalid: parsed.invalid }) };
}

export async function removeDncAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await removeDnc("workspace", guard.workspace.id, str(fd.get("phone")), { type: "user", id: guard.user.id });
  return ok ? { success: t("dash.dnc.removed") } : { error: t("dash.dnc.err.notFound") };
}
