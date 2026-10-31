import { apiError, apiJson } from "@/lib/api-guard";
import { pathId } from "@/lib/api-v1";
import { contactConsents } from "@/lib/compliance";
import { getContact } from "@/lib/contacts";
import { getDb } from "@/lib/db";
import { dncStatus } from "@/lib/dnc";
import { v1Guard } from "../../_shared";
import { consentJson, contactJson } from "../../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/contacts/{id}: the contact with its consent records, DNC status and lists. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const contact = await getContact(guard.workspace.id, pathId((await params).id));
  if (!contact) return apiError(404, "Contact not found.");
  const db = await getDb();
  const [consents, dnc, lists] = await Promise.all([
    contactConsents(guard.workspace.id, contact.id, contact.phone),
    dncStatus(guard.workspace.id, contact.phone),
    db.selectFrom("list_members").select("list_id").where("contact_id", "=", contact.id).execute(),
  ]);
  return apiJson({
    ...contactJson(contact),
    consents: consents.map(consentJson),
    dnc: { workspace: dnc.workspace ? { reason: dnc.workspace.reason, expires_at: dnc.workspace.expires_at } : null, global: Boolean(dnc.global) },
    list_ids: lists.map((l) => l.list_id),
  });
}
