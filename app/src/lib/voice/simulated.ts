import crypto from "node:crypto";
import { registerProvider } from "@/lib/providers";
import { decodeCallTags, encodeCallTags } from "@/voice/normalize";
import {
  ProviderError,
  type CallTags,
  type NormalizedCallEvent,
  type ProviderCallDetails,
  type TranscriptTurn,
  type VoiceProvider,
  type WebhookHeaders,
} from "@/voice/types";
import { asArr, asNum, asObj, asStr, endReasonOf, hmacHex, parseSignatureHeader, safeEqual } from "./http";
import { buildSimScript, SIM_OUTCOMES, type SimOutcome } from "./sim-script";
import { toProviderTemplate, toProviderVariables } from "./vars";

/**
 * The Simulated provider (demo mode and tests): the whole VoiceProvider interface with no
 * external calls and no audio. startCall() decides the call up front (sim-script.ts) and hands
 * webhook-shaped events with delays to a scheduler; the app's scheduler (sim-store.ts) stores
 * them and a job delivers them, signed, through the real webhook ingest, so the dashboard updates
 * live exactly as with a real provider.
 *
 * Webhook format (JSON): { type: "call.started" | "call.transcript" | "call.ended" |
 * "call.analyzed" | "call.tool" | "call.failed", event_id, call_id, at, metadata, … }, signed
 * with header X-Dialzen-Sim-Signature: t=<unix ms>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>.
 */

export const SIM_SIGNATURE_HEADER = "x-dialzen-sim-signature";
const TOLERANCE_MS = 5 * 60_000;

export interface SimScheduledEvent {
  providerCallId: string;
  workspaceId: number | null;
  seq: number;
  /** Delay from now, ms. */
  delayMs: number;
  body: Record<string, unknown>;
}

type SimScheduler = (events: SimScheduledEvent[]) => Promise<void>;
let scheduler: SimScheduler | null = null;

/** Where startCall() puts its events (the app stores them in voice_sim_events; tests keep them in memory). */
export function setSimulatedScheduler(fn: SimScheduler | null): void {
  scheduler = fn;
}

/** Time compression of simulated calls (test-only env DIALZEN_SIM_SPEED, default 1 = real time). */
function speed(): number {
  const n = Number(process.env.DIALZEN_SIM_SPEED);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

export function signSimulatedBody(rawBody: string, secret: string, nowMs = Date.now()): string {
  return `t=${nowMs},v1=${hmacHex(secret, `${nowMs}.${rawBody}`)}`;
}

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;

export interface SimCallPlanInput {
  agent: Parameters<typeof buildSimScript>[0]["agent"] & { providerAgentId: string | null };
  direction: "inbound" | "outbound" | "web";
  from: string;
  to: string;
  variables: Record<string, string>;
  metadata: Partial<CallTags>;
  providerCallId?: string;
  outcome?: SimOutcome | null;
  now?: number;
}

/** Plans a whole simulated call as scheduled webhook bodies (used by startCall and by inbound / web simulations). */
export function planSimulatedCall(input: SimCallPlanInput): { providerCallId: string; events: SimScheduledEvent[] } {
  const now = input.now ?? Date.now();
  const providerCallId = input.providerCallId ?? newId("sim_call");
  // Our {{contact.first_name|there}} variables → provider style, with the fallbacks as defaults.
  const first = toProviderTemplate(input.agent.firstMessage);
  const vm = toProviderTemplate(input.agent.settings.voicemailMessage);
  const agent = { ...input.agent, firstMessage: first.text, settings: { ...input.agent.settings, voicemailMessage: vm.text } };
  const variables = { ...vm.defaults, ...first.defaults, ...Object.fromEntries(Object.entries(input.variables).filter(([, v]) => v !== "")) };
  const script = buildSimScript({ agent, direction: input.direction, variables, seed: providerCallId, outcome: input.outcome, now });
  const meta = encodeCallTags(input.metadata);
  const k = 1000 / speed();
  const events: SimScheduledEvent[] = [];
  const push = (atSec: number, body: Record<string, unknown>) =>
    events.push({ providerCallId, workspaceId: input.metadata.workspaceId ?? null, seq: events.length + 1, delayMs: Math.round(atSec * k), body: { ...body, event_id: `${providerCallId}:${events.length + 1}`, call_id: providerCallId, metadata: meta } });
  const base = { direction: input.direction, from: input.from, to: input.to, agent_id: input.agent.providerAgentId };

  if (script.status !== "completed" && script.status !== "voicemail") {
    // Never answered: one final event after the ringing time.
    const ring = script.status === "busy" ? 3 : script.status === "failed" ? 2 : 25;
    push(ring, { type: script.status === "failed" ? "call.failed" : "call.ended", ...base, status: script.status, end_reason: script.endReason, duration_sec: 0, cost_micros: 0, error: script.status === "failed" ? "The carrier rejected the call (simulated)." : "" });
    return { providerCallId, events };
  }

  const answer = script.answerDelaySec;
  push(answer, { type: "call.started", ...base });
  // Live transcript: a cumulative update every couple of turns.
  const turns = script.turns;
  for (let i = 1; i < turns.length; i += 2) push(answer + turns[i].at, { type: "call.transcript", transcript: turns.slice(0, i + 1) });
  const end = answer + script.durationSec;
  push(end, {
    type: "call.ended",
    ...base,
    status: script.status,
    end_reason: script.endReason,
    duration_sec: script.durationSec,
    cost_micros: script.costMicros,
    transcript: turns,
    latency_ms: script.latencyMs,
    disclosure_played: script.status === "completed",
    started_offset_sec: answer,
  });
  if (script.status === "completed") {
    push(end + 3, { type: "call.analyzed", summary: script.summary, sentiment: script.sentiment, extracted: script.extracted, success: script.success, outcome: script.outcome });
  }
  return { providerCallId, events };
}

function parseTurns(v: unknown): TranscriptTurn[] {
  return asArr(v)
    .map((t) => {
      const o = asObj(t);
      const role = o.role === "agent" || o.role === "caller" || o.role === "tool" ? o.role : null;
      return role ? { role, text: asStr(o.text).slice(0, 5000), at: Math.max(0, asNum(o.at) ?? 0) } : null;
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

const VOICES = [
  { id: "sim-ava", name: "Ava", languages: ["en-US"], gender: "female" as const, accent: "American" },
  { id: "sim-noah", name: "Noah", languages: ["en-GB"], gender: "male" as const, accent: "British" },
  { id: "sim-priya", name: "Priya", languages: ["hi-IN", "en-IN"], gender: "female" as const, accent: "Indian" },
  { id: "sim-arjun", name: "Arjun", languages: ["hi-IN"], gender: "male" as const, accent: "Indian" },
  { id: "sim-layla", name: "Layla", languages: ["ar-SA", "ar-AE"], gender: "female" as const, accent: "Gulf" },
  { id: "sim-omar", name: "Omar", languages: ["ar-EG", "ar-SA"], gender: "male" as const, accent: "Egyptian" },
  { id: "sim-luna", name: "Luna", languages: [], gender: "neutral" as const, accent: "Multilingual" },
];

export const simulatedProvider: VoiceProvider = {
  id: "simulated",
  capabilities: {
    numbersPurchase: true,
    purchaseCountries: ["US", "CA"],
    numbersImport: ["twilio", "sip", "simulated"],
    outbound: true,
    webCall: true,
    knowledgeBase: true,
    warmTransfer: true,
    voicemailDetection: true,
    perAgentWebhook: false,
    inboundWebhook: false,
    recordings: "none",
    costInWebhook: true,
    languages: ["en", "hi", "ar", "es", "fr", "de"],
  },

  async testConnection() {
    return { ok: true, account: "Simulated provider", detail: "No real calls are placed." };
  },

  async listVoices(_ctx, lang) {
    const want = (lang ?? "").toLowerCase();
    return VOICES.filter((v) => !want || !v.languages.length || v.languages.some((l) => l.toLowerCase() === want || l.toLowerCase().startsWith(`${want.slice(0, 2)}-`))).map((v) => ({ ...v, previewUrl: "" }));
  },

  async syncAgent(_ctx, agent, tools, kb) {
    return {
      providerAgentId: agent.providerAgentId ?? `sim_agent_${agent.id}`,
      providerMeta: { tools: String(tools.length), kb: String(kb.length) },
    };
  },
  async deleteAgent() {},
  async syncKbItem(_ctx, item) {
    return { providerDocId: item.providerDocId ?? `sim_doc_${item.id}` };
  },
  async deleteKbItem() {},

  async buyNumber(_ctx, input) {
    if (!["US", "CA"].includes(input.country)) throw new ProviderError("unsupported", "Simulated numbers can only be bought in the US and Canada.");
    const area = /^\d{3}$/.test(input.areaCode) ? input.areaCode : input.tollFree ? "800" : "415";
    // 555-01XX numbers are reserved for fiction.
    const e164 = `+1${area}55501${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
    return { providerNumberId: `sim_num_${e164.slice(1)}`, e164 };
  },
  async importNumber(_ctx, spec) {
    return { providerNumberId: `sim_num_${spec.e164.replace(/\D/g, "")}`, e164: spec.e164 };
  },
  async releaseNumber() {},
  async setInboundAgent() {},

  async startCall(_ctx, input) {
    if (!scheduler) throw new ProviderError("unsupported", "The simulated call scheduler is not running.");
    const scenario = input.variables.sim_scenario;
    const outcome = (SIM_OUTCOMES as readonly string[]).includes(scenario ?? "") ? (scenario as SimOutcome) : null;
    const plan = planSimulatedCall({
      agent: input.agent,
      direction: "outbound",
      from: input.from,
      to: input.to,
      variables: toProviderVariables(input.variables),
      metadata: input.metadata,
      outcome,
    });
    await scheduler(plan.events);
    return { providerCallId: plan.providerCallId };
  },

  async createWebCall(ctx) {
    return { sdk: "simulated", token: "", url: "", providerCallId: newId("sim_web"), expiresAt: new Date(ctx.now() + 15 * 60_000).toISOString() };
  },

  async verifyWebhook(headers: WebhookHeaders, rawBody: string, secret: string, nowMs = Date.now()) {
    const header = headers[SIM_SIGNATURE_HEADER];
    if (!header || !secret) return false;
    const parts = parseSignatureHeader(header);
    const t = Number(parts.get("t")?.[0]);
    if (!Number.isFinite(t) || Math.abs(nowMs - t) > TOLERANCE_MS) return false;
    const expected = hmacHex(secret, `${t}.${rawBody}`);
    return (parts.get("v1") ?? []).some((sig) => safeEqual(sig, expected));
  },

  parseWebhook(body) {
    const o = asObj(body);
    const type = asStr(o.type);
    const eventId = asStr(o.event_id);
    const providerCallId = asStr(o.call_id);
    if (!eventId || !providerCallId) return [];
    const at = asStr(o.at) || new Date().toISOString();
    const metadata = decodeCallTags(o.metadata);
    const base = { eventId, provider: "simulated" as const, providerCallId, at, metadata };
    const direction = o.direction === "inbound" || o.direction === "outbound" || o.direction === "web" ? o.direction : null;
    const out: NormalizedCallEvent[] = [];
    switch (type) {
      case "call.started":
        out.push({ ...base, type: "started", direction, from: asStr(o.from), to: asStr(o.to), providerAgentId: asStr(o.agent_id) || null });
        break;
      case "call.transcript":
        out.push({ ...base, type: "transcript", transcript: parseTurns(o.transcript) });
        break;
      case "call.ended": {
        const status = (["completed", "no_answer", "busy", "voicemail", "failed", "canceled"] as const).find((s) => s === o.status) ?? "completed";
        const duration = Math.max(0, Math.round(asNum(o.duration_sec) ?? 0));
        const endedAt = at;
        out.push({
          ...base,
          type: "ended",
          status,
          endReason: endReasonOf(o.end_reason, "unknown"),
          durationSec: duration,
          costMicros: asNum(o.cost_micros),
          startedAt: duration > 0 ? new Date(Date.parse(endedAt) - duration * 1000).toISOString() : null,
          endedAt,
          transcript: parseTurns(o.transcript),
          recordingUrl: "",
          disclosurePlayed: typeof o.disclosure_played === "boolean" ? o.disclosure_played : null,
          latencyMs: asNum(o.latency_ms),
        });
        break;
      }
      case "call.analyzed": {
        const sentiment = (["positive", "neutral", "negative"] as const).find((s) => s === o.sentiment) ?? "unknown";
        out.push({ ...base, type: "analysis_ready", summary: asStr(o.summary), sentiment, extracted: asObj(o.extracted), success: typeof o.success === "boolean" ? o.success : null });
        break;
      }
      case "call.tool": {
        const c = asObj(o.tool_call);
        out.push({ ...base, type: "tool_call", call: { name: asStr(c.name), args: asObj(c.args), result: asStr(c.result), ok: c.ok !== false, at: asNum(c.at) ?? 0, durationMs: asNum(c.duration_ms) ?? 0 } });
        break;
      }
      case "call.failed":
        out.push({ ...base, type: "failed", endReason: endReasonOf(o.end_reason, "error"), error: asStr(o.error) || "The call failed." });
        break;
    }
    return out;
  },

  async getCall(): Promise<ProviderCallDetails | null> {
    return null;
  },
  async fetchRecording() {
    return null;
  },
  // Its scheduled events (the only copy) are deleted by the erasure itself.
  async deleteCall() {},
};

registerProvider(simulatedProvider);
