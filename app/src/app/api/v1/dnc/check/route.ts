import { apiJson } from "@/lib/api-guard";
import { findContactByPhone } from "@/lib/contacts";
import { dncStatus } from "@/lib/dnc";
import { parsePhone } from "@/voice/normalize";
import { v1Guard } from "../../_shared";
import { unprocessable } from "../../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/dnc/check?phone=…: whether a number may not be called (workspace list, global list, opt-out). */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const p = parsePhone(new URL(request.url).searchParams.get("phone") ?? "", guard.workspace.settings.defaultCountry);
  if (!p) return unprocessable("phone must be a valid phone number (E.164).");
  const [status, contact] = await Promise.all([dncStatus(guard.workspace.id, p.e164), findContactByPhone(guard.workspace.id, p.e164)]);
  const optedOut = Boolean(contact?.optedOutAt);
  return apiJson({
    phone: p.e164,
    blocked: Boolean(status.workspace || status.global || optedOut),
    workspace: status.workspace ? { reason: status.workspace.reason, added_at: status.workspace.created_at, expires_at: status.workspace.expires_at } : null,
    global: Boolean(status.global),
    opted_out: optedOut,
    opted_out_at: contact?.optedOutAt ?? null,
  });
}
