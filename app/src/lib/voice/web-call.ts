import "server-only";
import { aiComplete, aiProvider, parseAiJson } from "@/lib/ai";
import { auditSafe } from "@/lib/audit";
import { getAgent, toAgentSpec, type AgentRecord } from "@/lib/agents";
import { canStartCall, createCall, toCallRecord, updateCall, type CallRecord } from "@/lib/calls";
import { getDb } from "@/lib/db";
import { getCompliance } from "@/lib/compliance";
import type { Entitlements } from "@/lib/plans";
import { callAccountContext, providerContext, sellPricePerMinMicros } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { includedSecondsLeft } from "@/lib/usage";
import { reserveForCall } from "@/lib/wallet";
import { getWorkspace, type WorkspaceRecord } from "@/lib/workspaces";
import { detectOptOut, encodeCallTags, estimateReserveMicros, localDay, RESERVE_CAP_SEC } from "@/voice/normalize";
import { LIVE_CALL_STATUSES, ProviderError, type NormalizedCallEvent, type ToolSpec, type TranscriptTurn, type WebCallSession } from "@/voice/types";
import { callById, failCall, processEvent } from "./ingest";
import { reconcileCall } from "./reconcile";
import { cannedReply } from "./sim-script";
import { agentToolSpecs, ensureAgentSynced } from "./sync";
import { handleToolRequest } from "@/lib/tools/execute";
import { TOOL_SECRET_HEADER } from "@/lib/tools/specs";
import { agentTemplates, toProviderVariables } from "./vars";
import "./index";

/**
 * Browser calls: the agent builder's test call and the embeddable web widget.
 *
 * startWebCall() creates the calls row (direction "web"), checks the concurrency caps, holds
 * credits when the plan's included minutes don't cover the call, syncs the agent if needed and
 * asks the provider for a browser session (ElevenLabs signed WebSocket URL, Retell access token,
 * or our text chat for the Simulated provider). Web calls are billed by the same webhook ingest
 * as phone calls.
 *
 * simulatedChat() is the text-mode test call of the Simulated provider: the agent answers with
 * the configured AI provider (its prompt) or scripted replies, and ending the chat sends the
 * transcript and a summary through the ingest like a real call.
 */

export type WebCallErrorCode = "agent_not_synced" | "provider_unavailable" | "concurrency" | "insufficient_credits" | "provider_error" | "unsupported" | "suspended";

export class WebCallError extends Error {
  constructor(
    readonly code: WebCallErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebCallError";
  }
}

export interface StartWebCallInput {
  workspace: Pick<WorkspaceRecord, "id" | "name" | "ownerId" | "timezone">;
  agent: AgentRecord;
  /** The workspace OWNER's entitlements. */
  entitlements: Entitlements;
  source: "test" | "widget";
  ip?: string;
  origin?: string;
}

export interface StartWebCallResult {
  callId: number;
  session: WebCallSession;
  /** Variables the browser SDK passes when it starts the conversation (ElevenLabs dynamic variables). */
  dynamicVariables: Record<string, string>;
}

/** Starts a browser call. Throws WebCallError. */
export async function startWebCall(input: StartWebCallInput): Promise<StartWebCallResult> {
  const { workspace, entitlements } = input;
  if (entitlements.suspended) throw new WebCallError("suspended", "The account that owns this workspace is suspended.");
  const concurrency = await canStartCall(workspace.ownerId, entitlements);
  if (!concurrency.ok) throw new WebCallError("concurrency", `Too many calls in progress (${concurrency.live} of ${concurrency.limit}).`);
  const resolved = await providerContext(workspace.id, input.agent.provider, entitlements);
  if (!resolved) throw new WebCallError("provider_unavailable", `The ${input.agent.provider} provider is not configured.`);
  // Synced (or moved) into the provider account the workspace uses now.
  const synced = await ensureAgentSynced(input.agent, resolved);
  if (!synced.ok) throw new WebCallError("agent_not_synced", synced.error);
  const agent = synced.agent;
  const { provider, ctx } = resolved;
  if (!provider.capabilities.webCall) throw new WebCallError("unsupported", "This provider has no browser calls.");

  const settings = await getSettings();
  const price = sellPricePerMinMicros(settings, agent.provider, ctx.keySource);
  const reserveSec = Math.min(agent.settings.maxDurationSec, RESERVE_CAP_SEC);
  // Credits are held only for the part of the call the plan's minutes may not cover.
  const includedLeft = await includedSecondsLeft(workspace.ownerId, entitlements);
  const uncoveredSec = Math.max(0, reserveSec - includedLeft);
  const reserveMicros = uncoveredSec > 0 ? estimateReserveMicros(uncoveredSec, price) : 0;

  const callId = await createCall({ workspaceId: workspace.id, agentId: agent.id, direction: "web", provider: agent.provider, keySource: ctx.keySource, status: "queued" });
  const tags = { workspaceId: workspace.id, callId, agentId: agent.id, campaignId: null, contactId: null };
  await updateCall(callId, { price_per_min_micros: price, metadata: JSON.stringify({ ...encodeCallTags(tags), web_source: input.source, ...(input.origin ? { web_origin: input.origin.slice(0, 200) } : {}) }) });
  if (reserveMicros > 0) {
    const reserved = await reserveForCall(workspace.id, callId, reserveMicros);
    if (reserved.ok) await updateCall(callId, { credits_reserved_micros: reserveMicros });
    // With at least a minute of plan minutes left the call starts anyway (like the widget's check);
    // anything beyond them is charged to the wallet when the call is billed.
    else if (includedLeft < 60) {
      await failCall(callId, "Not enough call credits.", "canceled");
      throw new WebCallError("insufficient_credits", "Not enough call credits for a call.");
    }
  }

  const compliance = await getCompliance(workspace);
  const dynamicVariables = toProviderVariables({
    business_name: agent.settings.businessName || compliance.settings.businessName || workspace.name,
    agent_name: agent.name,
    today: localDay(Date.now(), workspace.timezone || "UTC"),
    caller_number: "",
    contact_number: "",
    timezone: workspace.timezone || "UTC",
    ...Object.fromEntries(Object.entries(encodeCallTags(tags))),
  });
  try {
    const session = await provider.createWebCall(ctx, await toAgentSpec(agent), tags);
    await updateCall(callId, { ...(session.providerCallId ? { provider_call_id: session.providerCallId } : {}), status: agent.provider === "simulated" ? "in_progress" : "ringing", ...(agent.provider === "simulated" ? { started_at: new Date().toISOString() } : {}) });
    await auditSafe({ workspaceId: workspace.id, actor: { type: "system", id: null }, action: "call.web_started", entityType: "call", entityId: callId, data: { agentId: agent.id, source: input.source, origin: input.origin ?? "", ip: input.ip ?? "" } });
    return { callId, session, dynamicVariables };
  } catch (error) {
    const text = error instanceof ProviderError ? error.message : error instanceof Error ? error.message : "The provider refused the browser call.";
    await failCall(callId, text);
    throw new WebCallError("provider_error", text);
  }
}

// ── Simulated text chat ──

const MAX_TURNS = 60;

function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}

async function chatContext(call: CallRecord) {
  const workspace = await getWorkspace(call.workspaceId);
  if (!workspace || !call.agentId) return null;
  const agent = await getAgent(workspace.id, call.agentId);
  if (!agent) return null;
  const compliance = await getCompliance(workspace);
  const spec = await toAgentSpec(agent);
  const t = agentTemplates(spec);
  const vars = { ...t.defaults, business_name: agent.settings.businessName || compliance.settings.businessName || workspace.name, agent_name: agent.name, today: localDay(Date.now(), workspace.timezone || "UTC"), timezone: workspace.timezone || "UTC", caller_number: "", contact_number: "" };
  return { workspace, agent, compliance, prompt: render(t.prompt, vars), greeting: render(t.firstMessage, vars) };
}

type ChatReply = { text: string; end: boolean; tool?: { name: string; args: Record<string, unknown> } };

async function aiReply(system: string, history: TranscriptTurn[], tools: ToolSpec[] = []): Promise<ChatReply | null> {
  if (!aiProvider(await getSettings())) return null;
  const dialogue = history.map((t) => `${t.role === "agent" ? "Agent" : t.role === "tool" ? "Tool" : "Caller"}: ${t.text}`).join("\n");
  const toolText = tools.length
    ? `\n\nTools you can use (one at a time): ${tools.map((t) => `${t.name}(${t.parameters.map((p) => p.name).join(", ")}): ${t.description}`).join(" | ")}. To use one, add "tool": {"name": "...", "args": {...}} to the JSON and say a short line like "One moment"; its result comes back as a Tool line.`
    : "";
  try {
    const answer = await aiComplete({
      system: `${system}\n\nYou are in a text chat that simulates a phone call. Answer as the agent with one or two short spoken sentences. Reply with JSON {"reply": "...", "end": true|false}; end is true when the conversation is over.${toolText}`,
      user: `${dialogue}\nAgent:`,
      maxTokens: 300,
      json: true,
    });
    const o = parseAiJson(answer);
    const text = typeof o?.reply === "string" ? o.reply.trim() : answer.trim();
    const tool = o?.tool && typeof o.tool === "object" ? (o.tool as Record<string, unknown>) : null;
    const name = typeof tool?.name === "string" ? tool.name : "";
    const args = tool?.args && typeof tool.args === "object" && !Array.isArray(tool.args) ? (tool.args as Record<string, unknown>) : {};
    return text || name ? { text: text.slice(0, 1000), end: o?.end === true, ...(name ? { tool: { name, args } } : {}) } : null;
  } catch {
    return null;
  }
}

// ── Tools in the simulated chat ──

/** The agent's server tools (booking, webhook, Google Sheets) the simulated chat can run. */
async function chatTools(agent: AgentRecord): Promise<ToolSpec[]> {
  return (await agentToolSpecs(agent, "")).filter((t) => t.secret);
}

/**
 * Runs one tool of the simulated chat through the real tool endpoint logic (same secret check,
 * runtime and logging on the call as a provider's request). Returns the result text for the agent.
 */
async function runChatTool(call: CallRecord, agent: AgentRecord, tool: ToolSpec, args: Record<string, unknown>): Promise<string> {
  const res = await handleToolRequest({
    toolId: tool.id,
    agentId: agent.id,
    headers: { [TOOL_SECRET_HEADER]: tool.secret, "x-dialzen-call-id": call.providerCallId ?? "" },
    rawBody: JSON.stringify(args),
    query: new URLSearchParams(),
  });
  const body = res.body as Record<string, unknown>;
  return (typeof body.message === "string" ? body.message : JSON.stringify(body)).slice(0, 1000);
}

const BOOKING_WORDS = /\b(book|booking|appointment|schedule|reserve|slot|available|availability|cita|reservar|agendar|rendez-vous|termin|consulta)\b|बुक|अपॉइंटमेंट|موعد|حجز/i;

/**
 * Scripted tool use when no AI provider is set up: a booking request checks the calendar, then the
 * next message books the free time the caller names (or the first one offered).
 */
async function cannedToolTurn(call: CallRecord, agent: AgentRecord, tools: ToolSpec[], transcript: TranscriptTurn[], message: string): Promise<string | null> {
  const booking = tools.find((t) => t.kind === "cal_com" || t.kind === "google_calendar");
  if (!booking) return null;
  const offered = Array.isArray(call.metadata.sim_slots) ? (call.metadata.sim_slots as string[]) : [];
  if (offered.length && !call.toolCalls.some((t) => t.ok && String(t.args?.action ?? "") === "book")) {
    const picked = offered.find((s) => message.includes(s.slice(11, 16))) ?? offered[0];
    const name = /(?:my name is|i am|i'm|this is)\s+([\p{L}][\p{L} .'-]{1,60})/iu.exec(message)?.[1]?.trim() ?? "Test caller";
    const email = /[^\s@]+@[^\s@]+\.[^\s@]+/.exec(message)?.[0] ?? "";
    return runChatTool(call, agent, booking, { action: "book", start: picked, name, ...(email ? { email } : {}) });
  }
  if (!BOOKING_WORDS.test(message)) return null;
  const text = await runChatTool(call, agent, booking, { action: "availability", date: "" });
  // Remember the offered times (from the tool call logged on the call) for the next message.
  const fresh = await callById(call.id);
  const slots = (fresh?.toolCalls.at(-1)?.result.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g) ?? []) as string[];
  if (fresh && slots.length) await updateCall(call.id, { metadata: JSON.stringify({ ...fresh.metadata, sim_slots: [...new Set(slots)].slice(0, 8) }) });
  return text;
}

async function aiAnalysis(call: CallRecord, fields: AgentRecord["settings"]["analysisFields"], transcript: TranscriptTurn[]): Promise<{ summary: string; sentiment: "positive" | "neutral" | "negative" | "unknown"; extracted: Record<string, unknown> }> {
  const said = transcript.filter((t) => t.role === "caller").length;
  const fallback = { summary: `Browser test chat with ${said} caller message${said === 1 ? "" : "s"}.`, sentiment: "neutral" as const, extracted: {} };
  if (!aiProvider(await getSettings()) || !transcript.length) return fallback;
  try {
    const schema = fields.map((f) => `- ${f.key} (${f.type}${f.options.length ? `: ${f.options.join("/")}` : ""}): ${f.description || f.label}`).join("\n");
    const answer = await aiComplete({
      system: 'You analyse call transcripts. Reply with JSON {"summary": "one or two sentences", "sentiment": "positive|neutral|negative", "extracted": {…}} where extracted holds only the listed fields that the transcript answers.',
      user: `Fields:\n${schema || "(none)"}\n\nTranscript:\n${transcript.map((t) => `${t.role}: ${t.text}`).join("\n")}`,
      maxTokens: 600,
      json: true,
    });
    const o = parseAiJson(answer);
    if (!o) return fallback;
    const sentiment = o.sentiment === "positive" || o.sentiment === "negative" || o.sentiment === "neutral" ? o.sentiment : "neutral";
    const allowed = new Set(fields.map((f) => f.key));
    const extracted = Object.fromEntries(Object.entries(o.extracted && typeof o.extracted === "object" ? (o.extracted as Record<string, unknown>) : {}).filter(([k]) => allowed.has(k)));
    return { summary: typeof o.summary === "string" ? o.summary.slice(0, 1000) : fallback.summary, sentiment, extracted };
  } catch {
    return fallback;
  }
}

export type SimulatedChatResult = { reply: string; end: boolean };

export class SimulatedChatError extends Error {
  constructor(
    readonly code: "not_found" | "ended",
    message: string,
  ) {
    super(message);
  }
}

/**
 * One turn of the simulated test call. No message = the agent's greeting. `end` finishes the
 * call (transcript, summary and billing through the ingest). Throws SimulatedChatError.
 */
export async function simulatedChat(input: { workspaceId: number; callId: number; message?: string; end?: boolean }): Promise<SimulatedChatResult> {
  const call = await callById(input.callId);
  if (!call || call.workspaceId !== input.workspaceId || call.provider !== "simulated" || call.direction !== "web" || !call.providerCallId) throw new SimulatedChatError("not_found", "This test call doesn't exist.");
  if (!["queued", "ringing", "in_progress"].includes(call.status)) throw new SimulatedChatError("ended", "This test call has ended.");
  const ctx = await chatContext(call);
  if (!ctx) throw new SimulatedChatError("not_found", "The agent of this test call no longer exists.");
  const startedMs = Date.parse(call.startedAt ?? call.createdAt);
  const at = () => Math.max(0, Math.round((Date.now() - startedMs) / 1000));
  const transcript = [...call.transcript];
  if (!transcript.length) transcript.push({ role: "agent", text: ctx.greeting, at: 0 });

  if (input.end) {
    await finishChat(call, ctx.agent, transcript, "caller_hangup");
    return { reply: "", end: true };
  }
  const message = (input.message ?? "").trim().slice(0, 2000);
  if (!message) {
    if (!call.transcript.length) await updateCall(call.id, { transcript: JSON.stringify(transcript) });
    return { reply: transcript[0].text, end: false };
  }
  transcript.push({ role: "caller", text: message, at: at() });
  const optOut = detectOptOut([{ role: "caller", text: message, at: 0 }], ctx.compliance.settings.optOutPhrases).optOut;
  let reply: ChatReply;
  if (optOut) reply = cannedReply(ctx.agent.language, transcript, true);
  else {
    const tools = await chatTools(ctx.agent);
    const ai = await aiReply(ctx.prompt, transcript, tools);
    if (ai) {
      reply = ai;
      // The agent used a tool: run it, then let it answer with the result (at most twice per message).
      for (let i = 0; i < 2 && reply.tool; i++) {
        const used = reply.tool;
        const tool = tools.find((t) => t.name === used.name);
        if (reply.text) transcript.push({ role: "agent", text: reply.text, at: at() });
        const result = tool ? await runChatTool(call, ctx.agent, tool, used.args) : `Unknown tool ${used.name}.`;
        transcript.push({ role: "tool", text: `${used.name}: ${result}`, at: at() });
        reply = (await aiReply(ctx.prompt, transcript, tools)) ?? { text: result, end: false };
      }
    } else {
      const toolText = await cannedToolTurn(call, ctx.agent, tools, transcript, message);
      if (toolText) transcript.push({ role: "tool", text: toolText, at: at() });
      reply = toolText ? { text: toolText, end: false } : cannedReply(ctx.agent.language, transcript, false);
    }
  }
  transcript.push({ role: "agent", text: reply.text, at: at() });
  const end = reply.end || transcript.length >= MAX_TURNS;
  if (end) await finishChat(call, ctx.agent, transcript, optOut ? "opt_out" : "agent_hangup");
  else await updateCall(call.id, { transcript: JSON.stringify(transcript) });
  return { reply: reply.text, end };
}

async function finishChat(
  call: CallRecord,
  agent: AgentRecord,
  transcript: TranscriptTurn[],
  endReason: "caller_hangup" | "agent_hangup" | "opt_out" | "silence_timeout",
  idle?: { durationSec: number; endedAt: string },
): Promise<void> {
  const endedAt = idle?.endedAt ?? new Date().toISOString();
  const startedAt = call.startedAt ?? call.createdAt;
  const durationSec = idle ? idle.durationSec : Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
  const base = { provider: "simulated" as const, providerCallId: call.providerCallId!, at: endedAt, metadata: call.tags };
  const ended: NormalizedCallEvent = {
    ...base,
    eventId: `${call.providerCallId}:ended`,
    type: "ended",
    // A chat the visitor left without writing anything is canceled (nothing to bill).
    status: idle && durationSec === 0 ? "canceled" : "completed",
    endReason,
    durationSec,
    costMicros: Math.ceil((durationSec * 70_000) / 60),
    startedAt,
    endedAt,
    transcript,
    recordingUrl: "",
    disclosurePlayed: true,
    latencyMs: null,
  };
  await processEvent("simulated", ended, JSON.stringify(ended));
  if (idle && durationSec === 0) return;
  const analysis = await aiAnalysis(call, agent.settings.analysisFields, transcript);
  const analyzed: NormalizedCallEvent = { ...base, eventId: `${call.providerCallId}:analyzed`, type: "analysis_ready", summary: analysis.summary, sentiment: analysis.sentiment, extracted: endReason === "opt_out" ? { ...analysis.extracted, opted_out: true } : analysis.extracted, success: null };
  await processEvent("simulated", analyzed, JSON.stringify(analyzed));
}

// ── Idle browser calls ──

/** A browser call without activity for this long is ended (the visitor closed the page or never connected). */
export const WEB_CALL_IDLE_MS = 5 * 60_000;
/** How long a provider's browser session may take to connect (ElevenLabs signed URLs live 15 minutes). */
const CONNECT_WINDOW_MS = 15 * 60_000;

export interface IdleWebCallsSummary {
  checked: number;
  /** Ended through the ingest (simulated chats, provider calls whose webhook never came). */
  ended: number;
  /** Never connected or nothing said: canceled without charge. */
  canceled: number;
}

/**
 * Ends browser calls (test calls and the widget) that went quiet, so they stop holding credits
 * and concurrency (job "reconcile", every minute):
 * - simulated text chats with no message for `idleMs`: finished through the ingest like a hang-up
 *   ("silence_timeout") and billed until the last message; a chat without any visitor message
 *   is canceled (not billed)
 * - provider calls (ElevenLabs, Retell): the provider's record decides. A call the provider
 *   finished is completed through the ingest (missed webhook, same event ids), one still live is
 *   left alone, and one the provider doesn't know (or never saw joined) once the browser could no
 *   longer connect is canceled without charge.
 */
export async function expireIdleWebCalls(options: { idleMs?: number; deadline?: number; limit?: number; nowMs?: number } = {}): Promise<IdleWebCallsSummary> {
  const nowMs = options.nowMs ?? Date.now();
  const idleMs = options.idleMs ?? WEB_CALL_IDLE_MS;
  const summary: IdleWebCallsSummary = { checked: 0, ended: 0, canceled: 0 };
  const db = await getDb();
  const rows = await db
    .selectFrom("calls")
    .selectAll()
    .where("direction", "=", "web")
    .where("status", "in", [...LIVE_CALL_STATUSES])
    .where("updated_at", "<", new Date(nowMs - idleMs).toISOString())
    .orderBy("updated_at")
    .limit(options.limit ?? 50)
    .execute();
  for (const row of rows) {
    if (options.deadline && Date.now() > options.deadline) break;
    const call = toCallRecord(row);
    summary.checked++;
    try {
      const result = call.provider === "simulated" ? await expireSimulatedChat(call, nowMs) : await expireProviderWebCall(call, nowMs);
      if (result === "ended") summary.ended++;
      else if (result === "canceled") summary.canceled++;
    } catch (error) {
      console.error(`[dialzen] idle web call ${call.id}:`, error);
    }
  }
  return summary;
}

async function expireSimulatedChat(call: CallRecord, nowMs: number): Promise<"ended" | "canceled" | "kept"> {
  const ctx = call.providerCallId ? await chatContext(call) : null;
  if (!ctx) {
    await failCall(call.id, "The browser call was left without activity.", "canceled");
    return "canceled";
  }
  const transcript = call.transcript.length ? call.transcript : [{ role: "agent" as const, text: ctx.greeting, at: 0 }];
  const callerTurns = transcript.filter((t) => t.role === "caller");
  // Billed until the last message (the agent's answer to the visitor's last line).
  const durationSec = callerTurns.length ? Math.max(1, Math.round(Math.max(...transcript.map((t) => t.at)))) : 0;
  const startedMs = Date.parse(call.startedAt ?? call.createdAt);
  const endedAt = new Date(Math.min(nowMs, startedMs + durationSec * 1000)).toISOString();
  await finishChat(call, ctx.agent, transcript, "silence_timeout", { durationSec, endedAt });
  await auditSafe({ workspaceId: call.workspaceId, actor: { type: "system", id: null }, action: "call.idle_ended", entityType: "call", entityId: call.id, data: { durationSec, messages: callerTurns.length } });
  return durationSec ? "ended" : "canceled";
}

async function expireProviderWebCall(call: CallRecord, nowMs: number): Promise<"ended" | "canceled" | "kept"> {
  const workspace = await getWorkspace(call.workspaceId);
  if (!workspace) return "kept";
  const agent = call.agentId ? await getAgent(workspace.id, call.agentId) : undefined;
  const ageMs = nowMs - Date.parse(call.createdAt);
  // After this a real browser call can't be going on any more.
  const tooOld = ageMs > CONNECT_WINDOW_MS + (agent?.settings.maxDurationSec ?? 3600) * 1000 + WEB_CALL_IDLE_MS;
  if (!call.providerCallId) {
    if (!tooOld) return "kept";
    await failCall(call.id, "The browser never connected to the provider.", "canceled");
    return "canceled";
  }
  const resolved = await callAccountContext(call, 10_000);
  if (!resolved) return "kept";
  const details = await resolved.provider.getCall(resolved.ctx, call.providerCallId);
  if (!details) {
    if (ageMs < CONNECT_WINDOW_MS) return "kept";
    await failCall(call.id, "The provider has no record of this browser call.", "canceled");
    return "canceled";
  }
  const result = await reconcileCall(call, details);
  if (result === "completed") return "ended";
  // Registered at the provider but never joined.
  if (details.status === "ringing" && ageMs > CONNECT_WINDOW_MS) {
    await failCall(call.id, "The browser never connected to the provider.", "canceled");
    return "canceled";
  }
  return "kept";
}
