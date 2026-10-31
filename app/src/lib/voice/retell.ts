import crypto from "node:crypto";
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
import { apiBase, asArr, asNum, asObj, asStr, hmacHex, isoOf, providerRequest, safeEqual, type RequestOptions } from "./http";
import { agentTemplates, fieldDescription, parametersSchema, promptAppendix, toProviderVariables } from "./vars";

/**
 * Retell AI adapter. API: https://api.retellai.com, header Authorization: Bearer <key>.
 *
 * - Agent = a Retell LLM (prompt, begin message, tools, knowledge base) + an agent (voice,
 *   language, webhook URL, limits, voicemail, post-call analysis fields). Updates apply to the
 *   latest (draft) version, which numbers and calls use.
 * - Knowledge base: one Retell knowledge base per agent holding all its documents (Retell charges
 *   per knowledge base), rebuilt when the documents change.
 * - Numbers: buy (US/CA) with create-phone-number, import any SIP trunk with import-phone-number;
 *   the number id is the E.164 number itself; inbound routing = inbound_agents [{agent_id, weight}].
 * - Calls: /v2/create-phone-call and /v2/create-web-call with metadata (our dz_* tags) and
 *   retell_llm_dynamic_variables.
 * - Webhooks: call_started / call_ended / call_analyzed (+ call_inbound for per-number routing),
 *   x-retell-signature: v=<unix ms>,d=<hex HMAC-SHA256(api key, body + ms)>, ±5 minutes.
 * - Erasure: DELETE /v2/delete-call/{id} removes the call and its data (422 "cannot find" = gone).
 */

const BASE = "https://api.retellai.com";
const TOLERANCE_MS = 5 * 60_000;
const OPT_OUT_FIELD = "dz_opted_out";
const DEFAULT_VOICE = "11labs-Adrian";
const DEFAULT_MODEL = "gpt-4.1-mini";

function req(ctx: ProviderContext, path: string, options: RequestOptions = {}) {
  return providerRequest(ctx, `${apiBase(ctx, BASE)}${path}`, { ...options, headers: { Authorization: `Bearer ${ctx.keys.apiKey}`, ...(options.headers ?? {}) } });
}

const RETELL_LANGUAGES = ["en-US", "en-GB", "en-IN", "en-AU", "en-NZ", "hi-IN", "ar-SA", "es-ES", "es-419", "fr-FR", "fr-CA", "de-DE", "it-IT", "pt-BR", "pt-PT", "nl-NL", "pl-PL", "ja-JP", "zh-CN", "ko-KR", "tr-TR", "ru-RU", "id-ID", "vi-VN", "ur-IN", "ta-IN", "bn-IN"];
const PRIMARY: Record<string, string> = { en: "en-US", hi: "hi-IN", ar: "ar-SA", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR", nl: "nl-NL", pl: "pl-PL", ja: "ja-JP", zh: "zh-CN", ko: "ko-KR", tr: "tr-TR", ru: "ru-RU", id: "id-ID" };

export function retellLanguage(tag: string): string {
  if (RETELL_LANGUAGES.includes(tag)) return tag;
  return PRIMARY[tag.split("-")[0].toLowerCase()] ?? "en-US";
}

function tools(agent: AgentSpec, list: ToolSpec[]) {
  const out: Array<Record<string, unknown>> = [{ type: "end_call", name: "end_call", description: list.find((t) => t.kind === "end_call")?.description ?? "End the call when the conversation is over or the caller asks not to be called again." }];
  let transfer = false;
  for (const t of list) {
    if (t.kind === "transfer" && t.transfer?.number) {
      transfer = true;
      out.push({ type: "transfer_call", name: t.name, description: t.description, transfer_destination: { type: "predefined", number: t.transfer.number }, transfer_option: { type: "cold_transfer" }, speak_during_execution: true });
    } else if (t.url) {
      out.push({
        type: "custom",
        name: t.name,
        description: t.description,
        url: t.url,
        method: "POST",
        headers: { "X-Dialzen-Tool-Secret": t.secret },
        parameters: parametersSchema(t.parameters),
        speak_during_execution: true,
        execution_message_description: "Briefly tell the caller you are checking.",
        speak_after_execution: true,
        timeout_ms: 10_000,
      });
    }
  }
  if (!transfer && agent.settings.transferNumber) out.push({ type: "transfer_call", name: "transfer_to_human", description: "Transfer the caller to a team member when they ask for a person or you cannot help.", transfer_destination: { type: "predefined", number: agent.settings.transferNumber }, transfer_option: { type: "cold_transfer" }, speak_during_execution: true });
  return out;
}

function analysisData(agent: AgentSpec) {
  const out: Array<Record<string, unknown>> = agent.settings.analysisFields.map((f) => {
    if (f.type === "enum") return { type: "enum", name: f.key, description: f.description || f.label, choices: f.options };
    if (f.type === "boolean") return { type: "boolean", name: f.key, description: f.description || f.label };
    if (f.type === "number") return { type: "number", name: f.key, description: f.description || f.label };
    return { type: "string", name: f.key, description: fieldDescription(f) };
  });
  out.push({ type: "boolean", name: OPT_OUT_FIELD, description: "True when the caller asked not to be called again or to be removed from a list." });
  return out;
}

const kbHash = (docs: KbDoc[]) =>
  crypto
    .createHash("sha256")
    .update(docs.map((d) => `${d.id}:${d.kind}:${d.url}:${d.text.length}:${d.file?.size ?? 0}`).join("|"))
    .digest("hex")
    .slice(0, 16);

/** One knowledge base per agent with all its documents; recreated when they change. */
async function syncKnowledgeBase(ctx: ProviderContext, agent: AgentSpec, docs: KbDoc[], meta: Record<string, string>): Promise<{ id: string; hash: string }> {
  const hash = docs.length ? kbHash(docs) : "";
  if (hash === (meta.kb_hash ?? "") && (meta.kb_id || !hash)) return { id: meta.kb_id ?? "", hash };
  let id = "";
  if (docs.length) {
    const form = new FormData();
    form.append("knowledge_base_name", `dz-${agent.id}-${hash.slice(0, 8)}`.slice(0, 39));
    const texts = docs.filter((d) => d.kind === "text" && d.text.trim()).map((d) => ({ title: d.name.slice(0, 100) || `Note ${d.id}`, text: d.text }));
    const urls = docs.filter((d) => d.kind === "url" && /^https?:\/\//.test(d.url)).map((d) => d.url);
    if (texts.length) form.append("knowledge_base_texts", JSON.stringify(texts));
    if (urls.length) form.append("knowledge_base_urls", JSON.stringify(urls));
    for (const d of docs.filter((x) => x.kind === "file" && x.file)) {
      const bytes = new Uint8Array(await new Response(await d.file!.open()).arrayBuffer());
      form.append("knowledge_base_files", new Blob([bytes], { type: d.file!.mime }), d.file!.filename);
    }
    id = asStr(asObj(await req(ctx, "/create-knowledge-base", { method: "POST", form })).knowledge_base_id);
    if (!id) throw new ProviderError("unknown", "Retell did not return a knowledge base id.");
  }
  if (meta.kb_id) await req(ctx, `/delete-knowledge-base/${encodeURIComponent(meta.kb_id)}`, { method: "DELETE", allow404: true }).catch(() => undefined);
  return { id, hash };
}

// ── Call parsing ──

const STATUS_BY_REASON: Record<string, CallStatus> = {
  dial_busy: "busy",
  dial_no_answer: "no_answer",
  voicemail_reached: "voicemail",
  dial_failed: "failed",
  invalid_destination: "failed",
  telephony_provider_permission_denied: "failed",
  telephony_provider_unavailable: "failed",
  sip_routing_error: "failed",
  marked_as_spam: "failed",
  network_blocked: "failed",
  user_declined: "no_answer",
  concurrency_limit_reached: "failed",
  no_concurrency_fallback: "failed",
  no_valid_payment: "failed",
  credit_exhausted: "failed",
  budget_reached: "failed",
  scam_detected: "failed",
  registered_call_timeout: "failed",
  error_user_not_joined: "failed",
  manual_stopped: "canceled",
};

const END_BY_REASON: Record<string, EndReason> = {
  user_hangup: "caller_hangup",
  agent_hangup: "agent_hangup",
  user_requested_dnc: "opt_out",
  user_requested_callback: "agent_hangup",
  call_transfer: "transferred",
  transfer_bridged: "transferred",
  voicemail_reached: "voicemail",
  ivr_reached: "voicemail",
  inactivity: "silence_timeout",
  max_duration_reached: "max_duration",
  dial_busy: "busy",
  dial_no_answer: "no_answer",
  user_declined: "rejected",
  manual_stopped: "canceled",
};

function statusOf(call: Record<string, unknown>): CallStatus {
  const s = asStr(call.call_status);
  if (s === "registered" || s === "ongoing") return s === "ongoing" ? "in_progress" : "ringing";
  const reason = asStr(call.disconnection_reason);
  if (STATUS_BY_REASON[reason]) return STATUS_BY_REASON[reason];
  if (asObj(call.call_analysis).in_voicemail === true) return "voicemail";
  if (s === "error" || reason.startsWith("error_")) return "failed";
  if (s === "not_connected") return "no_answer";
  return "completed";
}

function turnsOf(call: Record<string, unknown>): TranscriptTurn[] {
  return asArr(call.transcript_object)
    .map(asObj)
    .map((u) => {
      const text = asStr(u.content).trim();
      if (!text || (u.role !== "agent" && u.role !== "user")) return null;
      const first = asObj(asArr(u.words)[0]);
      return { role: u.role === "agent" ? "agent" : "caller", text: text.slice(0, 5000), at: Math.max(0, Math.round((asNum(first.start) ?? 0) * 10) / 10) } as TranscriptTurn;
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

/** A Retell call object → our call details. */
export function parseRetellCall(callRaw: unknown): (ProviderCallDetails & { providerAgentId: string; success: boolean | null }) | null {
  const call = asObj(callRaw);
  const id = asStr(call.call_id);
  if (!id) return null;
  const status = statusOf(call);
  const reason = asStr(call.disconnection_reason);
  const startedAt = isoOf(call.start_timestamp, "ms");
  const endedAt = isoOf(call.end_timestamp, "ms");
  const durationMs = asNum(call.duration_ms) ?? (startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : 0);
  const analysis = asObj(call.call_analysis);
  const custom = asObj(analysis.custom_analysis_data);
  const extracted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(custom)) {
    if (v === null || v === undefined || v === "") continue;
    if (k === OPT_OUT_FIELD) {
      if (v === true || v === "true") extracted.opted_out = true;
    } else extracted[k] = v;
  }
  const sentimentRaw = asStr(analysis.user_sentiment).toLowerCase();
  const cents = asNum(asObj(call.call_cost).combined_cost);
  const direction = asStr(call.call_type) === "web_call" ? "web" : call.direction === "inbound" ? "inbound" : call.direction === "outbound" ? "outbound" : null;
  const final = !["ringing", "in_progress"].includes(status);
  return {
    providerCallId: id,
    providerAgentId: asStr(call.agent_id),
    status,
    endReason: final ? (END_BY_REASON[reason] ?? (status === "failed" ? "error" : status === "voicemail" ? "voicemail" : "unknown")) : null,
    direction,
    from: asStr(call.from_number),
    to: asStr(call.to_number),
    startedAt,
    endedAt,
    durationSec: Math.max(0, Math.round(durationMs / 1000)),
    // combined_cost is in cents (USD).
    costMicros: cents === null ? null : Math.round(cents * 10_000),
    transcript: turnsOf(call),
    summary: asStr(analysis.call_summary),
    sentiment: sentimentRaw === "positive" || sentimentRaw === "negative" || sentimentRaw === "neutral" ? sentimentRaw : "unknown",
    extracted,
    recordingUrl: asStr(call.recording_url),
    latencyMs: asNum(asObj(asObj(call.latency).e2e).p50),
    metadata: decodeCallTags({ ...asObj(call.retell_llm_dynamic_variables), ...asObj(call.metadata) }),
    success: typeof analysis.call_successful === "boolean" ? analysis.call_successful : null,
  };
}

function eventsOf(event: string, callRaw: unknown, at: string): NormalizedCallEvent[] {
  const d = parseRetellCall(callRaw);
  if (!d) return [];
  const base = { provider: "retell" as const, providerCallId: d.providerCallId, metadata: d.metadata };
  const started: NormalizedCallEvent = { ...base, eventId: `${d.providerCallId}:started`, at: d.startedAt ?? at, type: "started", direction: d.direction, from: d.from, to: d.to, providerAgentId: d.providerAgentId || null };
  if (event === "call_started") return [started];
  if (event === "transcript_updated") return [{ ...base, eventId: `${d.providerCallId}:transcript:${d.transcript.length}`, at, type: "transcript", transcript: d.transcript }];
  if (event !== "call_ended" && event !== "call_analyzed") return [];
  const out: NormalizedCallEvent[] = [];
  if (d.startedAt) out.push(started);
  const firstAgent = d.transcript.find((t) => t.role === "agent");
  if (d.status !== "ringing" && d.status !== "in_progress") {
    out.push({
      ...base,
      eventId: `${d.providerCallId}:ended`,
      at,
      type: "ended",
      status: d.status,
      endReason: d.endReason ?? "unknown",
      durationSec: d.durationSec,
      costMicros: d.costMicros,
      startedAt: d.startedAt,
      endedAt: d.endedAt ?? at,
      transcript: d.transcript,
      recordingUrl: d.recordingUrl,
      disclosurePlayed: firstAgent ? hasAiDisclosure(firstAgent.text) : null,
      latencyMs: d.latencyMs,
    });
  }
  if (event === "call_analyzed") out.push({ ...base, eventId: `${d.providerCallId}:analyzed`, at, type: "analysis_ready", summary: d.summary, sentiment: d.sentiment, extracted: d.extracted, success: d.success });
  return out;
}

/** The per-number inbound webhook (event "call_inbound"): who is calling which number. */
export function parseRetellInbound(body: unknown): { callId: string; from: string; to: string; agentId: string } | null {
  const o = asObj(body);
  if (o.event !== "call_inbound") return null;
  const c = asObj(o.call_inbound);
  return { callId: asStr(c.call_id), from: asStr(c.from_number), to: asStr(c.to_number), agentId: asStr(c.agent_id) };
}

/** Signs a body as Retell does (tests and our own simulations). */
export function signRetellBody(rawBody: string, apiKey: string, nowMs = Date.now()): string {
  return `v=${nowMs},d=${hmacHex(apiKey, `${rawBody}${nowMs}`)}`;
}

export const retellProvider: VoiceProvider = {
  id: "retell",
  capabilities: {
    numbersPurchase: true,
    purchaseCountries: ["US", "CA"],
    // Twilio numbers come in through a Twilio Elastic SIP trunk (its termination URI).
    numbersImport: ["sip", "telnyx", "plivo", "exotel"],
    outbound: true,
    webCall: true,
    knowledgeBase: true,
    warmTransfer: false,
    voicemailDetection: true,
    perAgentWebhook: true,
    inboundWebhook: true,
    recordings: "url",
    costInWebhook: true,
    languages: ["en", "hi", "ar", "es", "fr", "de", "it", "pt", "nl", "pl", "ja", "zh", "ko", "tr", "ru", "id", "vi", "ur", "ta", "bn"],
  },

  async testConnection(ctx) {
    try {
      const res = asObj(await req(ctx, "/get-concurrency"));
      const current = asNum(res.current_concurrency) ?? 0;
      const limit = asNum(res.concurrency_limit) ?? 0;
      return { ok: true, account: "Retell AI account", detail: `Concurrency ${current} of ${limit} lines in use.` };
    } catch (error) {
      return { ok: false, error: error instanceof ProviderError ? error : new ProviderError("unknown", "Connection failed.") };
    }
  },

  async listVoices(ctx) {
    return asArr(await req(ctx, "/list-voices"))
      .map(asObj)
      .map((v) => {
        const gender = asStr(v.gender).toLowerCase();
        return {
          id: asStr(v.voice_id),
          name: asStr(v.voice_name),
          // Retell voices are multilingual: the agent's language decides.
          languages: [] as string[],
          gender: (gender === "female" || gender === "male" ? gender : "") as "female" | "male" | "",
          accent: [asStr(v.accent), asStr(v.provider)].filter(Boolean).join(" · "),
          previewUrl: asStr(v.preview_audio_url),
        };
      })
      .filter((v) => v.id);
  },

  async syncAgent(ctx, agent, toolSpecs, kb) {
    const meta = { ...agent.providerMeta };
    const t = agentTemplates(agent);
    const appendix = promptAppendix(agent);
    const knowledge = await syncKnowledgeBase(ctx, agent, kb, meta);
    const llmBody = {
      model: agent.llm || DEFAULT_MODEL,
      model_temperature: agent.settings.temperature,
      start_speaker: "agent",
      begin_message: t.firstMessage,
      general_prompt: appendix ? `${t.prompt}\n\n${appendix}` : t.prompt,
      general_tools: tools(agent, toolSpecs),
      knowledge_base_ids: knowledge.id ? [knowledge.id] : [],
      default_dynamic_variables: t.defaults,
    };
    let llmId = meta.llm_id ?? "";
    if (llmId) {
      const res = await req(ctx, `/update-retell-llm/${encodeURIComponent(llmId)}`, { method: "PATCH", json: llmBody, allow404: true });
      if (res === null) llmId = "";
    }
    if (!llmId) llmId = asStr(asObj(await req(ctx, "/create-retell-llm", { method: "POST", json: llmBody })).llm_id);
    if (!llmId) throw new ProviderError("unknown", "Retell did not return an LLM id.");

    const sensitivity = { low: 0.3, medium: 0.7, high: 1 }[agent.settings.interruptionSensitivity];
    const agentBody = {
      response_engine: { type: "retell-llm", llm_id: llmId },
      voice_id: agent.voiceId || DEFAULT_VOICE,
      agent_name: `${agent.name} (#${agent.id})`.slice(0, 120),
      language: retellLanguage(agent.language),
      webhook_url: agent.webhookUrl,
      webhook_events: ["call_started", "call_ended", "call_analyzed"],
      max_call_duration_ms: Math.max(60_000, agent.settings.maxDurationSec * 1000),
      end_call_after_silence_ms: Math.max(10_000, agent.settings.silenceTimeoutSec * 1000),
      interruption_sensitivity: sensitivity,
      voice_speed: Math.min(2, Math.max(0.5, agent.settings.speed)),
      voicemail_option: agent.settings.voicemailAction === "leave_message" && t.voicemail ? { action: { type: "static_text", text: t.voicemail } } : { action: { type: "hangup" } },
      post_call_analysis_data: analysisData(agent),
    };
    let id = agent.providerAgentId;
    if (id) {
      const res = await req(ctx, `/update-agent/${encodeURIComponent(id)}`, { method: "PATCH", json: agentBody, allow404: true });
      if (res === null) id = null;
    }
    if (!id) id = asStr(asObj(await req(ctx, "/create-agent", { method: "POST", json: agentBody })).agent_id);
    if (!id) throw new ProviderError("unknown", "Retell did not return an agent id.");
    return { providerAgentId: id, providerMeta: { llm_id: llmId, ...(knowledge.id ? { kb_id: knowledge.id, kb_hash: knowledge.hash } : {}) } };
  },

  async deleteAgent(ctx, providerAgentId, meta) {
    await req(ctx, `/delete-agent/${encodeURIComponent(providerAgentId)}`, { method: "DELETE", allow404: true });
    if (meta.llm_id) await req(ctx, `/delete-retell-llm/${encodeURIComponent(meta.llm_id)}?force_delete=true`, { method: "DELETE", allow404: true }).catch(() => undefined);
    if (meta.kb_id) await req(ctx, `/delete-knowledge-base/${encodeURIComponent(meta.kb_id)}`, { method: "DELETE", allow404: true }).catch(() => undefined);
  },

  // Documents are uploaded with the agent's knowledge base in syncAgent().
  async syncKbItem(_ctx, item) {
    if (item.kind === "url" && !/^https?:\/\//.test(item.url)) throw new ProviderError("validation", "The knowledge-base URL is not valid.");
    if (item.kind === "text" && !item.text.trim()) throw new ProviderError("validation", "The knowledge-base text is empty.");
    if (item.kind === "file" && !item.file) throw new ProviderError("validation", "The knowledge-base file is missing.");
    return { providerDocId: `kb-item-${item.id}` };
  },
  async deleteKbItem() {},

  async buyNumber(ctx, input) {
    if (!["US", "CA"].includes(input.country)) throw new ProviderError("unsupported", "Retell sells numbers in the US and Canada only.");
    const body: Record<string, unknown> = { country_code: input.country, toll_free: input.tollFree };
    if (!input.tollFree) body.area_code = Number(input.areaCode);
    const res = asObj(await req(ctx, "/create-phone-number", { method: "POST", json: body }));
    const e164 = asStr(res.phone_number);
    if (!e164) throw new ProviderError("unknown", "Retell did not return a number.");
    return { providerNumberId: e164, e164 };
  },

  async importNumber(ctx, spec) {
    if (!spec.sip?.terminationUri) throw new ProviderError("validation", "Retell imports numbers through a SIP trunk: enter its termination URI (e.g. yourtrunk.pstn.twilio.com).");
    const res = asObj(
      await req(ctx, "/import-phone-number", {
        method: "POST",
        json: {
          phone_number: spec.e164,
          termination_uri: spec.sip.terminationUri.replace(/^sips?:/i, ""),
          ...(spec.sip.username ? { sip_trunk_auth_username: spec.sip.username, sip_trunk_auth_password: spec.sip.password } : {}),
          nickname: spec.label.slice(0, 60) || undefined,
        },
      }),
    );
    const e164 = asStr(res.phone_number) || spec.e164;
    return { providerNumberId: e164, e164 };
  },

  async releaseNumber(ctx, providerNumberId) {
    await req(ctx, `/delete-phone-number/${encodeURIComponent(providerNumberId)}`, { method: "DELETE", allow404: true });
  },

  async setInboundAgent(ctx, providerNumberId, providerAgentId, inboundWebhookUrl) {
    await req(ctx, `/update-phone-number/${encodeURIComponent(providerNumberId)}`, {
      method: "PATCH",
      json: { inbound_agents: providerAgentId ? [{ agent_id: providerAgentId, weight: 1 }] : [], inbound_webhook_url: providerAgentId && inboundWebhookUrl ? inboundWebhookUrl : null },
    });
  },

  async startCall(ctx, input) {
    if (!input.agent.providerAgentId) throw new ProviderError("validation", "The agent is not synced with Retell.");
    const tags = encodeCallTags(input.metadata);
    const res = asObj(
      await req(ctx, "/v2/create-phone-call", {
        method: "POST",
        json: { from_number: input.from, to_number: input.to, override_agent_id: input.agent.providerAgentId, metadata: tags, retell_llm_dynamic_variables: { ...toProviderVariables(input.variables), ...tags } },
      }),
    );
    const id = asStr(res.call_id);
    if (!id) throw new ProviderError("unknown", "Retell did not return a call id.");
    return { providerCallId: id };
  },

  async createWebCall(ctx, agent, metadata) {
    if (!agent.providerAgentId) throw new ProviderError("validation", "The agent is not synced with Retell.");
    const tags = encodeCallTags(metadata);
    const res = asObj(await req(ctx, "/v2/create-web-call", { method: "POST", json: { agent_id: agent.providerAgentId, metadata: tags, retell_llm_dynamic_variables: tags } }));
    const token = asStr(res.access_token);
    if (!token) throw new ProviderError("unknown", "Retell did not return an access token.");
    return { sdk: "retell", token, url: "", providerCallId: asStr(res.call_id) || null, expiresAt: new Date(ctx.now() + 30_000).toISOString() };
  },

  async verifyWebhook(headers, rawBody, secret, nowMs = Date.now()) {
    const header = headers["x-retell-signature"];
    if (!header || !secret) return false;
    const m = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(header.trim());
    if (!m) return false;
    const ts = Number(m[1]);
    if (!Number.isSafeInteger(ts) || Math.abs(nowMs - ts) > TOLERANCE_MS) return false;
    return safeEqual(m[2].toLowerCase(), hmacHex(secret, `${rawBody}${m[1]}`));
  },

  parseWebhook(body) {
    const o = asObj(body);
    const event = asStr(o.event);
    const at = isoOf(o.event_timestamp, "ms") ?? new Date().toISOString();
    return eventsOf(event, o.call, at);
  },

  async getCall(ctx, providerCallId) {
    const res = await req(ctx, `/v2/get-call/${encodeURIComponent(providerCallId)}`, { allow404: true });
    if (res === null) return null;
    const d = parseRetellCall(res);
    if (!d) return null;
    const { providerAgentId: _a, success: _s, ...details } = d;
    void _a;
    void _s;
    return details;
  },

  async deleteCall(ctx, providerCallId) {
    try {
      await req(ctx, `/v2/delete-call/${encodeURIComponent(providerCallId)}`, { method: "DELETE", allow404: true });
    } catch (error) {
      // Retell answers 422 "Cannot find requested asset under given api key" for unknown calls.
      if (error instanceof ProviderError && error.status === 422 && /cannot find|not found/i.test(error.message)) return;
      throw error;
    }
  },

  async fetchRecording(ctx, providerCallId) {
    const call = await req(ctx, `/v2/get-call/${encodeURIComponent(providerCallId)}`, { allow404: true });
    const url = asStr(asObj(call).recording_url);
    if (!url) return null;
    let res: Response;
    try {
      res = await ctx.fetch(url, { signal: AbortSignal.timeout(Math.max(10_000, ctx.timeoutMs)) });
    } catch {
      throw new ProviderError("network", "Could not download the Retell recording.");
    }
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok || !res.body) throw new ProviderError("network", `Retell recording download failed (HTTP ${res.status}).`, { status: res.status });
    const size = Number(res.headers.get("content-length"));
    return { body: res.body, mime: res.headers.get("content-type")?.split(";")[0] || "audio/wav", size: Number.isFinite(size) && size > 0 ? size : null };
  },

  async listCallsSince(ctx, sinceIso, limit) {
    const res = asObj(await req(ctx, "/v3/list-calls", { method: "POST", json: { filter_criteria: { start_timestamp: { type: "number", op: "ge", value: Date.parse(sinceIso) } }, sort_order: "ascending", limit: Math.min(1000, Math.max(1, limit)) } }));
    return asArr(res.items)
      .map((c) => parseRetellCall(c))
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map(({ providerAgentId: _a, success: _s, ...details }) => {
        void _a;
        void _s;
        return details;
      });
  },
};

registerProvider(retellProvider);
