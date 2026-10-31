import "server-only";
import { auditSafe } from "./audit";
import { isDemoMode } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb, now } from "./db";
import type { ToolRow } from "./db/schema";
import { parseWebhookUrl, postJson, ToolInputError } from "./net/ssrf";
import { allowPrivateTargets, guardedFetch } from "./tools/net";
import { isDemoWebhook, usesDemoCalendar } from "./tools/runtime";
import { signatureHeaders } from "./webhook-signature";
import { asObj, isToolKind, isValidE164, normalizeToolConfig, normalizeToolName, str } from "@/voice/normalize";
import type { ToolConfigByKind, ToolKind } from "@/voice/types";

/**
 * Workspace tools (Agents → Tools): actions an agent can take during a call (Cal.com or Google
 * Calendar booking, a webhook, a Google Sheets row, a transfer to a person, ending the call).
 * Tools belong to the workspace and are attached to any number of agents (agent_tools).
 *
 * Their settings hold API keys and OAuth tokens, so tools.config is AES-256-GCM encrypted
 * (purpose "tool-config"). The dashboard never receives secret values back: forms show whether a
 * secret is set, and an empty secret field keeps the stored one. The tool runtime
 * (src/lib/tools/, the provider-facing /api/voice/tools/<id> endpoint) reads the decrypted
 * settings with getToolConfig(); the Google connect flow stores tokens with saveToolConfig().
 */

export const TOOL_CONFIG_PURPOSE = "tool-config";
export const MAX_TOOLS = 50;

export interface ToolRecord {
  id: number;
  workspaceId: number;
  kind: ToolKind;
  name: string;
  description: string;
  status: "active" | "error" | "disabled";
  lastError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toToolRecord(row: ToolRow): ToolRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: isToolKind(row.kind) ? row.kind : "webhook",
    name: row.name,
    description: row.description,
    status: row.status,
    lastError: row.last_error,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fields of each kind that are secret: never sent to the browser, kept when the form leaves them empty. */
export const SECRET_FIELDS: Record<ToolKind, readonly string[]> = {
  cal_com: ["apiKey"],
  google_calendar: ["refreshToken"],
  webhook: ["secret"],
  google_sheets: ["refreshToken"],
  transfer: [],
  end_call: [],
};

/** Function name and description a new tool of each kind starts with (LLM-facing content, editable). */
export const TOOL_DEFAULTS: Record<ToolKind, { name: string; description: string }> = {
  cal_com: { name: "book_appointment", description: "Check open appointment slots and book one for the caller. Ask for the preferred day first." },
  google_calendar: { name: "book_appointment", description: "Check free times in the calendar and book an appointment for the caller." },
  webhook: { name: "lookup", description: "Look up information in our system (for example an order by its number)." },
  google_sheets: { name: "log_call", description: "Save the caller's details and request as a new row in our spreadsheet." },
  transfer: { name: "transfer_call", description: "Transfer the call to a team member when the caller asks for a person or you can't help." },
  end_call: { name: "end_call", description: "End the call politely when the conversation is over or the caller asks to stop." },
};

export async function listTools(workspaceId: number): Promise<ToolRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("tools").selectAll().where("workspace_id", "=", workspaceId).orderBy("created_at").orderBy("id").execute();
  return rows.map(toToolRecord);
}

export async function getTool(workspaceId: number, toolId: number): Promise<ToolRecord | undefined> {
  if (!Number.isInteger(toolId) || toolId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("tools").selectAll().where("id", "=", toolId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toToolRecord(row) : undefined;
}

/** A tool by id without a workspace (tool runtime: the provider calls /api/voice/tools/<id>). */
export async function getToolById(toolId: number): Promise<ToolRecord | undefined> {
  if (!Number.isInteger(toolId) || toolId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("tools").selectAll().where("id", "=", toolId).executeTakeFirst();
  return row ? toToolRecord(row) : undefined;
}

export async function encryptToolConfig<K extends ToolKind>(kind: K, config: unknown): Promise<string> {
  return encryptSecret(JSON.stringify(normalizeToolConfig(kind, config)), TOOL_CONFIG_PURPOSE);
}

/** Decrypted, normalised settings of a stored config (defaults when empty or unreadable, e.g. after an APP_SECRET change). */
export async function decryptToolConfig<K extends ToolKind>(kind: K, encrypted: string): Promise<ToolConfigByKind[K]> {
  if (!encrypted) return normalizeToolConfig(kind, {});
  try {
    return normalizeToolConfig(kind, JSON.parse(await decryptSecret(encrypted, TOOL_CONFIG_PURPOSE)));
  } catch {
    return normalizeToolConfig(kind, {});
  }
}

/** Decrypted settings of a tool record (internal). */
async function configOf<K extends ToolKind>(tool: Pick<ToolRecord, "id" | "kind">): Promise<ToolConfigByKind[K]> {
  const db = await getDb();
  const row = await db.selectFrom("tools").select("config").where("id", "=", tool.id).executeTakeFirst();
  return decryptToolConfig(tool.kind, row?.config ?? "") as Promise<ToolConfigByKind[K]>;
}

/**
 * The decrypted, normalised settings of a workspace's tool (tool runtime, Google connect
 * callback, tests); null when the tool doesn't exist in that workspace.
 */
export async function getToolConfig<K extends ToolKind = ToolKind>(workspaceId: number, toolId: number): Promise<ToolConfigByKind[K] | null> {
  const tool = await getTool(workspaceId, toolId);
  return tool ? configOf<K>(tool) : null;
}

/** Settings safe for the browser: secrets blanked, plus which secrets are set. */
export function publicToolConfig(kind: ToolKind, config: unknown): { config: Record<string, unknown>; secretsSet: string[] } {
  const o = { ...asObj(normalizeToolConfig(kind, config)) };
  const secretsSet: string[] = [];
  for (const field of SECRET_FIELDS[kind]) {
    if (str(o[field])) secretsSet.push(field);
    o[field] = "";
  }
  if (kind === "webhook") {
    // Header values often carry API keys of the target system: only their names go out.
    const headers = asObj(o.headers);
    if (Object.keys(headers).length) secretsSet.push("headers");
    o.headers = Object.fromEntries(Object.keys(headers).map((k) => [k, ""]));
  }
  return { config: o, secretsSet };
}

export interface ToolInput {
  kind: string;
  name: string;
  description: string;
  config: unknown;
}

export type SaveToolResult = { ok: true; tool: ToolRecord } | { ok: false; error: "kind" | "name" | "name_taken" | "limit" | "not_found" | ConfigProblem };

export type ConfigProblem = "cal_key" | "cal_event" | "webhook_url" | "sheet_id" | "transfer_number";

/** What is missing in a tool's settings (null = complete enough to save). Google accounts are connected after saving. */
export function toolConfigProblem(kind: ToolKind, config: ToolConfigByKind[ToolKind]): ConfigProblem | null {
  const c = config as unknown as Record<string, unknown>;
  switch (kind) {
    case "cal_com":
      if (!str(c.apiKey)) return "cal_key";
      if (!(Number(c.eventTypeId) > 0)) return "cal_event";
      return null;
    case "webhook":
      return str(c.url) ? null : "webhook_url";
    case "google_sheets":
      return str(c.spreadsheetId) ? null : "sheet_id";
    case "transfer":
      return isValidE164(c.number) ? null : "transfer_number";
    default:
      return null;
  }
}

/** Secret fields the form left empty keep their stored values (webhook headers: by name). */
function mergeSecrets(kind: ToolKind, next: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const out = { ...next };
  for (const field of SECRET_FIELDS[kind]) if (!str(out[field])) out[field] = current[field] ?? "";
  if (kind === "webhook") {
    const prev = asObj(current.headers);
    const headers = asObj(out.headers);
    out.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, str(v, "", 500) || str(prev[k], "", 500)]));
  }
  if (kind === "google_calendar" || kind === "google_sheets") {
    // The connected account comes from the OAuth callback, never from the form.
    out.accountEmail = current.accountEmail ?? "";
    out.refreshToken = current.refreshToken ?? "";
  }
  return out;
}

/**
 * Creates a tool, or updates one when `toolId` is given (its kind can't change). Names are
 * snake_case and unique in the workspace (the LLM calls tools by name). Agents using the tool are
 * marked for re-sync.
 */
export async function saveTool(workspaceId: number, input: ToolInput, userId: number | null, toolId?: number): Promise<SaveToolResult> {
  const db = await getDb();
  const existing = toolId ? await getTool(workspaceId, toolId) : undefined;
  if (toolId && !existing) return { ok: false, error: "not_found" };
  const kind = existing?.kind ?? input.kind;
  if (!isToolKind(kind)) return { ok: false, error: "kind" };
  const name = normalizeToolName(input.name, "");
  if (!name) return { ok: false, error: "name" };
  const clash = await db.selectFrom("tools").select("id").where("workspace_id", "=", workspaceId).where("name", "=", name).executeTakeFirst();
  if (clash && clash.id !== existing?.id) return { ok: false, error: "name_taken" };
  if (!existing) {
    const count = await db.selectFrom("tools").select((eb) => eb.fn.countAll<number>().as("n")).where("workspace_id", "=", workspaceId).executeTakeFirst();
    if (Number(count?.n ?? 0) >= MAX_TOOLS) return { ok: false, error: "limit" };
  }
  const current = existing ? asObj(await configOf(existing)) : {};
  const config = normalizeToolConfig(kind, mergeSecrets(kind, asObj(input.config), current));
  const problem = toolConfigProblem(kind, config);
  if (problem) return { ok: false, error: problem };
  const description = str(input.description, "", 500) || TOOL_DEFAULTS[kind].description;
  const encrypted = await encryptSecret(JSON.stringify(config), TOOL_CONFIG_PURPOSE);
  const ts = now();
  let id: number;
  if (existing) {
    id = existing.id;
    await db.updateTable("tools").set({ name, description, config: encrypted, status: "active", last_error: null, updated_at: ts }).where("id", "=", id).execute();
    await markAgentsPending(workspaceId, id);
  } else {
    const res = await db
      .insertInto("tools")
      .values({ workspace_id: workspaceId, kind, name, description, config: encrypted, status: "active", last_error: null, last_used_at: null, created_by: userId, created_at: ts, updated_at: ts })
      .executeTakeFirstOrThrow();
    id = Number(res.insertId);
  }
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: existing ? "tool.updated" : "tool.created", entityType: "tool", entityId: id, data: { kind, name } });
  return { ok: true, tool: (await getTool(workspaceId, id))! };
}

/**
 * Merges values into a tool's encrypted settings (the Google connect callback stores
 * refreshToken and accountEmail here). Returns false when the tool doesn't exist.
 */
export async function saveToolConfig(workspaceId: number, toolId: number, patch: Record<string, unknown>): Promise<boolean> {
  const tool = await getTool(workspaceId, toolId);
  if (!tool) return false;
  const current = asObj(await configOf(tool));
  const config = normalizeToolConfig(tool.kind, { ...current, ...patch });
  const db = await getDb();
  await db
    .updateTable("tools")
    .set({ config: await encryptSecret(JSON.stringify(config), TOOL_CONFIG_PURPOSE), status: "active", last_error: null, updated_at: now() })
    .where("id", "=", toolId)
    .execute();
  await markAgentsPending(workspaceId, toolId);
  return true;
}

/** Status after a runtime failure or success (tool runtime). */
export async function markToolStatus(toolId: number, ok: boolean, error: string | null = null): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db
    .updateTable("tools")
    .set(ok ? { status: "active", last_error: null, last_used_at: ts } : { status: "error", last_error: (error ?? "").slice(0, 1000), last_used_at: ts })
    .where("id", "=", toolId)
    .execute();
}

async function markAgentsPending(workspaceId: number, toolId: number): Promise<void> {
  const db = await getDb();
  const agentIds = (await db.selectFrom("agent_tools").select("agent_id").where("tool_id", "=", toolId).execute()).map((r) => r.agent_id);
  if (agentIds.length) await db.updateTable("agents").set({ sync_status: "pending", updated_at: now() }).where("workspace_id", "=", workspaceId).where("id", "in", agentIds).execute();
}

/** Deletes a tool and detaches it from every agent (those agents need a re-sync). */
export async function deleteTool(workspaceId: number, toolId: number, userId: number | null): Promise<boolean> {
  const tool = await getTool(workspaceId, toolId);
  if (!tool) return false;
  await markAgentsPending(workspaceId, toolId);
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("agent_tools").where("tool_id", "=", toolId).execute();
    await trx.deleteFrom("tools").where("id", "=", toolId).where("workspace_id", "=", workspaceId).execute();
  });
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "tool.deleted", entityType: "tool", entityId: toolId, data: { kind: tool.kind, name: tool.name } });
  return true;
}

/** Tool id → ids of the agents using it. */
export async function toolUsage(workspaceId: number): Promise<Map<number, number[]>> {
  const db = await getDb();
  const rows = await db.selectFrom("agent_tools").select(["tool_id", "agent_id"]).where("workspace_id", "=", workspaceId).execute();
  const out = new Map<number, number[]>();
  for (const r of rows) out.set(r.tool_id, [...(out.get(r.tool_id) ?? []), r.agent_id]);
  return out;
}

// ── "Test" button ──

export type ToolTestResult = { ok: true; detail: string; simulated?: boolean } | { ok: false; error: "not_connected" | "http" | "network" | "invalid" | "unsupported"; detail: string };

/**
 * Checks a tool's settings without placing a call: Cal.com reads the event type with the API key,
 * a webhook receives a signed test payload, Google tools must have a connected account, a
 * transfer number must be valid E.164. `fetchImpl` is for tests (Cal.com mock). Demo calendars
 * and DEMO_MODE ".example" webhooks report `simulated` without any request.
 */
export async function testTool(tool: Pick<ToolRecord, "id" | "kind" | "name">, fetchImpl: typeof fetch = fetch, options: { demo?: boolean; google?: { clientId: string; clientSecret: string } } = {}): Promise<ToolTestResult> {
  const config = asObj(await configOf(tool));
  // Demo calendars and ".example" webhooks answer from the simulated runtime (src/lib/tools/runtime.ts).
  const demo = options.demo ?? isDemoMode();
  const google = options.google ?? { clientId: "", clientSecret: "" };
  if ((tool.kind === "cal_com" || tool.kind === "google_calendar") && usesDemoCalendar(tool.kind, { apiKey: str(config.apiKey), refreshToken: str(config.refreshToken) }, { demo, google })) return { ok: true, detail: "", simulated: true };
  if (tool.kind === "webhook" && isDemoWebhook(str(config.url), demo)) return { ok: true, detail: "", simulated: true };
  switch (tool.kind) {
    case "cal_com": {
      let base: URL;
      try {
        // Same rules as the runtime: any port, private addresses only with ALLOW_PRIVATE_WEBHOOKS,
        // checked again when connecting (guardedFetch).
        base = str(config.apiBase) ? parseWebhookUrl(str(config.apiBase), allowPrivateTargets()) : new URL("https://api.cal.com");
      } catch (e) {
        return { ok: false, error: "invalid", detail: e instanceof Error ? e.message : "" };
      }
      const url = `${base.toString().replace(/\/+$/, "")}/v2/event-types/${Number(config.eventTypeId)}`;
      try {
        const res = await (str(config.apiBase) && fetchImpl === fetch ? guardedFetch : fetchImpl)(url, { headers: { Authorization: `Bearer ${str(config.apiKey)}`, "cal-api-version": "2024-06-14" }, redirect: "manual", signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { ok: false, error: "http", detail: `HTTP ${res.status}` };
        const body = asObj(await res.json().catch(() => ({})));
        const data = asObj(body.data);
        return { ok: true, detail: str(data.title) || str(data.slug) || `#${Number(config.eventTypeId)}` };
      } catch {
        return { ok: false, error: "network", detail: base.host };
      }
    }
    case "webhook": {
      const body = JSON.stringify({ event: "tool.test", tool: tool.name, args: {}, sent_at: new Date().toISOString() });
      const headers: Record<string, string> = { ...(asObj(config.headers) as Record<string, string>), "X-Dialzen-Event": "tool_test", ...signatureHeaders(body, str(config.secret)) };
      try {
        const status = await postJson(str(config.url), body, { timeoutMs: Number(config.timeoutMs) || 3000, headers, anyPort: true, allowPrivate: allowPrivateTargets() });
        return status >= 200 && status < 300 ? { ok: true, detail: `HTTP ${status}` } : { ok: false, error: "http", detail: `HTTP ${status}` };
      } catch (e) {
        return { ok: false, error: "network", detail: e instanceof ToolInputError ? e.message : "" };
      }
    }
    case "google_calendar":
    case "google_sheets":
      return str(config.refreshToken) ? { ok: true, detail: str(config.accountEmail) } : { ok: false, error: "not_connected", detail: "" };
    case "transfer":
      return isValidE164(config.number) ? { ok: true, detail: str(config.number) } : { ok: false, error: "invalid", detail: "" };
    default:
      return { ok: false, error: "unsupported", detail: "" };
  }
}
