import "server-only";
import { findCallByProviderId, updateCall } from "@/lib/calls";
import { isDemoMode } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { safeEqual } from "@/lib/voice/http";
import { decodeCallTags, parseJson } from "@/voice/normalize";
import type { ToolCallRecord, WebhookHeaders } from "@/voice/types";
import { guardedFetch } from "./net";
import { runTool, type ToolCallContext } from "./runtime";
import { TOOL_SECRET_HEADER, TOOL_SIGNATURE_HEADER, toolSecretFor } from "./specs";
import { loadToolForRuntime, markToolUsed } from "./store";
import { hmacHex, parseSignatureHeader } from "@/lib/voice/http";

/**
 * POST /api/voice/tools/<toolId>?agent=<agentId>: a provider calls an agent's tool during a call.
 *
 * Authentication: the per agent-and-tool secret in X-Dialzen-Tool-Secret (registered with the
 * provider when the agent was synced), compared in constant time; when the request also carries
 * X-Dialzen-Tool-Signature (t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>) the signature
 * and a 5-minute timestamp window are checked too (replay protection for callers that can sign).
 *
 * Body shapes: Retell custom functions send {name, args, call: {call_id, …}}; ElevenLabs webhook
 * tools send the arguments object itself (the conversation id comes in the X-Dialzen-Call-Id header
 * or the `call` query parameter). Every run is logged on the call (calls.tool_calls).
 */

const TOLERANCE_SEC = 300;

export interface ToolHttpResult {
  status: number;
  body: Record<string, unknown>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function handleToolRequest(input: { toolId: number; agentId: number; headers: WebhookHeaders; rawBody: string; query: URLSearchParams; fetchImpl?: typeof fetch; nowMs?: number }): Promise<ToolHttpResult> {
  const nowMs = input.nowMs ?? Date.now();
  const tool = await loadToolForRuntime(input.toolId);
  if (!tool || !Number.isInteger(input.agentId) || input.agentId < 1) return { status: 404, body: { error: "Unknown tool." } };
  const db = await getDb();
  const agent = await db
    .selectFrom("agents as a")
    .innerJoin("agent_tools as at", "at.agent_id", "a.id")
    .select(["a.id", "a.workspace_id", "a.provider", "a.tool_secret"])
    .where("a.id", "=", input.agentId)
    .where("at.tool_id", "=", tool.id)
    .where("a.workspace_id", "=", tool.workspaceId)
    .executeTakeFirst();
  if (!agent) return { status: 404, body: { error: "Unknown tool." } };

  const expected = toolSecretFor(agent.tool_secret, tool.id);
  const given = input.headers[TOOL_SECRET_HEADER] ?? "";
  if (!given || !safeEqual(given, expected)) return { status: 401, body: { error: "Invalid tool secret." } };
  const sigHeader = input.headers[TOOL_SIGNATURE_HEADER];
  if (sigHeader) {
    const parts = parseSignatureHeader(sigHeader);
    const t = Number(parts.get("t")?.[0]);
    const sig = hmacHex(expected, `${t}.${input.rawBody}`);
    if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_SEC || !(parts.get("v1") ?? []).some((v) => safeEqual(v, sig))) return { status: 401, body: { error: "Invalid tool signature." } };
  }
  if (tool.status === "disabled") return { status: 200, body: { message: "This action is turned off. Offer to take a message instead." } };

  let body: Record<string, unknown> = {};
  if (input.rawBody.trim()) {
    const parsed = parseJson(input.rawBody);
    if (parsed === null) return { status: 400, body: { error: "The body is not JSON." } };
    body = obj(parsed);
  }
  const retellShape = body.args && typeof body.args === "object" && body.call && typeof body.call === "object";
  const args = retellShape ? obj(body.args) : Object.fromEntries(Object.entries(body).filter(([k]) => k !== "call"));
  const providerCallId = String((retellShape ? obj(body.call).call_id : "") || input.headers["x-dialzen-call-id"] || input.query.get("call") || "").slice(0, 190);
  const call = providerCallId && !/^\{\{/.test(providerCallId) ? await findCallByProviderId(agent.provider, providerCallId) : undefined;
  const sameWorkspace = call && call.workspaceId === agent.workspace_id ? call : undefined;
  const tags = decodeCallTags(retellShape ? obj(obj(body.call).metadata) : {});
  const callerNumber = sameWorkspace ? (sameWorkspace.direction === "inbound" ? sameWorkspace.from : sameWorkspace.to) : "";

  const settings = await getSettings();
  const userUrl = tool.kind === "webhook" || (tool.kind === "cal_com" && Boolean((tool.config as { apiBase?: string }).apiBase));
  const ctx: ToolCallContext = {
    fetch: input.fetchImpl ?? (userUrl ? guardedFetch : fetch),
    now: () => Date.now(),
    timeoutMs: 4500,
    google: { clientId: settings.google_client_id, clientSecret: settings.google_client_secret },
    apiBase: { google: process.env.DIALZEN_TEST_GOOGLE_API?.trim() ?? "", calcom: process.env.DIALZEN_TEST_CALCOM_API?.trim() ?? "" },
    call: { id: sameWorkspace?.id ?? tags.callId, workspaceId: agent.workspace_id, agentId: agent.id, from: sameWorkspace?.from ?? "", to: sameWorkspace?.to ?? "", direction: sameWorkspace?.direction ?? "", callerNumber },
    // Demo calendars ("cal_demo_" keys; in DEMO_MODE also calendars without a real connection) are simulated (runtime.ts).
    demo: isDemoMode(),
  };
  const started = Date.now();
  const result = await runTool(tool.kind, tool.config, args, ctx, tool.name);
  const durationMs = Date.now() - started;
  await markToolUsed(tool.id, result.ok ? null : result.error || null).catch(() => undefined);
  if (sameWorkspace) {
    const record: ToolCallRecord = {
      name: tool.name,
      args,
      result: JSON.stringify(result.data).slice(0, 2000),
      ok: result.ok,
      at: sameWorkspace.startedAt ? Math.max(0, Math.round((nowMs - Date.parse(sameWorkspace.startedAt)) / 1000)) : 0,
      durationMs,
    };
    const fresh = await findCallByProviderId(agent.provider, providerCallId);
    const list = [...(fresh?.toolCalls ?? []), record].slice(-100);
    await updateCall(sameWorkspace.id, { tool_calls: JSON.stringify(list), ...(result.booked ? { outcome: "booked" } : {}) });
  }
  return { status: 200, body: result.data };
}
