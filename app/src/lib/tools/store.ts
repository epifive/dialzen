import "server-only";
import { getDb } from "@/lib/db";
import { getToolById, getToolConfig, markToolStatus, saveToolConfig, type ToolRecord } from "@/lib/tool-configs";
import type { ToolConfigByKind, ToolKind } from "@/voice/types";

/**
 * The tool runtime's view of a workspace tool: the record plus its decrypted settings, read
 * through the tool library of the agent builder (src/lib/tool-configs.ts, encrypted purpose
 * "tool-config").
 */

export interface RuntimeTool<K extends ToolKind = ToolKind> {
  id: number;
  workspaceId: number;
  kind: K;
  name: string;
  description: string;
  status: ToolRecord["status"];
  config: ToolConfigByKind[K];
}

async function withConfig(tool: ToolRecord): Promise<RuntimeTool | null> {
  const config = await getToolConfig(tool.workspaceId, tool.id);
  return config ? { id: tool.id, workspaceId: tool.workspaceId, kind: tool.kind, name: tool.name, description: tool.description, status: tool.status, config } : null;
}

export async function loadToolForRuntime(toolId: number): Promise<RuntimeTool | null> {
  const tool = await getToolById(toolId);
  return tool ? withConfig(tool) : null;
}

/** Tools attached to an agent (not disabled), decrypted. */
export async function agentRuntimeTools(agentId: number): Promise<RuntimeTool[]> {
  const db = await getDb();
  const ids = (await db.selectFrom("agent_tools").select("tool_id").where("agent_id", "=", agentId).orderBy("tool_id").execute()).map((r) => r.tool_id);
  const out: RuntimeTool[] = [];
  for (const id of ids) {
    const tool = await loadToolForRuntime(id);
    if (tool && tool.status !== "disabled") out.push(tool);
  }
  return out;
}

/** Stores the Google account of a Google Calendar / Sheets tool after the OAuth callback. */
export async function setGoogleTokens(workspaceId: number, toolId: number, tokens: { refreshToken: string; accountEmail: string }): Promise<boolean> {
  const tool = await getToolById(toolId);
  if (!tool || tool.workspaceId !== workspaceId || (tool.kind !== "google_calendar" && tool.kind !== "google_sheets")) return false;
  return saveToolConfig(workspaceId, toolId, { refreshToken: tokens.refreshToken, accountEmail: tokens.accountEmail });
}

/** Records the outcome of a tool run (last used / last error). */
export async function markToolUsed(toolId: number, error: string | null): Promise<void> {
  await markToolStatus(toolId, !error, error);
}
