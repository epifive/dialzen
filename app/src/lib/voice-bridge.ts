import "server-only";
import type { Entitlements } from "./plans";
import { providerContext } from "./providers";
import type { AgentRecord } from "./agents";
import type { CallRecord } from "./calls";
import { recordingAvailability, recordingUrlFor } from "./voice/recordings";
import type { WorkspaceRecord } from "./workspaces";
import { simulatedChat as runSimulatedChat, SimulatedChatError, startWebCall as runWebCall, WebCallError } from "./voice/web-call";
import "./voice/index";
import type { Voice, WebCallSession } from "@/voice/types";

/**
 * What the agent builder, the calls UI and the web widget need from the voice runtime
 * (src/lib/voice): provider sync, browser web calls, the simulated text chat, voices and
 * recordings, in the result shapes the dashboard actions and widget routes use.
 */

export { deleteAgentRemote, deleteKbItemRemote, syncAgentNow } from "./voice/sync";

/** Voices of a provider for a language; null when the provider can't be reached from here. */
export async function listProviderVoices(workspaceId: number, provider: string, lang: string, entitlements: Pick<Entitlements, "allowByoKeys">): Promise<Voice[] | null> {
  const resolved = await providerContext(workspaceId, provider, entitlements, { timeoutMs: 10_000 });
  if (!resolved) return null;
  try {
    return await resolved.provider.listVoices(resolved.ctx, lang);
  } catch {
    return null;
  }
}

/**
 * The player's recording: a signed URL, or none; `unavailable` when the recording is only in the
 * workspace's own provider account and its keys were removed.
 */
export async function recordingForPlayer(call: CallRecord): Promise<{ src: string | null; unavailable: boolean }> {
  const where = await recordingAvailability(call);
  if (where === "stored" || where === "provider") return { src: await recordingUrlFor(call), unavailable: false };
  return { src: null, unavailable: where === "unavailable" };
}

// ── Web calls (browser test calls and the widget) ──

export interface StartWebCallInput {
  workspace: Pick<WorkspaceRecord, "id" | "name" | "ownerId" | "timezone">;
  agent: AgentRecord;
  entitlements: Entitlements;
  source: "test" | "widget";
  ip?: string;
  origin?: string;
}

export type StartWebCallResult =
  | { ok: true; callId: number; session: WebCallSession; dynamicVariables: Record<string, string>; greeting: string }
  | { ok: false; error: "concurrency" | "funds" | "provider" | "unavailable" | "suspended"; message?: string };

/**
 * Creates the web call (calls row, concurrency check, credit hold, provider session). For the
 * simulated provider the agent's greeting is returned too (and stored as the first turn).
 */
export async function startWebCall(input: StartWebCallInput): Promise<StartWebCallResult> {
  try {
    const res = await runWebCall(input);
    let greeting = "";
    if (res.session.sdk === "simulated") greeting = (await runSimulatedChat({ workspaceId: input.workspace.id, callId: res.callId })).reply;
    return { ok: true, callId: res.callId, session: res.session, dynamicVariables: res.dynamicVariables, greeting };
  } catch (error) {
    if (error instanceof WebCallError) {
      if (error.code === "concurrency") return { ok: false, error: "concurrency" };
      if (error.code === "insufficient_credits") return { ok: false, error: "funds" };
      if (error.code === "suspended") return { ok: false, error: "suspended" };
      if (error.code === "provider_unavailable" || error.code === "unsupported") return { ok: false, error: "unavailable" };
      return { ok: false, error: "provider", message: error.message };
    }
    return { ok: false, error: "provider", message: error instanceof Error ? error.message : "" };
  }
}

/** One turn of a simulated web call (or its end); null when the call doesn't exist or has ended. */
export async function simulatedChat(input: { workspaceId: number; callId: number; message?: string; end?: boolean }): Promise<{ reply: string; end: boolean } | null> {
  try {
    return await runSimulatedChat(input);
  } catch (error) {
    if (error instanceof SimulatedChatError) return null;
    throw error;
  }
}
