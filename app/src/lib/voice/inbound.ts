import "server-only";
import { findAgentByProviderId, inboundWebhookSecret, INBOUND_SECRET_HEADER, toAgentSpec } from "@/lib/agents";
import { getCompliance } from "@/lib/compliance";
import { findContactByPhone } from "@/lib/contacts";
import { findActiveNumber } from "@/lib/numbers";
import { getWorkspace } from "@/lib/workspaces";
import { encodeCallTags, parsePhone } from "@/voice/normalize";
import type { WebhookHeaders } from "@/voice/types";
import { asObj, asStr, safeEqual } from "./http";
import type { IngestResult } from "./ingest";
import { callVariables } from "./outbound";
import { agentTemplates, toProviderVariables } from "./vars";

/**
 * ElevenLabs conversation-initiation webhook (POST /api/voice/inbound/elevenlabs). Before an
 * inbound phone call (Twilio or SIP trunk) to one of our agents starts, ElevenLabs sends
 * {caller_id, agent_id, called_number, call_sid, conversation_id} with the header
 * X-Dialzen-Inbound-Secret that the agent sync configured (platform_settings.workspace_overrides,
 * one secret per agent, derived from the app secret). We answer the agent's dynamic variables:
 * business and agent name, caller_number / contact_number, the caller's (or workspace's) time
 * zone, today's date, the contact's fields when the caller is a known contact of the workspace,
 * every placeholder the agent's prompt defines, and our call tags (dz_workspace_id, dz_agent_id,
 * dz_contact_id) so the post-call webhook finds the right workspace and contact.
 *
 * Failures answer an HTTP error: ElevenLabs then doesn't start the conversation, so the secret is
 * only checked against the agent the request names.
 */

const MAX_BYTES = 64 * 1024;

export async function elevenLabsInitiation(headers: WebhookHeaders, rawBody: string): Promise<IngestResult> {
  if (rawBody.length > MAX_BYTES) return { status: 413, body: { error: "Payload too large." } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "The body is not JSON." } };
  }
  const body = asObj(parsed);
  const agentRef = asStr(body.agent_id).slice(0, 190);
  if (!agentRef) return { status: 400, body: { error: "agent_id is missing." } };
  const agent = await findAgentByProviderId("elevenlabs", agentRef);
  const given = headers[INBOUND_SECRET_HEADER] ?? "";
  if (!agent || !given || !safeEqual(given, await inboundWebhookSecret(agent.id))) return { status: 401, body: { error: "Invalid secret." } };
  const workspace = await getWorkspace(agent.workspaceId);
  if (!workspace) return { status: 404, body: { error: "Unknown agent." } };

  const callerRaw = asStr(body.caller_id).slice(0, 40);
  const from = parsePhone(callerRaw)?.e164 ?? "";
  const calledRaw = asStr(body.called_number).slice(0, 40);
  const called = parsePhone(calledRaw)?.e164 ?? "";
  // Contacts are only looked up for calls to one of the workspace's own numbers.
  const number = called ? await findActiveNumber(called) : undefined;
  const ours = Boolean(number && number.workspaceId === workspace.id && number.provider === "elevenlabs");
  const contact = ours && from ? await findContactByPhone(workspace.id, from) : undefined;

  const compliance = await getCompliance(workspace);
  const vars = callVariables({
    businessName: agent.settings.businessName || compliance.settings.businessName || workspace.name,
    agentName: agent.name,
    contact: contact ?? null,
    callerNumber: from || callerRaw,
    contactNumber: from || callerRaw,
    timezone: contact?.timezone || workspace.timezone || "UTC",
  });
  // ElevenLabs wants every variable the agent defines: placeholders keep their defaults.
  const defaults = agentTemplates(await toAgentSpec(agent)).defaults;
  const dynamicVariables: Record<string, string> = {
    ...defaults,
    ...toProviderVariables(vars),
    ...encodeCallTags({ workspaceId: workspace.id, agentId: agent.id, contactId: contact?.id }),
  };
  return {
    status: 200,
    body: { type: "conversation_initiation_client_data", dynamic_variables: dynamicVariables, user_id: `workspace-${workspace.id}` },
  };
}
