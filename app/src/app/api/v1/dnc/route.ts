import { apiError, apiJson } from "@/lib/api-guard";
import { apiCreated, readApiJson } from "@/lib/api-v1";
import { addDnc, recordOptOut, removeDnc } from "@/lib/contacts";
import { parsePhone, str } from "@/voice/normalize";
import type { DncReason } from "@/voice/types";
import { timestampFrom, v1Guard } from "../_shared";
import { unprocessable } from "../_serialize";

export const dynamic = "force-dynamic";

const REASONS: DncReason[] = ["opt_out", "manual", "national_dnc", "tps", "complaint"];

/**
 * POST /api/v1/dnc: adds a number to the workspace's do-not-call list.
 * Body: { phone, reason?: opt_out | manual | national_dnc | tps | complaint, note?, expires_at? }.
 * reason "opt_out" also marks the contact opted out and revokes its consent.
 */
export async function POST(request: Request) {
  const guard = await v1Guard(request, { capability: "contacts.manage", write: true });
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const p = parsePhone(body.phone, guard.workspace.settings.defaultCountry);
  if (!p) return unprocessable("phone must be a valid phone number (E.164).");
  const reason = str(body.reason, "manual") as DncReason;
  if (!REASONS.includes(reason)) return unprocessable(`reason must be one of ${REASONS.join(", ")}.`);
  const expires = timestampFrom(body.expires_at);
  if (expires === "invalid") return unprocessable("expires_at must be an ISO-8601 time.");
  const actor = { type: "api" as const, id: guard.user.id };
  if (reason === "opt_out") await recordOptOut(guard.workspace.id, p.e164, "api", actor);
  else await addDnc({ scope: "workspace", workspaceId: guard.workspace.id, phone: p.e164, reason, source: "api", note: str(body.note, "", 500), expiresAt: expires ?? null }, actor);
  return apiCreated({ phone: p.e164, reason, dnc: true });
}

/** DELETE /api/v1/dnc?phone=…: removes a number from the workspace's list (admins' keys only). */
export async function DELETE(request: Request) {
  const guard = await v1Guard(request, { capability: "compliance.manage", write: true });
  if (!guard.ok) return guard.response;
  const phone = new URL(request.url).searchParams.get("phone") ?? "";
  const p = parsePhone(phone, guard.workspace.settings.defaultCountry);
  if (!p) return unprocessable("phone must be a valid phone number (E.164).");
  const ok = await removeDnc("workspace", guard.workspace.id, p.e164, { type: "api", id: guard.user.id });
  if (!ok) return apiError(404, "This number isn't on the workspace's do-not-call list.");
  return apiJson({ phone: p.e164, dnc: false });
}
