import { getAgent } from "@/lib/agents";
import { auditSafe } from "@/lib/audit";
import { apiError, apiJson } from "@/lib/api-guard";
import { apiCreated, intQuery, pageParams, readApiJson } from "@/lib/api-v1";
import { getCall, listCalls } from "@/lib/calls";
import { checkDial, getCompliance, outboundAccess } from "@/lib/compliance";
import { findContactByPhone, getContact } from "@/lib/contacts";
import { getDb, now } from "@/lib/db";
import { getNumber } from "@/lib/numbers";
import { startOutboundCall } from "@/lib/voice/outbound";
import { asObj, normalizeCampaignPurpose, parsePhone, str } from "@/voice/normalize";
import { CALL_DIRECTIONS, CALL_STATUSES, type CallDirection, type CallStatus } from "@/voice/types";
import { timestampFrom, v1Guard } from "../_shared";
import { callJson, unprocessable } from "../_serialize";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/calls: newest first. Filters: status, direction, agent_id, campaign_id, contact_id,
 * phone, from / to (ISO-8601), limit (≤ 500), offset.
 */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const { limit, offset } = pageParams(url);
  const status = url.searchParams.get("status");
  const direction = url.searchParams.get("direction");
  const from = timestampFrom(url.searchParams.get("from") ?? undefined);
  const to = timestampFrom(url.searchParams.get("to") ?? undefined);
  if (from === "invalid" || to === "invalid") return apiError(422, "from / to must be ISO-8601 timestamps with a time zone.");
  const { calls, total } = await listCalls(guard.workspace.id, {
    status: (CALL_STATUSES as readonly string[]).includes(status ?? "") ? (status as CallStatus) : undefined,
    direction: (CALL_DIRECTIONS as readonly string[]).includes(direction ?? "") ? (direction as CallDirection) : undefined,
    agentId: intQuery(url, "agent_id", 0, 0, 2e9) || undefined,
    campaignId: intQuery(url, "campaign_id", 0, 0, 2e9) || undefined,
    contactId: intQuery(url, "contact_id", 0, 0, 2e9) || undefined,
    phone: url.searchParams.get("phone") ?? undefined,
    from: from ?? undefined,
    to: to ?? undefined,
    limit,
    offset,
  });
  return apiJson({ data: calls.map((c) => callJson(c)), total, limit, offset });
}

const START_ERRORS: Record<string, number> = {
  agent_not_found: 404,
  number_not_found: 404,
  concurrency: 429,
  insufficient_credits: 402,
  blocked: 422,
  number_daily_cap: 429,
  provider_error: 502,
};

/**
 * POST /api/v1/calls: places one outbound call now.
 * Body: { agent_id, number_id, to, contact_id?, purpose?: "informational" | "telemarketing", variables?: {} }.
 * The dial-time compliance check runs first: 422 { error: "blocked", reasons: [...], retry_at } when
 * the call isn't allowed (no consent, do-not-call, outside calling hours…); 402 when the call credits
 * can't cover it.
 */
export async function POST(request: Request) {
  const guard = await v1Guard(request, { capability: "campaigns.run", write: true });
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const ws = guard.workspace;
  if (!guard.entitlements.allowOutbound) return apiError(403, "This workspace's plan does not include outbound calls.");
  const agentId = Number(body.agent_id);
  const numberId = Number(body.number_id);
  if (!Number.isInteger(agentId) || agentId < 1) return unprocessable("agent_id is required.");
  if (!Number.isInteger(numberId) || numberId < 1) return unprocessable("number_id is required (the caller ID: an id from GET /api/v1/numbers).");
  const [agent, number] = await Promise.all([getAgent(ws.id, agentId), getNumber(ws.id, numberId)]);
  if (!agent) return apiError(404, "Agent not found.");
  if (!number) return apiError(404, "Phone number not found.");
  const phone = parsePhone(body.to, ws.settings.defaultCountry);
  if (!phone) return unprocessable("to must be a valid phone number (E.164, e.g. +14155550123).", { reasons: ["invalid_number"] });
  let contact = null;
  if (body.contact_id !== undefined && body.contact_id !== null) {
    contact = (await getContact(ws.id, Number(body.contact_id))) ?? null;
    if (!contact) return apiError(404, "Contact not found.");
    if (contact.phone !== phone.e164) return unprocessable("to doesn't match the contact's phone number.");
  } else contact = (await findContactByPhone(ws.id, phone.e164)) ?? null;
  const purpose = normalizeCampaignPurpose(body.purpose);

  const access = await outboundAccess(await getCompliance(ws), guard.entitlements);
  if (!access.ok) return apiError(403, `Outbound calls are not allowed for this workspace right now (${access.reason}).`);

  const check = await checkDial({
    workspace: ws,
    entitlements: guard.entitlements,
    phone: phone.e164,
    contact: contact ? { id: contact.id, timezone: contact.timezone, country: contact.country, state: contact.state, optedOut: Boolean(contact.optedOutAt) } : null,
    campaign: null,
    purpose,
  });
  if (!check.ok) {
    await auditSafe({ workspaceId: ws.id, actor: { type: "api", id: guard.user.id }, action: "call.blocked", entityType: "phone", entityId: phone.e164, data: { reasons: check.reasons, purpose } });
    return unprocessable("blocked", { reasons: check.reasons, retry_at: check.retryAt });
  }

  const variables: Record<string, string> = {};
  for (const [k, v] of Object.entries(asObj(body.variables)).slice(0, 30)) if (/^[A-Za-z][A-Za-z0-9_.]{0,59}$/.test(k)) variables[k] = str(v, "", 500);
  const res = await startOutboundCall({
    workspace: ws,
    entitlements: guard.entitlements,
    agentId,
    numberId,
    to: phone.e164,
    contactId: contact?.id ?? null,
    variables,
    purpose,
    complianceChecked: true,
    actor: { type: "api", id: guard.user.id },
  });
  if (!res.ok) {
    const status = START_ERRORS[res.error] ?? 409;
    return Response.json({ error: res.error, message: res.message, ...(res.reasons ? { reasons: res.reasons, retry_at: res.retryAt ?? null } : {}), ...(res.callId ? { call_id: res.callId } : {}) }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "30" } : {}) } });
  }
  if (contact) {
    const db = await getDb();
    const ts = now();
    await db.updateTable("contacts").set({ last_called_at: ts, calls_count: contact.callsCount + 1, updated_at: ts }).where("id", "=", contact.id).execute();
  }
  const call = await getCall(ws.id, res.callId);
  return apiCreated(call ? callJson(call) : { id: res.callId });
}
