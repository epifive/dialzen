import "server-only";
import { auditSafe } from "@/lib/audit";
import { getAgent, toAgentSpec } from "@/lib/agents";
import { canStartCall, createCall, updateCall } from "@/lib/calls";
import { checkDial, getCompliance } from "@/lib/compliance";
import { getContact, type ContactRecord } from "@/lib/contacts";
import { dialsToday, getNumber } from "@/lib/numbers";
import type { Entitlements } from "@/lib/plans";
import { providerContext, sellPricePerMinMicros } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { includedSecondsLeft } from "@/lib/usage";
import { releaseCall, reserveForCall } from "@/lib/wallet";
import type { WorkspaceRecord } from "@/lib/workspaces";
import { encodeCallTags, estimateReserveMicros, localDay, parsePhone, RESERVE_CAP_SEC } from "@/voice/normalize";
import { ProviderError, type CallTags, type CampaignPurpose, type DialBlockReason } from "@/voice/types";
import { failCall } from "./ingest";
import { ensureAgentSynced } from "./sync";
import "./index";

/**
 * Places one outbound phone call (campaign engine, REST API, dashboard "call now"):
 *
 *   agent + number checks → compliance check (checkDial, unless the caller just ran it) →
 *   concurrency caps → credit reservation → calls row → provider.startCall with tenant tags
 *
 * The call row exists before the provider is asked (its id is in the tags), so the webhook ingest
 * always finds it; a refused or failed start releases the reservation and marks the row failed.
 */

export type StartCallError =
  | "agent_not_found"
  | "agent_not_synced"
  | "number_not_found"
  | "number_inactive"
  | "number_outbound_disabled"
  | "number_daily_cap"
  | "provider_mismatch"
  | "provider_unavailable"
  | "blocked"
  | "concurrency"
  | "insufficient_credits"
  | "provider_error";

export type StartCallResult =
  | { ok: true; callId: number; providerCallId: string; reservedMicros: number }
  | { ok: false; error: StartCallError; message: string; reasons?: DialBlockReason[]; retryAt?: string | null; callId?: number };

export interface StartOutboundCallInput {
  workspace: Pick<WorkspaceRecord, "id" | "name" | "ownerId" | "timezone">;
  /** The workspace OWNER's entitlements (getWorkspaceEntitlements). */
  entitlements: Entitlements;
  agentId: number;
  /** Caller id: phone_numbers.id of the workspace (imported into the agent's provider). */
  numberId: number;
  /** Destination, E.164. */
  to: string;
  contactId?: number | null;
  campaignId?: number | null;
  campaignContactId?: number | null;
  /** Extra prompt variables ({{name}} → value), merged over the built-in ones. */
  variables?: Record<string, string>;
  /** Purpose of a call outside a campaign (decides the consent required); campaigns pass theirs. */
  purpose?: CampaignPurpose;
  /** Campaign data for the dial-time check (status / purpose / window). */
  campaign?: Parameters<typeof checkDial>[0]["campaign"];
  /** The caller ran checkDial() for this exact dial a moment ago (the campaign engine): skip it here. */
  complianceChecked?: boolean;
  /** Who asked (audit log). */
  actor?: { type: "user" | "api" | "system"; id: number | null };
}

/**
 * Built-in prompt variables of a call (dotted names; adapters convert them). caller_number is the
 * number that places the call (ours on outbound calls), contact_number the person's number.
 */
export function callVariables(input: { businessName: string; agentName: string; contact: ContactRecord | null; callerNumber: string; contactNumber: string; timezone: string; extra?: Record<string, string> }): Record<string, string> {
  const c = input.contact;
  const vars: Record<string, string> = {
    business_name: input.businessName,
    agent_name: input.agentName,
    today: localDay(Date.now(), input.timezone || "UTC"),
    timezone: input.timezone || "UTC",
    caller_number: input.callerNumber,
    contact_number: input.contactNumber,
  };
  if (c) {
    vars["contact.first_name"] = c.firstName;
    vars["contact.last_name"] = c.lastName;
    vars["contact.name"] = [c.firstName, c.lastName].filter(Boolean).join(" ");
    vars["contact.phone"] = c.phone;
    vars["contact.email"] = c.email;
    vars["contact.company"] = c.company;
    for (const [k, v] of Object.entries(c.fields)) if (/^[a-zA-Z0-9_]{1,40}$/.test(k)) vars[`contact.${k}`] = String(v);
  }
  return { ...vars, ...(input.extra ?? {}) };
}

export async function startOutboundCall(input: StartOutboundCallInput): Promise<StartCallResult> {
  const { workspace, entitlements } = input;
  const actor = input.actor ?? { type: "system" as const, id: null };
  const agentRow = await getAgent(workspace.id, input.agentId);
  if (!agentRow) return { ok: false, error: "agent_not_found", message: "The agent doesn't exist." };
  const number = await getNumber(workspace.id, input.numberId);
  if (!number) return { ok: false, error: "number_not_found", message: "The phone number doesn't exist." };
  if (number.status !== "active") return { ok: false, error: "number_inactive", message: "The phone number is not active." };
  if (!number.outboundEnabled) return { ok: false, error: "number_outbound_disabled", message: "Outbound calls are turned off for this number." };
  if (number.provider !== agentRow.provider) return { ok: false, error: "provider_mismatch", message: `The number is connected to ${number.provider}, the agent runs on ${agentRow.provider}.` };
  if ((await dialsToday(number.id, workspace.timezone)) >= number.dailyDialCap) return { ok: false, error: "number_daily_cap", message: "The number reached its daily dial cap." };

  const contact = input.contactId ? ((await getContact(workspace.id, input.contactId)) ?? null) : null;
  if (!input.complianceChecked) {
    const check = await checkDial({
      workspace,
      entitlements,
      phone: input.to,
      contact: contact ? { id: contact.id, timezone: contact.timezone, country: contact.country, state: contact.state, optedOut: Boolean(contact.optedOutAt) } : null,
      campaign: input.campaign ?? null,
      purpose: input.purpose ?? "informational",
    });
    if (!check.ok) {
      await auditSafe({ workspaceId: workspace.id, actor, action: "call.blocked", entityType: "phone", entityId: check.phone, data: { reasons: check.reasons, campaignId: input.campaignId ?? null } });
      return { ok: false, error: "blocked", message: `The call is not allowed now: ${check.reasons.join(", ")}.`, reasons: check.reasons, retryAt: check.retryAt };
    }
  }
  const to = parsePhone(input.to)?.e164;
  if (!to) return { ok: false, error: "blocked", message: "The destination number is not valid.", reasons: ["invalid_number"] };

  const concurrency = await canStartCall(workspace.ownerId, entitlements);
  if (!concurrency.ok) return { ok: false, error: "concurrency", message: `Too many calls in progress (${concurrency.live} of ${concurrency.limit}).` };

  const resolved = await providerContext(workspace.id, agentRow.provider, entitlements);
  if (!resolved) return { ok: false, error: "provider_unavailable", message: `The ${agentRow.provider} provider is not configured.` };
  // Synced (or moved) into the provider account the workspace uses now.
  const synced = await ensureAgentSynced(agentRow, resolved);
  if (!synced.ok) return { ok: false, error: "agent_not_synced", message: synced.error };
  const agent = synced.agent;
  const { provider, ctx } = resolved;

  const settings = await getSettings();
  const price = sellPricePerMinMicros(settings, agent.provider, ctx.keySource);
  const reserveSec = Math.min(agent.settings.maxDurationSec, RESERVE_CAP_SEC);
  const covered = (await includedSecondsLeft(workspace.ownerId, entitlements)) >= reserveSec;
  const reserveMicros = covered ? 0 : estimateReserveMicros(agent.settings.maxDurationSec, price);

  const callId = await createCall({
    workspaceId: workspace.id,
    agentId: agent.id,
    direction: "outbound",
    provider: agent.provider,
    keySource: ctx.keySource,
    from: number.e164,
    to,
    campaignId: input.campaignId ?? null,
    campaignContactId: input.campaignContactId ?? null,
    contactId: contact?.id ?? null,
    numberId: number.id,
    status: "queued",
  });
  const tags: CallTags = { workspaceId: workspace.id, callId, agentId: agent.id, campaignId: input.campaignId ?? null, contactId: contact?.id ?? null };
  await updateCall(callId, { price_per_min_micros: price, metadata: JSON.stringify(encodeCallTags(tags)) });

  if (reserveMicros > 0) {
    const reserved = await reserveForCall(workspace.id, callId, reserveMicros);
    if (!reserved.ok) {
      await failCall(callId, "Not enough call credits.", "canceled");
      return { ok: false, error: "insufficient_credits", message: "Not enough call credits for this call.", callId };
    }
    await updateCall(callId, { credits_reserved_micros: reserveMicros });
  }

  const compliance = await getCompliance(workspace);
  const vars = callVariables({ businessName: agent.settings.businessName || compliance.settings.businessName || workspace.name, agentName: agent.name, contact, callerNumber: number.e164, contactNumber: to, timezone: contact?.timezone || workspace.timezone, extra: input.variables });
  try {
    const spec = await toAgentSpec(agent);
    const { providerCallId } = await provider.startCall(ctx, { agent: spec, from: number.e164, to, variables: vars, metadata: tags, fromNumberId: number.providerNumberId });
    await updateCall(callId, { provider_call_id: providerCallId, status: "ringing" });
    await auditSafe({ workspaceId: workspace.id, actor, action: "call.dialed", entityType: "call", entityId: callId, data: { to, from: number.e164, agentId: agent.id, campaignId: input.campaignId ?? null, provider: agent.provider } });
    return { ok: true, callId, providerCallId, reservedMicros: reserveMicros };
  } catch (error) {
    const text = error instanceof ProviderError ? error.message : error instanceof Error ? error.message : "The provider refused the call.";
    await releaseCall(workspace.id, callId, "Call not placed");
    await failCall(callId, text);
    return { ok: false, error: "provider_error", message: text, callId };
  }
}
