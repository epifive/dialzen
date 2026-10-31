import { registerProvider } from "@/lib/providers";
import { decodeCallTags, encodeCallTags, hasAiDisclosure } from "@/voice/normalize";
import {
  ProviderError,
  type AgentSpec,
  type CallStatus,
  type EndReason,
  type KbDoc,
  type NormalizedCallEvent,
  type ProviderCallDetails,
  type ProviderContext,
  type ToolSpec,
  type TranscriptTurn,
  type VoiceProvider,
} from "@/voice/types";
import { apiBase, asArr, asNum, asObj, asStr, hmacHex, isoOf, parseSignatureHeader, providerRequest, safeEqual, usdToMicros, type RequestOptions } from "./http";
import { agentTemplates, fieldDescription, parametersSchema, promptAppendix, toProviderVariables } from "./vars";

/**
 * ElevenLabs Agents (Conversational AI) adapter. API: https://api.elevenlabs.io, header xi-api-key.
 *
 * - Agents: POST /v1/convai/agents/create, PATCH /v1/convai/agents/{id} (live config, no publish).
 * - Server tools are separate resources (POST/PATCH /v1/convai/tools) attached with prompt.tool_ids;
 *   they call our /api/voice/tools/<id> with X-Dialzen-Tool-Secret and the conversation id
 *   (system__conversation_id) in X-Dialzen-Call-Id. end_call, transfer_to_number and
 *   voicemail_detection are built-in system tools.
 * - Knowledge base: /v1/convai/knowledge-base/{url,text,file}; data collection = our analysis
 *   fields plus dz_sentiment / dz_opted_out.
 * - Numbers: import Twilio (SID + token) or a SIP trunk; outbound via /twilio/outbound-call or
 *   /sip-trunk/outbound-call with dynamic variables (our dz_* tags) and user_id.
 * - Post-call webhook (one per ElevenLabs workspace): ElevenLabs-Signature: t=<s>,v0=<hex
 *   HMAC-SHA256(secret, "<t>.<body>")>, 30-minute tolerance. Audio: GET …/conversations/{id}/audio.
 * - Inbound calls: each agent's conversation-initiation webhook (platform_settings
 *   .workspace_overrides) points at our /api/voice/inbound/elevenlabs with a per-agent secret
 *   header; it answers the dynamic variables and our call tags (src/lib/voice/inbound.ts).
 * - Erasure: DELETE /v1/convai/conversations/{id} removes the conversation (transcript, audio).
 */

const BASE = "https://api.elevenlabs.io";
const TOLERANCE_MS = 30 * 60_000;
const SENTIMENT_FIELD = "dz_sentiment";
const OPT_OUT_FIELD = "dz_opted_out";

function req(ctx: ProviderContext, path: string, options: RequestOptions = {}) {
  return providerRequest(ctx, `${apiBase(ctx, BASE)}${path}`, { ...options, headers: { "xi-api-key": ctx.keys.apiKey, ...(options.headers ?? {}) } });
}

const lang2 = (tag: string) => (tag.split("-")[0] || "en").toLowerCase();

function toolConfig(tool: ToolSpec) {
  const schema = parametersSchema(tool.parameters);
  const api: Record<string, unknown> = {
    url: tool.url,
    method: "POST",
    request_headers: { "X-Dialzen-Tool-Secret": tool.secret, "X-Dialzen-Call-Id": { variable_name: "system__conversation_id" } },
  };
  if (Object.keys(schema.properties).length) api.request_body_schema = { type: "object", description: tool.description.slice(0, 300), properties: schema.properties, required: schema.required };
  return { type: "webhook", name: tool.name, description: tool.description, response_timeout_secs: 10, api_schema: api };
}

/** Creates / updates our server tools as ElevenLabs tool resources; returns their ids and the new meta. */
async function syncTools(ctx: ProviderContext, tools: ToolSpec[], meta: Record<string, string>): Promise<{ ids: string[]; meta: Record<string, string> }> {
  const next: Record<string, string> = {};
  const ids: string[] = [];
  for (const tool of tools.filter((t) => t.url)) {
    const key = `tool_${tool.id}`;
    const existing = meta[key];
    let id = "";
    if (existing) {
      const res = await req(ctx, `/v1/convai/tools/${encodeURIComponent(existing)}`, { method: "PATCH", json: { tool_config: toolConfig(tool) }, allow404: true });
      if (res !== null) id = existing;
    }
    if (!id) id = asStr(asObj(await req(ctx, "/v1/convai/tools", { method: "POST", json: { tool_config: toolConfig(tool) } })).id);
    if (!id) throw new ProviderError("unknown", "ElevenLabs did not return a tool id.");
    next[key] = id;
    ids.push(id);
  }
  // Tools no longer attached.
  for (const [key, id] of Object.entries(meta)) {
    if (key.startsWith("tool_") && !(key in next)) await req(ctx, `/v1/convai/tools/${encodeURIComponent(id)}`, { method: "DELETE", allow404: true }).catch(() => undefined);
  }
  return { ids, meta: next };
}

function builtInTools(agent: AgentSpec, tools: ToolSpec[], voicemail: string) {
  const out: Record<string, unknown> = {
    end_call: { type: "system", name: "end_call", description: tools.find((t) => t.kind === "end_call")?.description ?? "", params: { system_tool_type: "end_call" } },
  };
  const transfers = tools.filter((t) => t.kind === "transfer" && t.transfer?.number).map((t) => ({ transfer_destination: { type: "phone", phone_number: t.transfer!.number }, condition: t.description, transfer_type: "conference" }));
  if (!transfers.length && agent.settings.transferNumber) transfers.push({ transfer_destination: { type: "phone", phone_number: agent.settings.transferNumber }, condition: "The caller asks for a person, or you cannot help them.", transfer_type: "conference" });
  if (transfers.length) out.transfer_to_number = { type: "system", name: "transfer_to_number", description: "", params: { system_tool_type: "transfer_to_number", transfers, enable_client_message: true } };
  out.voicemail_detection = { type: "system", name: "voicemail_detection", description: "", params: { system_tool_type: "voicemail_detection", voicemail_message: agent.settings.voicemailAction === "leave_message" && voicemail ? voicemail : null } };
  return out;
}

function dataCollection(agent: AgentSpec) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of agent.settings.analysisFields) {
    const type = f.type === "number" ? "number" : f.type === "boolean" ? "boolean" : "string";
    out[f.key] = { type, description: fieldDescription(f), ...(f.type === "enum" && f.options.length ? { enum: f.options } : {}) };
  }
  out[SENTIMENT_FIELD] = { type: "string", description: "The caller's overall sentiment during the call.", enum: ["positive", "neutral", "negative"] };
  out[OPT_OUT_FIELD] = { type: "boolean", description: "True when the caller asked not to be called again or to be removed from a list." };
  return out;
}

function agentBody(agent: AgentSpec, toolIds: string[], tools: ToolSpec[], kb: KbDoc[]) {
  const t = agentTemplates(agent);
  const appendix = promptAppendix(agent);
  const language = lang2(agent.language);
  const prompt: Record<string, unknown> = {
    prompt: appendix ? `${t.prompt}\n\n${appendix}` : t.prompt,
    temperature: agent.settings.temperature,
    tool_ids: toolIds,
    built_in_tools: builtInTools(agent, tools, t.voicemail),
    knowledge_base: kb.filter((d) => d.providerDocId).map((d) => ({ type: d.kind, name: d.name.slice(0, 120) || `Document ${d.id}`, id: d.providerDocId, usage_mode: "auto" })),
  };
  if (agent.llm) prompt.llm = agent.llm;
  const tts: Record<string, unknown> = { speed: agent.settings.speed };
  if (agent.voiceId) tts.voice_id = agent.voiceId;
  if (language !== "en") tts.model_id = "eleven_flash_v2_5";
  const eagerness = { low: "patient", medium: "normal", high: "eager" }[agent.settings.interruptionSensitivity];
  return {
    name: `${agent.name} (#${agent.id})`.slice(0, 120),
    tags: ["dialzen", `workspace-${agent.workspaceId}`],
    conversation_config: {
      agent: { first_message: t.firstMessage, language, prompt, dynamic_variables: { dynamic_variable_placeholders: t.defaults } },
      tts,
      conversation: { max_duration_seconds: agent.settings.maxDurationSec },
      turn: { silence_end_call_timeout: agent.settings.silenceTimeoutSec, turn_eagerness: eagerness },
    },
    platform_settings: {
      // Inbound calls fetch their variables (caller, contact, business, our call tags) from us.
      ...(agent.inboundWebhook
        ? {
            overrides: { enable_conversation_initiation_client_data_from_webhook: true },
            workspace_overrides: { conversation_initiation_client_data_webhook: { url: agent.inboundWebhook.url, request_headers: { "X-Dialzen-Inbound-Secret": agent.inboundWebhook.secret } } },
          }
        : {}),
      data_collection: dataCollection(agent),
      ...(agent.settings.successCriteria ? { evaluation: { criteria: [{ id: "success", name: "Success", type: "prompt", conversation_goal_prompt: agent.settings.successCriteria }] } } : {}),
      privacy: { record_voice: agent.settings.recording },
    },
  };
}

// ── Webhook / conversation parsing ──

function turnsOf(transcript: unknown): TranscriptTurn[] {
  return asArr(transcript)
    .map((x) => {
      const o = asObj(x);
      const text = asStr(o.message).trim();
      if (!text) return null;
      return { role: o.role === "agent" ? "agent" : "caller", text: text.slice(0, 5000), at: Math.max(0, asNum(o.time_in_call_secs) ?? 0) } as TranscriptTurn;
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

function endReasonOfTermination(reason: string, status: CallStatus): EndReason {
  const r = reason.toLowerCase();
  if (status === "voicemail") return "voicemail";
  if (status === "no_answer") return "no_answer";
  if (status === "busy") return "busy";
  if (status === "failed") return "error";
  if (/transfer/.test(r)) return "transferred";
  if (/max(imum)?[ _-]?duration|time ?limit/.test(r)) return "max_duration";
  if (/silence|inactiv/.test(r)) return "silence_timeout";
  if (/end_call|agent (ended|hung)|tool/.test(r)) return "agent_hangup";
  if (/client|user|remote|caller|hang ?up|disconnect/.test(r)) return "caller_hangup";
  return "unknown";
}

interface Conversation {
  conversationId: string;
  details: ProviderCallDetails;
  success: boolean | null;
  providerAgentId: string;
}

/** A conversation object (post-call webhook data / GET conversation) → our call details. */
function parseConversation(data: Record<string, unknown>): Conversation | null {
  const conversationId = asStr(data.conversation_id);
  if (!conversationId) return null;
  const meta = asObj(data.metadata);
  const phone = asObj(meta.phone_call);
  const init = asObj(data.conversation_initiation_client_data);
  const vars = asObj(init.dynamic_variables);
  const direction = phone.direction === "inbound" ? "inbound" : phone.direction === "outbound" ? "outbound" : Object.keys(phone).length ? null : "web";
  const agentNumber = asStr(phone.agent_number);
  const external = asStr(phone.external_number);
  const result = asStr(phone.call_result);
  const duration = Math.max(0, Math.round(asNum(meta.call_duration_secs) ?? 0));
  let status: CallStatus = "completed";
  if (result === "voicemail") status = "voicemail";
  else if (result === "busy") status = "busy";
  else if (result === "no_answer") status = "no_answer";
  else if (result === "failed" || data.status === "failed") status = "failed";
  else if (data.status === "initiated" || data.status === "in-progress" || data.status === "processing") status = "in_progress";
  const startedAt = isoOf(meta.start_time_unix_secs, "s");
  const endedAt = startedAt && status !== "in_progress" ? new Date(Date.parse(startedAt) + duration * 1000).toISOString() : null;
  const analysis = asObj(data.analysis);
  const collected = asObj(analysis.data_collection_results);
  const extracted: Record<string, unknown> = {};
  let sentiment: ProviderCallDetails["sentiment"] = "unknown";
  for (const [k, v] of Object.entries(collected)) {
    const value = asObj(v).value;
    if (value === null || value === undefined || value === "") continue;
    if (k === SENTIMENT_FIELD) sentiment = value === "positive" || value === "negative" || value === "neutral" ? value : "unknown";
    else if (k === OPT_OUT_FIELD) {
      if (value === true || value === "true") extracted.opted_out = true;
    } else extracted[k] = value;
  }
  const costUsd = asNum(meta.cost_fiat);
  const transcript = turnsOf(data.transcript);
  const success = analysis.call_successful === "success" ? true : analysis.call_successful === "failure" ? false : null;
  return {
    conversationId,
    providerAgentId: asStr(data.agent_id),
    success,
    details: {
      providerCallId: conversationId,
      status,
      endReason: status === "in_progress" ? null : endReasonOfTermination(asStr(meta.termination_reason), status),
      direction,
      from: direction === "inbound" ? external : agentNumber,
      to: direction === "inbound" ? agentNumber : external,
      startedAt,
      endedAt,
      durationSec: duration,
      costMicros: costUsd === null ? null : usdToMicros(costUsd),
      transcript,
      summary: asStr(analysis.transcript_summary),
      sentiment,
      extracted,
      recordingUrl: "",
      latencyMs: null,
      metadata: decodeCallTags(vars),
    },
  };
}

export const elevenLabsProvider: VoiceProvider = {
  id: "elevenlabs",
  capabilities: {
    numbersPurchase: false,
    purchaseCountries: [],
    numbersImport: ["twilio", "sip", "telnyx", "plivo", "exotel"],
    outbound: true,
    webCall: true,
    knowledgeBase: true,
    warmTransfer: true,
    voicemailDetection: true,
    perAgentWebhook: false,
    inboundWebhook: false,
    recordings: "api",
    costInWebhook: true,
    languages: ["en", "hi", "ar", "es", "fr", "de", "it", "pt", "nl", "pl", "ja", "zh", "ko", "tr", "ru", "id", "ta", "bn"],
  },

  async testConnection(ctx) {
    try {
      const res = asObj(await req(ctx, "/v1/convai/agents?page_size=1"));
      const agents = asArr(res.agents).length;
      return { ok: true, account: "ElevenLabs workspace", detail: agents ? "Agents API reachable." : "Agents API reachable (no agents yet)." };
    } catch (error) {
      return { ok: false, error: error instanceof ProviderError ? error : new ProviderError("unknown", "Connection failed.") };
    }
  },

  async listVoices(ctx, lang) {
    const res = asObj(await req(ctx, "/v2/voices?page_size=100&include_total_count=false"));
    const want = (lang ?? "").toLowerCase().split("-")[0];
    return asArr(res.voices)
      .map(asObj)
      .map((v) => {
        const labels = asObj(v.labels);
        const verified = asArr(v.verified_languages).map(asObj);
        const languages = [...new Set(verified.map((l) => asStr(l.locale) || asStr(l.language)).filter(Boolean))];
        if (!languages.length && asStr(labels.language)) languages.push(asStr(labels.language));
        const gender = asStr(labels.gender).toLowerCase();
        return {
          id: asStr(v.voice_id),
          name: asStr(v.name),
          languages,
          gender: (gender === "female" || gender === "male" || gender === "neutral" ? gender : "") as "female" | "male" | "neutral" | "",
          accent: asStr(labels.accent),
          previewUrl: asStr(v.preview_url) || asStr(verified[0]?.preview_url),
        };
      })
      .filter((v) => v.id && (!want || !v.languages.length || v.languages.some((l) => l.toLowerCase().split(/[-_]/)[0] === want)));
  },

  async syncAgent(ctx, agent, tools, kb) {
    const synced = await syncTools(ctx, tools, agent.providerMeta);
    const body = agentBody(agent, synced.ids, tools, kb);
    let id = agent.providerAgentId;
    if (id) {
      const res = await req(ctx, `/v1/convai/agents/${encodeURIComponent(id)}`, { method: "PATCH", json: body, allow404: true });
      if (res === null) id = null;
    }
    if (!id) id = asStr(asObj(await req(ctx, "/v1/convai/agents/create", { method: "POST", json: body })).agent_id);
    if (!id) throw new ProviderError("unknown", "ElevenLabs did not return an agent id.");
    return { providerAgentId: id, providerMeta: synced.meta };
  },

  async deleteAgent(ctx, providerAgentId, meta) {
    await req(ctx, `/v1/convai/agents/${encodeURIComponent(providerAgentId)}`, { method: "DELETE", allow404: true });
    for (const [key, id] of Object.entries(meta)) if (key.startsWith("tool_")) await req(ctx, `/v1/convai/tools/${encodeURIComponent(id)}`, { method: "DELETE", allow404: true }).catch(() => undefined);
  },

  async syncKbItem(ctx, item) {
    if (item.providerDocId) return { providerDocId: item.providerDocId };
    const name = item.name.slice(0, 120) || `Document ${item.id}`;
    let res: unknown;
    if (item.kind === "url") {
      if (!/^https?:\/\//.test(item.url)) throw new ProviderError("validation", "The knowledge-base URL is not valid.");
      res = await req(ctx, "/v1/convai/knowledge-base/url", { method: "POST", json: { url: item.url, name } });
    } else if (item.kind === "text") {
      if (!item.text.trim()) throw new ProviderError("validation", "The knowledge-base text is empty.");
      res = await req(ctx, "/v1/convai/knowledge-base/text", { method: "POST", json: { text: item.text, name } });
    } else {
      if (!item.file) throw new ProviderError("validation", "The knowledge-base file is missing.");
      const bytes = new Uint8Array(await new Response(await item.file.open()).arrayBuffer());
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: item.file.mime }), item.file.filename);
      form.append("name", name);
      res = await req(ctx, "/v1/convai/knowledge-base/file", { method: "POST", form });
    }
    const id = asStr(asObj(res).id);
    if (!id) throw new ProviderError("unknown", "ElevenLabs did not return a document id.");
    return { providerDocId: id };
  },

  async deleteKbItem(ctx, providerDocId) {
    await req(ctx, `/v1/convai/knowledge-base/${encodeURIComponent(providerDocId)}?force=true`, { method: "DELETE", allow404: true });
  },

  async importNumber(ctx, spec) {
    let body: Record<string, unknown>;
    if (spec.carrier === "twilio") {
      if (!spec.twilio) throw new ProviderError("validation", "Twilio Account SID and auth token are required.");
      body = { provider: "twilio", phone_number: spec.e164, label: spec.label || spec.e164, sid: spec.twilio.accountSid, token: spec.twilio.authToken };
    } else {
      if (!spec.sip?.terminationUri) throw new ProviderError("validation", "The SIP trunk address is required.");
      const address = spec.sip.terminationUri.replace(/^sips?:/i, "");
      const credentials = spec.sip.username ? { username: spec.sip.username, password: spec.sip.password } : undefined;
      body = {
        provider: "sip_trunk",
        phone_number: spec.e164,
        label: spec.label || spec.e164,
        outbound_trunk_config: { address, transport: "auto", media_encryption: "allowed", ...(credentials ? { credentials } : {}) },
        inbound_trunk_config: { media_encryption: "allowed", ...(credentials ? { credentials } : {}) },
      };
    }
    const id = asStr(asObj(await req(ctx, "/v1/convai/phone-numbers", { method: "POST", json: body })).phone_number_id);
    if (!id) throw new ProviderError("unknown", "ElevenLabs did not return a phone number id.");
    return { providerNumberId: id, e164: spec.e164 };
  },

  async releaseNumber(ctx, providerNumberId) {
    await req(ctx, `/v1/convai/phone-numbers/${encodeURIComponent(providerNumberId)}`, { method: "DELETE", allow404: true });
  },

  async setInboundAgent(ctx, providerNumberId, providerAgentId) {
    await req(ctx, `/v1/convai/phone-numbers/${encodeURIComponent(providerNumberId)}`, { method: "PATCH", json: { agent_id: providerAgentId } });
  },

  async startCall(ctx, input) {
    if (!input.agent.providerAgentId) throw new ProviderError("validation", "The agent is not synced with ElevenLabs.");
    if (!input.fromNumberId) throw new ProviderError("validation", "The caller id number is not imported into ElevenLabs.");
    const number = asObj(await req(ctx, `/v1/convai/phone-numbers/${encodeURIComponent(input.fromNumberId)}`));
    const sip = asStr(number.provider) === "sip_trunk";
    const tags = encodeCallTags(input.metadata);
    const body = {
      agent_id: input.agent.providerAgentId,
      agent_phone_number_id: input.fromNumberId,
      to_number: input.to,
      conversation_initiation_client_data: {
        dynamic_variables: { ...toProviderVariables(input.variables), ...tags },
        user_id: input.metadata.workspaceId ? `workspace-${input.metadata.workspaceId}` : undefined,
      },
    };
    const res = asObj(await req(ctx, sip ? "/v1/convai/sip-trunk/outbound-call" : "/v1/convai/twilio/outbound-call", { method: "POST", json: body }));
    const id = asStr(res.conversation_id);
    if (res.success === false || !id) throw new ProviderError("validation", `ElevenLabs: ${asStr(res.message) || "the call could not be started."}`);
    return { providerCallId: id };
  },

  async createWebCall(ctx, agent) {
    if (!agent.providerAgentId) throw new ProviderError("validation", "The agent is not synced with ElevenLabs.");
    const res = asObj(await req(ctx, `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent.providerAgentId)}&include_conversation_id=true`));
    const url = asStr(res.signed_url);
    if (!url) throw new ProviderError("unknown", "ElevenLabs did not return a signed URL.");
    let conversationId: string | null = null;
    try {
      conversationId = new URL(url).searchParams.get("conversation_id");
    } catch {
      // Not a URL we can read.
    }
    return { sdk: "elevenlabs", token: "", url, providerCallId: conversationId, expiresAt: new Date(ctx.now() + 15 * 60_000).toISOString() };
  },

  async verifyWebhook(headers, rawBody, secret, nowMs = Date.now()) {
    const header = headers["elevenlabs-signature"];
    if (!header || !secret) return false;
    const parts = parseSignatureHeader(header);
    const t = Number(parts.get("t")?.[0]);
    if (!Number.isFinite(t) || Math.abs(nowMs - t * 1000) > TOLERANCE_MS) return false;
    const expected = hmacHex(secret, `${parts.get("t")![0]}.${rawBody}`);
    return (parts.get("v0") ?? []).some((sig) => safeEqual(sig, expected));
  },

  parseWebhook(body) {
    const o = asObj(body);
    const type = asStr(o.type);
    const data = asObj(o.data);
    const at = isoOf(o.event_timestamp, "s") ?? new Date().toISOString();
    if (type === "post_call_transcription") {
      const conv = parseConversation(data);
      if (!conv) return [];
      const d = conv.details;
      const base = { provider: "elevenlabs" as const, providerCallId: conv.conversationId, metadata: d.metadata };
      const out: NormalizedCallEvent[] = [{ ...base, eventId: `${conv.conversationId}:started`, at: d.startedAt ?? at, type: "started", direction: d.direction, from: d.from, to: d.to, providerAgentId: conv.providerAgentId || null }];
      if (d.status === "in_progress") return out;
      const firstAgent = d.transcript.find((x) => x.role === "agent");
      out.push({
        ...base,
        eventId: `${conv.conversationId}:ended`,
        at,
        type: "ended",
        status: d.status,
        endReason: d.endReason ?? "unknown",
        durationSec: d.durationSec,
        costMicros: d.costMicros,
        startedAt: d.startedAt,
        endedAt: d.endedAt ?? at,
        transcript: d.transcript,
        recordingUrl: "",
        disclosurePlayed: firstAgent ? hasAiDisclosure(firstAgent.text) : null,
        latencyMs: null,
      });
      if (d.status === "completed" || d.status === "voicemail") out.push({ ...base, eventId: `${conv.conversationId}:analyzed`, at, type: "analysis_ready", summary: d.summary, sentiment: d.sentiment, extracted: d.extracted, success: conv.success });
      return out;
    }
    if (type === "call_initiation_failure") {
      const conversationId = asStr(data.conversation_id);
      if (!conversationId) return [];
      const reason = asStr(data.failure_reason);
      const status: CallStatus = reason === "busy" ? "busy" : reason === "no-answer" ? "no_answer" : "failed";
      const failure = asObj(asObj(data.metadata).body);
      const base = { eventId: `${conversationId}:initfail`, provider: "elevenlabs" as const, providerCallId: conversationId, at, metadata: decodeCallTags(asObj(asObj(data.conversation_initiation_client_data).dynamic_variables)) };
      if (status === "failed") return [{ ...base, type: "failed", endReason: "error", error: (asStr(failure.error_reason) || asStr(failure.CallStatus) || "The call could not be connected.").slice(0, 300) }];
      return [{ ...base, type: "ended", status, endReason: status === "busy" ? "busy" : "no_answer", durationSec: 0, costMicros: 0, startedAt: null, endedAt: at, transcript: [], recordingUrl: "", disclosurePlayed: null, latencyMs: null }];
    }
    return [];
  },

  async getCall(ctx, providerCallId) {
    const res = await req(ctx, `/v1/convai/conversations/${encodeURIComponent(providerCallId)}`, { allow404: true });
    if (res === null) return null;
    return parseConversation(asObj(res))?.details ?? null;
  },

  async deleteCall(ctx, providerCallId) {
    await req(ctx, `/v1/convai/conversations/${encodeURIComponent(providerCallId)}`, { method: "DELETE", allow404: true });
  },

  async fetchRecording(ctx, providerCallId) {
    const res = (await req(ctx, `/v1/convai/conversations/${encodeURIComponent(providerCallId)}/audio`, { raw: true, allow404: true, headers: { Accept: "audio/*" } })) as Response | null;
    if (!res || !res.body) return null;
    const size = Number(res.headers.get("content-length"));
    return { body: res.body, mime: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg", size: Number.isFinite(size) && size > 0 ? size : null };
  },
};

registerProvider(elevenLabsProvider);
