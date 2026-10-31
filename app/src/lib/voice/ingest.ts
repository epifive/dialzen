import "server-only";
import { auditSafe } from "@/lib/audit";
import { findAgentByProviderId, getAgent } from "@/lib/agents";
import { createCall, findCallByProviderId, markWebhookEvent, recordWebhookEvent, toCallRecord, updateCall, type CallPatch, type CallRecord } from "@/lib/calls";
import { getCompliance } from "@/lib/compliance";
import { findContactByPhone, recordOptOut } from "@/lib/contacts";
import { sign } from "@/lib/crypto";
import { getDb, now } from "@/lib/db";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "@/lib/notify";
import { checkQuotaAlerts } from "@/lib/notify/quota";
import { findActiveNumber } from "@/lib/numbers";
import { getProvider, getWorkspaceKeys, platformKeys, sellPricePerMinMicros, simulatedAllowed } from "@/lib/providers";
import { getSettings, type Settings } from "@/lib/settings";
import { getUsage, incrementUsage } from "@/lib/usage";
import { billCall, claimLowBalanceAlert, getWallet } from "@/lib/wallet";
import { getWorkspace, getWorkspaceEntitlements, type WorkspaceRecord } from "@/lib/workspaces";
import { formatMicros } from "@/voice/format";
import { detectOptOut, encodeCallTags, isProvider } from "@/voice/normalize";
import { FINAL_CALL_STATUSES, LIVE_CALL_STATUSES, type CallStatus, type NormalizedCallEvent, type ProviderId, type TranscriptTurn, type WebhookHeaders } from "@/voice/types";
import { runCallHooks } from "./hooks";
import { asObj } from "./http";
import { parseRetellInbound } from "./retell";

/**
 * The webhook ingest: provider events in, call rows out.
 *
 *   raw body + signature check (platform key, or the workspace's own key for BYO calls)
 *   → normalised events (adapter.parseWebhook) → once per event (webhook_events)
 *   → the call row (found by provider id or our dz_call_id tag; inbound calls are created from
 *     the number that was called) → status, transcript, cost, analysis
 *   → when the call first reaches a final status: billing (billCall: included minutes, then the
 *     wallet; the reservation comes back), usage, opt-out → DNC, the recording copy (job),
 *     notifications, call hooks
 *
 * Every side effect is guarded so that replays, retries and reconciliation never repeat it.
 */

const PURPOSE = "voice-sim-webhook";

/** Secret of the simulated provider's webhooks (derived from the app secret). */
export async function simulatedWebhookSecret(): Promise<string> {
  return sign("simulated-webhook-v1", PURPOSE);
}

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
}

/** Lower-case header map of a Request. */
export function headerMap(headers: Headers): WebhookHeaders {
  const out: WebhookHeaders = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

interface Candidate {
  secret: string;
  keySource: "platform" | "byo";
  workspaceId: number | null;
}

/** Secrets that may have signed this webhook: the call's (or tagged workspace's) own key first, then the platform key. */
async function candidateSecrets(id: ProviderId, events: NormalizedCallEvent[], settings: Settings): Promise<Candidate[]> {
  if (id === "simulated") return [{ secret: await simulatedWebhookSecret(), keySource: "platform", workspaceId: null }];
  const out: Candidate[] = [];
  const workspaces = new Set<number>();
  let platformAllowed = true;
  for (const e of events.slice(0, 5)) {
    const call = e.providerCallId ? await findCallByProviderId(id, e.providerCallId) : undefined;
    if (call) {
      workspaces.add(call.workspaceId);
      if (call.keySource === "byo") platformAllowed = false;
    } else if (e.metadata.workspaceId) {
      workspaces.add(e.metadata.workspaceId);
    }
    if (e.type === "started" && e.providerAgentId) {
      const agent = await findAgentByProviderId(id, e.providerAgentId);
      if (agent) workspaces.add(agent.workspaceId);
    }
  }
  for (const wid of workspaces) {
    const keys = await getWorkspaceKeys(wid, id);
    if (keys?.webhookSecret) out.push({ secret: keys.webhookSecret, keySource: "byo", workspaceId: wid });
  }
  const platform = platformKeys(settings, id).webhookSecret;
  if (platformAllowed && platform) out.push({ secret: platform, keySource: "platform", workspaceId: null });
  return out;
}

/**
 * Handles one provider webhook. 401 for a bad signature, 400 for a body that isn't JSON, 500 when
 * processing failed (the provider retries; nothing is applied twice).
 */
export async function ingestWebhook(providerId: string, headers: WebhookHeaders, rawBody: string, options: { nowMs?: number } = {}): Promise<IngestResult> {
  const provider = getProvider(providerId);
  if (!provider || !isProvider(providerId)) return { status: 404, body: { error: "Unknown provider." } };
  const settings = await getSettings();
  if (providerId === "simulated" && !simulatedAllowed(settings)) return { status: 404, body: { error: "Unknown provider." } };
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "The body is not JSON." } };
  }
  if (providerId === "retell") {
    const inbound = parseRetellInbound(body);
    if (inbound) return retellInbound(inbound, headers, rawBody, settings, options.nowMs);
  }
  const events = provider.parseWebhook(body);
  const candidates = await candidateSecrets(providerId, events, settings);
  let verified: Candidate | null = null;
  for (const c of candidates) {
    if (await provider.verifyWebhook(headers, rawBody, c.secret, options.nowMs)) {
      verified = c;
      break;
    }
  }
  if (!verified) return { status: 401, body: { error: "Invalid signature." } };
  if (!events.length) return { status: 200, body: { ok: true, ignored: true } };

  const results: string[] = [];
  for (const event of events) {
    try {
      results.push(await processEvent(providerId, event, rawBody, verified.keySource));
    } catch (error) {
      console.error(`[dialzen] webhook ${providerId} ${event.type} failed:`, error);
      return { status: 500, body: { error: "Processing failed; retry later." } };
    }
  }
  return { status: 200, body: { ok: true, results } };
}

/**
 * Retell's per-number inbound webhook (before the call is answered): tags the call with the
 * workspace and agent of the number and passes the prompt variables. Retell falls back to the
 * number's inbound agent when we answer {} (unknown number).
 */
async function retellInbound(inbound: NonNullable<ReturnType<typeof parseRetellInbound>>, headers: WebhookHeaders, rawBody: string, settings: Settings, nowMs?: number): Promise<IngestResult> {
  const provider = getProvider("retell")!;
  const number = inbound.to ? await findActiveNumber(inbound.to) : undefined;
  const secrets: string[] = [];
  if (number?.provider === "retell") {
    const keys = await getWorkspaceKeys(number.workspaceId, "retell");
    if (keys?.webhookSecret) secrets.push(keys.webhookSecret);
  }
  const platform = platformKeys(settings, "retell").webhookSecret;
  if (platform) secrets.push(platform);
  let ok = false;
  for (const secret of secrets) if (!ok && (await provider.verifyWebhook(headers, rawBody, secret, nowMs))) ok = true;
  if (!ok) return { status: 401, body: { error: "Invalid signature." } };
  if (!number || number.provider !== "retell" || !number.inboundAgentId) return { status: 200, body: { call_inbound: {} } };
  const workspace = await getWorkspace(number.workspaceId);
  const agent = workspace ? await getAgent(workspace.id, number.inboundAgentId) : undefined;
  if (!workspace || !agent) return { status: 200, body: { call_inbound: {} } };
  const compliance = await getCompliance(workspace);
  const tags = encodeCallTags({ workspaceId: workspace.id, agentId: agent.id });
  const today = new Date().toISOString().slice(0, 10);
  return {
    status: 200,
    body: {
      call_inbound: {
        ...(agent.providerAgentId ? { override_agent_id: agent.providerAgentId } : {}),
        dynamic_variables: { business_name: agent.settings.businessName || compliance.settings.businessName || workspace.name, agent_name: agent.name, caller_number: inbound.from, contact_number: inbound.from, timezone: workspace.timezone || "UTC", today, ...tags },
        metadata: tags,
      },
    },
  };
}

/** Applies one normalised event once (also used by reconciliation). Returns "processed", "duplicate" or "ignored". */
export async function processEvent(providerId: ProviderId, event: NormalizedCallEvent, rawBody: string, keySource: "platform" | "byo" = "platform"): Promise<string> {
  const rec = await recordWebhookEvent(providerId, `${event.eventId}`, rawBody);
  if (!rec.fresh || rec.id === null) return "duplicate";
  try {
    const call = await resolveCall(providerId, event, keySource);
    if (!call) {
      await markWebhookEvent(rec.id, "ignored", "No matching call.");
      return "ignored";
    }
    await applyEvent(call, event);
    await markWebhookEvent(rec.id, "processed", null, call.id);
    return "processed";
  } catch (error) {
    // Forget the event so the provider's retry processes it again.
    const db = await getDb();
    await db.deleteFrom("webhook_events").where("id", "=", rec.id).execute().catch(() => undefined);
    throw error;
  }
}

async function callById(callId: number): Promise<CallRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("calls").selectAll().where("id", "=", callId).executeTakeFirst();
  return row ? toCallRecord(row) : undefined;
}

/** The call an event belongs to; creates inbound calls from the number that was called. */
async function resolveCall(providerId: ProviderId, event: NormalizedCallEvent, keySource: "platform" | "byo"): Promise<CallRecord | undefined> {
  let call = await findCallByProviderId(providerId, event.providerCallId);
  if (call) return call;
  const tags = event.metadata;
  if (tags.callId) {
    const tagged = await callById(tags.callId);
    if (tagged && tagged.provider === providerId && (!tags.workspaceId || tags.workspaceId === tagged.workspaceId)) {
      if (!tagged.providerCallId) {
        try {
          await updateCall(tagged.id, { provider_call_id: event.providerCallId });
        } catch {
          // Another delivery set it concurrently.
        }
        return callById(tagged.id);
      }
      if (tagged.providerCallId === event.providerCallId) return tagged;
    }
  }
  if (event.type !== "started") return undefined;

  // An inbound call we didn't place: route it by the number that was called (or the agent).
  const number = event.to ? await findActiveNumber(event.to) : undefined;
  const agentByRef = event.providerAgentId ? await findAgentByProviderId(providerId, event.providerAgentId) : undefined;
  const workspaceId = number?.provider === providerId ? number.workspaceId : agentByRef?.workspaceId;
  if (!workspaceId) return undefined;
  const agentId = number?.provider === providerId && number.inboundAgentId ? number.inboundAgentId : agentByRef && agentByRef.workspaceId === workspaceId ? agentByRef.id : null;
  const direction = event.direction ?? "inbound";
  const contact = direction === "inbound" && event.from ? await findContactByPhone(workspaceId, event.from) : undefined;
  const settings = await getSettings();
  try {
    const id = await createCall({
      workspaceId,
      agentId,
      direction,
      provider: providerId,
      keySource,
      from: event.from,
      to: event.to,
      numberId: number?.workspaceId === workspaceId ? number.id : null,
      contactId: contact?.id ?? null,
      providerCallId: event.providerCallId,
      status: "ringing",
      metadata: encodeCallTags({ workspaceId, agentId: agentId ?? undefined, contactId: contact?.id }),
    });
    await updateCall(id, { price_per_min_micros: sellPricePerMinMicros(settings, providerId, keySource) });
    await auditSafe({ workspaceId, actor: { type: "provider", id: null }, action: "call.inbound", entityType: "call", entityId: id, data: { provider: providerId, from: event.from, to: event.to } });
    call = await callById(id);
  } catch {
    // Created by a concurrent delivery.
    call = await findCallByProviderId(providerId, event.providerCallId);
  }
  return call;
}

const isLive = (s: CallStatus) => (LIVE_CALL_STATUSES as readonly string[]).includes(s);

/** Updates a call only while it is still live; true when this request made the change. */
async function updateIfLive(callId: number, patch: CallPatch): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .updateTable("calls")
    .set({ ...patch, updated_at: now() })
    .where("id", "=", callId)
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .executeTakeFirst();
  return Number(res.numUpdatedRows) === 1;
}

/** Once-only guard per call and effect, stored with the webhook events (idempotent across processes). */
async function once(callId: number, effect: string): Promise<boolean> {
  const rec = await recordWebhookEvent("dialzen", `${effect}:${callId}`, "", callId);
  return rec.fresh;
}

const longer = (a: TranscriptTurn[], b: TranscriptTurn[]) => (a.length >= b.length ? a : b);

async function applyEvent(call: CallRecord, event: NormalizedCallEvent): Promise<void> {
  switch (event.type) {
    case "started": {
      await updateIfLive(call.id, {
        status: "in_progress",
        started_at: call.startedAt ?? event.at,
        ...(call.from ? {} : event.from ? { from_e164: event.from } : {}),
        ...(call.to ? {} : event.to ? { to_e164: event.to } : {}),
      });
      return;
    }
    case "transcript": {
      if (event.transcript.length > call.transcript.length) await updateCall(call.id, { transcript: JSON.stringify(event.transcript) });
      return;
    }
    case "tool_call": {
      const list = [...call.toolCalls, event.call].slice(-100);
      await updateCall(call.id, { tool_calls: JSON.stringify(list) });
      return;
    }
    case "ended":
    case "failed": {
      const status: CallStatus = event.type === "failed" ? "failed" : event.status;
      const transcript = event.type === "ended" ? longer(event.transcript, call.transcript) : call.transcript;
      const durationSec = event.type === "ended" ? Math.max(0, Math.round(event.durationSec)) : 0;
      const patch: CallPatch = {
        status,
        end_reason: event.endReason,
        ended_at: event.type === "ended" ? event.endedAt : event.at,
        duration_sec: durationSec,
        transcript: transcript.length ? JSON.stringify(transcript) : null,
        ...(event.type === "ended"
          ? {
              started_at: event.startedAt ?? call.startedAt,
              ...(event.costMicros !== null ? { provider_cost_micros: Math.round(event.costMicros) } : {}),
              ...(event.recordingUrl ? { recording_url: event.recordingUrl.slice(0, 2000) } : {}),
              ...(event.disclosurePlayed !== null ? { disclosure_played: event.disclosurePlayed ? 1 : 0 } : {}),
              ...(event.latencyMs !== null ? { latency_ms: Math.round(event.latencyMs) } : {}),
            }
          : { error: event.error.slice(0, 1000) }),
      };
      const first = isLive(call.status) ? await updateIfLive(call.id, patch) : false;
      if (!first) {
        // Already final (replayed / late event): only fill in what was missing.
        const fill: CallPatch = {};
        if (event.type === "ended") {
          if (call.providerCostMicros === null && event.costMicros !== null) fill.provider_cost_micros = Math.round(event.costMicros);
          if (!call.recordingUrl && event.recordingUrl) fill.recording_url = event.recordingUrl.slice(0, 2000);
          if (event.transcript.length > call.transcript.length) fill.transcript = JSON.stringify(event.transcript);
        }
        if (Object.keys(fill).length) await updateCall(call.id, fill);
      }
      const updated = await callById(call.id);
      if (updated) await finalizeCall(updated);
      return;
    }
    case "analysis_ready": {
      const extracted = { ...call.extracted, ...event.extracted };
      await updateCall(call.id, {
        summary: event.summary ? event.summary.slice(0, 5000) : call.summary || null,
        sentiment: event.sentiment !== "unknown" ? event.sentiment : call.sentiment,
        extracted: JSON.stringify(extracted),
      });
      const updated = await callById(call.id);
      if (!updated) return;
      const outcome = deriveOutcome(updated);
      if (outcome !== updated.outcome) await updateCall(call.id, { outcome });
      if ((FINAL_CALL_STATUSES as readonly string[]).includes(updated.status)) await afterAnalysis({ ...updated, outcome });
      return;
    }
  }
}

/** Short outcome label of a call (stored in calls.outcome). */
export function deriveOutcome(call: Pick<CallRecord, "status" | "endReason" | "extracted" | "toolCalls" | "outcome">): string | null {
  if (call.endReason === "opt_out" || call.extracted.opted_out === true || call.outcome === "opted_out") return "opted_out";
  if (call.status === "voicemail") return "voicemail";
  if (call.status === "no_answer" || call.status === "busy" || call.status === "failed" || call.status === "canceled") return call.status;
  const booked = Object.entries(call.extracted).some(([k, v]) => /(booked|confirmed)$/.test(k) && (v === true || v === "true" || v === "yes"));
  // A booking tool run counts when it booked (an availability check doesn't).
  const bookedByTool = call.toolCalls.some((t) => t.ok && /book/i.test(t.name) && String((t.args as Record<string, unknown> | undefined)?.action ?? "book").toLowerCase() === "book");
  if (booked || call.outcome === "booked" || bookedByTool) return "booked";
  if (call.endReason === "transferred") return "transferred";
  if (call.status === "completed") return "completed";
  return call.outcome;
}

async function workspaceOf(call: CallRecord): Promise<WorkspaceRecord | undefined> {
  return getWorkspace(call.workspaceId);
}

/** The phone number of the person on the other end (none for browser calls). */
const otherParty = (call: CallRecord) => (call.direction === "inbound" ? call.from : call.direction === "outbound" ? call.to : "");

/** Billing, usage, opt-out and notifications of a call that reached a final status. Safe to repeat. */
export async function finalizeCall(call: CallRecord): Promise<void> {
  if (!(FINAL_CALL_STATUSES as readonly string[]).includes(call.status)) return;
  const workspace = await workspaceOf(call);
  if (!workspace) return;
  const settings = await getSettings();
  const entitlements = await getWorkspaceEntitlements(workspace);
  // The provider still answers calls to a suspended account's numbers: they are kept, not billed.
  const unbilled = entitlements.suspended && call.direction === "inbound";
  if (unbilled && !call.error) await updateCall(call.id, { error: "Not billed: the account that owns this workspace is suspended." });
  const price = call.pricePerMinMicros > 0 ? call.pricePerMinMicros : sellPricePerMinMicros(settings, isProvider(call.provider) ? call.provider : "simulated", call.keySource);
  const bill = await billCall({
    workspaceId: workspace.id,
    ownerId: workspace.ownerId,
    callId: call.id,
    durationSec: unbilled ? 0 : call.durationSec,
    pricePerMinMicros: price,
    rounding: (["per_second", "per_6s", "per_minute"] as const).find((r) => r === settings.billing_rounding) ?? "per_6s",
    minimumSec: Math.max(0, Math.floor(Number(settings.billing_min_seconds) || 0)),
    entitlements,
  });

  if (await once(call.id, "finished")) {
    await incrementUsage(workspace.ownerId, { calls: 1 });
    if (bill.includedSec > 0 && entitlements.includedMinutesMonthly > 0) {
      const usage = await getUsage(workspace.ownerId);
      await checkQuotaAlerts(workspace.ownerId, "minutes", Math.floor(usage.secondsUsed / 60), entitlements.includedMinutesMonthly);
    }
    if (bill.chargeMicros > 0 && (await claimLowBalanceAlert(workspace.id))) {
      const wallet = await getWallet(workspace.id);
      const payload = await buildNotifyPayload(
        workspace,
        "low_balance",
        `The call credit balance of ${workspace.name} is low: ${formatMicros(wallet.balanceMicros, settings.currency)}.`,
        { balance: formatMicros(wallet.balanceMicros, settings.currency), alert_level: formatMicros(wallet.lowBalanceMicros, settings.currency) },
        workspaceDashboardPath(workspace.id, "billing"),
      );
      await notifyWorkspace(workspace.id, payload, { callId: call.id, ownerFallback: true });
    }

    // Recording: copied by the "recordings" job when copies are on, else streamed from the
    // provider by /api/voice/recordings (ElevenLabs serves the audio through its API only).
    const provider = getProvider(call.provider);
    const agent = call.agentId ? await getAgent(workspace.id, call.agentId) : undefined;
    const wantsRecording = (agent?.settings.recording ?? true) && call.durationSec > 0 && (call.status === "completed" || call.status === "voicemail");
    if (wantsRecording && provider?.capabilities.recordings === "api" && !call.recordingUrl) await updateCall(call.id, { recording_url: RECORDING_VIA_API });
    // The agent doesn't record: forget the provider's audio link (nothing is copied or played).
    if (agent && !agent.settings.recording && call.recordingUrl) await updateCall(call.id, { recording_url: null });

    await detectAndRecordOptOut(call, workspace);
    const after = (await callById(call.id)) ?? call;
    const outcome = deriveOutcome(after);
    if (outcome !== after.outcome) await updateCall(call.id, { outcome });

    if (call.status === "failed") {
      const payload = await buildNotifyPayload(workspace, "call_failed", `A call ${call.direction === "outbound" ? `to ${call.to}` : `from ${call.from || "the browser"}`} failed${call.error ? `: ${call.error}` : "."}`, callData(call), workspaceDashboardPath(workspace.id, `calls/${call.id}`));
      await notifyWorkspace(workspace.id, payload, { callId: call.id });
    }
    const fresh = await callById(call.id);
    if (fresh) {
      await runCallHooks(fresh, "finished");
      // Calls that will get no analysis (unanswered) are complete now.
      if (fresh.status !== "completed" && fresh.status !== "failed" && (await once(call.id, "completed"))) await sendCompleted(fresh, workspace);
    }
  }
}

/** Sentinel of recording_url: the provider serves the audio through its API (ElevenLabs). */
export const RECORDING_VIA_API = "provider:api";

async function detectAndRecordOptOut(call: CallRecord, workspace: WorkspaceRecord): Promise<void> {
  const phone = otherParty(call);
  if (!phone) return;
  const compliance = await getCompliance(workspace);
  const hit = detectOptOut(call.transcript, compliance.settings.optOutPhrases);
  const flagged = call.endReason === "opt_out" || call.extracted.opted_out === true;
  if (!hit.optOut && !flagged) return;
  if (!(await once(call.id, "optout"))) return;
  await recordOptOut(workspace.id, phone, `call:${call.id}`, { type: "provider", id: null }, { callId: call.id, phrase: hit.phrase, lang: hit.lang, flagged });
  if (call.outcome !== "opted_out") await updateCall(call.id, { outcome: "opted_out" });
  const payload = await buildNotifyPayload(workspace, "opt_out", `${phone} asked not to be called again. The number was added to the workspace's do-not-call list.`, { phone, call_id: call.id, phrase: hit.phrase || "analysis" }, workspaceDashboardPath(workspace.id, `calls/${call.id}`));
  await notifyWorkspace(workspace.id, payload, { callId: call.id });
}

async function afterAnalysis(call: CallRecord): Promise<void> {
  const workspace = await workspaceOf(call);
  if (!workspace) return;
  // Opt-out flags often only arrive with the analysis.
  await detectAndRecordOptOut(call, workspace);
  const fresh = (await callById(call.id)) ?? call;
  if (fresh.outcome === "booked" && (await once(call.id, "booking"))) {
    const payload = await buildNotifyPayload(workspace, "booking_made", `New booking from a call with ${otherParty(fresh) || "a web visitor"}.`, callData(fresh), workspaceDashboardPath(workspace.id, `calls/${call.id}`));
    await notifyWorkspace(workspace.id, payload, { callId: call.id });
  }
  if (await once(call.id, "analyzed")) await runCallHooks(fresh, "analyzed");
  if (await once(call.id, "completed")) await sendCompleted(fresh, workspace);
}

/** Notification data of a call: flat snake_case facts plus the extracted fields (extracted_<key>). */
export function callData(call: CallRecord): Record<string, string | number> {
  const data: Record<string, string | number> = {
    call_id: call.id,
    direction: call.direction,
    status: call.status,
    from: call.from,
    to: call.to,
    duration_sec: call.durationSec,
  };
  if (call.agentId) data.agent_id = call.agentId;
  if (call.campaignId) data.campaign_id = call.campaignId;
  if (call.contactId) data.contact_id = call.contactId;
  if (call.outcome) data.outcome = call.outcome;
  if (call.sentiment !== "unknown") data.sentiment = call.sentiment;
  if (call.summary) data.summary = call.summary.slice(0, 1000);
  for (const [k, v] of Object.entries(call.extracted)) {
    if (v === null || v === undefined) continue;
    data[`extracted_${k}`.slice(0, 60)] = typeof v === "number" ? v : typeof v === "string" ? v.slice(0, 500) : JSON.stringify(v).slice(0, 500);
  }
  return data;
}

/** call_completed to the workspace's channels (webhook channels get it signed with X-Dialzen-Signature). */
async function sendCompleted(call: CallRecord, workspace: WorkspaceRecord): Promise<void> {
  const label = call.direction === "inbound" ? `from ${call.from || "an unknown number"}` : call.direction === "outbound" ? `to ${call.to}` : "in the browser";
  const payload = await buildNotifyPayload(workspace, "call_completed", `Call ${label} ended (${call.status.replace("_", " ")}, ${call.durationSec} s).${call.summary ? ` ${call.summary}` : ""}`, callData(call), workspaceDashboardPath(workspace.id, `calls/${call.id}`));
  await notifyWorkspace(workspace.id, payload, { callId: call.id });
}

/** Raw JSON of an event for webhook_events hashing when it didn't come from HTTP (reconciliation, simulated chat). */
export function syntheticBody(event: NormalizedCallEvent): string {
  return JSON.stringify(asObj(event));
}

/** Marks a call that never reached the provider (or got stuck) as failed and runs the normal finalisation. */
export async function failCall(callId: number, error: string, endReason: "error" | "canceled" | "rejected" = "error"): Promise<void> {
  const db = await getDb();
  const status = endReason === "canceled" ? "canceled" : "failed";
  await db
    .updateTable("calls")
    .set({ status, end_reason: endReason, ended_at: now(), error: error.slice(0, 1000), updated_at: now() })
    .where("id", "=", callId)
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .execute();
  const call = await callById(callId);
  if (call) await finalizeCall(call);
}

/** Calls still live but untouched for `olderThanMs` (missed webhooks). */
export async function staleLiveCalls(olderThanMs: number, limit = 50): Promise<CallRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("calls")
    .selectAll()
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .where("updated_at", "<", new Date(Date.now() - olderThanMs).toISOString())
    .orderBy("updated_at")
    .limit(limit)
    .execute();
  return rows.map(toCallRecord);
}

export { callById };
