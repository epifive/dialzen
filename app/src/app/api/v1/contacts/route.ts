import { apiJson } from "@/lib/api-guard";
import { apiCreated, intQuery, pageParams, readApiJson } from "@/lib/api-v1";
import { addConsent, addToList, listContacts, upsertContact } from "@/lib/contacts";
import { asObj, idList, isConsentType, str } from "@/voice/normalize";
import { CONSENT_SOURCES, type ConsentSource } from "@/voice/types";
import { timestampFrom, v1Guard } from "../_shared";
import { contactJson, unprocessable } from "../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/contacts: newest first. Filters: q (name / email / company / number), list_id, tag, opted_out=true|false, limit, offset. */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const { limit, offset } = pageParams(url);
  const opted = url.searchParams.get("opted_out");
  const { contacts, total } = await listContacts(guard.workspace.id, {
    q: url.searchParams.get("q") ?? undefined,
    listId: intQuery(url, "list_id", 0, 0, 2e9) || undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    optedOut: opted === "true" ? true : opted === "false" ? false : undefined,
    limit,
    offset,
  });
  return apiJson({ data: contacts.map(contactJson), total, limit, offset });
}

interface ConsentBody {
  type: string;
  purpose?: string;
  source?: string;
  sourceUrl?: string;
  capturedAt?: string;
  ip?: string;
  text: string;
}

/**
 * POST /api/v1/contacts: creates the contact, or updates the one with the same number (empty
 * values never overwrite). Optional: list_ids (adds to lists) and consent (an object or an array
 * of { type, purpose, source, source_url, captured_at, ip, text }), recorded as evidence.
 * 201 when created, 200 when updated.
 */
export async function POST(request: Request) {
  const guard = await v1Guard(request, { capability: "contacts.manage", write: true });
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const ws = guard.workspace;

  const rawConsents = Array.isArray(body.consent) ? body.consent : body.consent ? [body.consent] : [];
  if (rawConsents.length > 10) return unprocessable("At most 10 consent records per request.");
  const consents: ConsentBody[] = [];
  for (const [i, raw] of rawConsents.entries()) {
    const o = asObj(raw);
    if (!isConsentType(o.type)) return unprocessable(`consent[${i}].type must be one of pewc, pec, ai_voice, marketing, recording.`);
    const text = str(o.text, "", 5000);
    if (text.length < 10) return unprocessable(`consent[${i}].text must be the exact consent wording (at least 10 characters).`);
    const captured = timestampFrom(o.captured_at);
    if (captured === "invalid" || (captured && captured > new Date(Date.now() + 60_000).toISOString())) return unprocessable(`consent[${i}].captured_at must be an ISO-8601 time in the past.`);
    const purpose = str(o.purpose, "any");
    if (!["any", "informational", "telemarketing"].includes(purpose)) return unprocessable(`consent[${i}].purpose must be any, informational or telemarketing.`);
    const source = str(o.source, "api");
    consents.push({ type: o.type, purpose, source: (CONSENT_SOURCES as readonly string[]).includes(source) ? (source as ConsentSource) : "other", sourceUrl: str(o.source_url, "", 1000), capturedAt: captured ?? undefined, ip: str(o.ip, "", 64), text });
  }

  const res = await upsertContact(
    ws.id,
    {
      phone: str(body.phone, "", 40),
      firstName: str(body.first_name, "", 120),
      lastName: str(body.last_name, "", 120),
      email: str(body.email, "", 190),
      company: str(body.company, "", 190),
      timezone: str(body.timezone, "", 64),
      state: str(body.state, "", 8),
      language: str(body.language, "", 16),
      fields: body.fields !== undefined ? asObj(body.fields) : undefined,
      tags: body.tags,
    },
    { defaultCountry: ws.settings.defaultCountry, source: "api" },
  );
  if (!res.ok) return unprocessable("phone must be a valid phone number (E.164, e.g. +14155550123).", { reasons: ["invalid_number"] });

  let consentsAdded = 0;
  for (const c of consents) {
    const added = await addConsent(ws.id, res.contact.id, { type: c.type as never, purpose: c.purpose, source: c.source, sourceUrl: c.sourceUrl, capturedAt: c.capturedAt, ip: c.ip, textSnapshot: c.text }, { type: "api", id: guard.user.id });
    if (added.ok) consentsAdded += 1;
  }
  let addedToLists = 0;
  for (const listId of idList(body.list_ids, 20)) addedToLists += await addToList(ws.id, listId, [res.contact.id]);
  const payload = { contact: contactJson(res.contact), created: res.created, consents_added: consentsAdded, lists_added: addedToLists };
  return res.created ? apiCreated(payload) : apiJson(payload);
}
