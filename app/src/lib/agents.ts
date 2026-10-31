import "server-only";
import { auditSafe } from "./audit";
import { getCompliance } from "./compliance";
import { sign } from "./crypto";
import { getDb, now } from "./db";
import type { AgentRow } from "./db/schema";
import { atLimit, type Entitlements } from "./plans";
import { getSettings } from "./settings";
import { absoluteUrl } from "./site";
import { randomToken } from "./tokens";
import { ownedWorkspaceIds } from "./workspaces";
import { asObj, ensureDisclosure, isProvider, normalizeAgentSettings, normalizeAgentStatus, normalizeLanguageTag, parseJson, str, text } from "@/voice/normalize";
import { getTemplate, templatePrompt } from "@/voice/templates";
import type { AgentSettings, AgentSpec, AgentStatus, ProviderId, SyncStatus } from "@/voice/types";

/**
 * AI agents of a workspace: our database is the source of truth; providers get a synced copy
 * (sync_status "pending" after every change until the provider phase syncs it).
 *
 * Limits: the owner's plan max_agents counts agents across all the workspaces the owner owns.
 * The first message always carries the AI disclosure and the business name (ensureDisclosure()).
 */

export interface AgentRecord {
  id: number;
  workspaceId: number;
  name: string;
  template: string;
  status: AgentStatus;
  provider: ProviderId;
  providerAgentId: string | null;
  providerMeta: Record<string, string>;
  syncStatus: SyncStatus;
  syncError: string | null;
  syncedAt: string | null;
  /** The provider account of the last sync (null = not synced since this was tracked). */
  syncKeySource: "platform" | "byo" | null;
  syncAccount: string | null;
  language: string;
  voiceId: string;
  voiceName: string;
  firstMessage: string;
  systemPrompt: string;
  llm: string;
  settings: AgentSettings;
  toolSecret: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export function toAgentRecord(row: AgentRow): AgentRecord {
  const meta = asObj(parseJson(row.provider_meta));
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    template: row.template,
    status: normalizeAgentStatus(row.status),
    provider: isProvider(row.provider) ? row.provider : "simulated",
    providerAgentId: row.provider_agent_id,
    providerMeta: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    syncedAt: row.synced_at,
    syncKeySource: row.sync_key_source === "byo" || row.sync_key_source === "platform" ? row.sync_key_source : null,
    syncAccount: row.sync_account ?? null,
    language: row.language,
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    firstMessage: row.first_message,
    systemPrompt: row.system_prompt,
    llm: row.llm,
    settings: normalizeAgentSettings(parseJson(row.settings)),
    toolSecret: row.tool_secret,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAgents(workspaceId: number): Promise<AgentRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("agents").selectAll().where("workspace_id", "=", workspaceId).orderBy("created_at", "desc").orderBy("id", "desc").execute();
  return rows.map(toAgentRecord);
}

export async function getAgent(workspaceId: number, agentId: number): Promise<AgentRecord | undefined> {
  if (!Number.isInteger(agentId) || agentId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("agents").selectAll().where("id", "=", agentId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toAgentRecord(row) : undefined;
}

/** An agent by the provider's id (webhook routing). */
export async function findAgentByProviderId(provider: string, providerAgentId: string): Promise<AgentRecord | undefined> {
  const db = await getDb();
  const row = await db.selectFrom("agents").selectAll().where("provider", "=", provider).where("provider_agent_id", "=", providerAgentId).executeTakeFirst();
  return row ? toAgentRecord(row) : undefined;
}

/** Agents across all the workspaces the owner owns (the plan's max_agents). */
export async function countOwnerAgents(ownerId: number): Promise<number> {
  const ids = await ownedWorkspaceIds(ownerId);
  if (!ids.length) return 0;
  const db = await getDb();
  const row = await db.selectFrom("agents").select((eb) => eb.fn.countAll<number>().as("n")).where("workspace_id", "in", ids).executeTakeFirst();
  return Number(row?.n ?? 0);
}

export interface AgentInput {
  name: string;
  template?: string;
  status?: AgentStatus;
  provider?: string;
  language?: string;
  voiceId?: string;
  voiceName?: string;
  firstMessage?: string;
  systemPrompt?: string;
  llm?: string;
  settings?: unknown;
}

export type CreateAgentResult = { ok: true; agent: AgentRecord } | { ok: false; error: "limit" | "name" | "provider"; used?: number; limit?: number };

/** The business name said in first messages: the agent's own, else the workspace's compliance name. */
async function businessNameFor(workspace: { id: number; name: string }, settings: AgentSettings): Promise<string> {
  if (settings.businessName) return settings.businessName;
  return (await getCompliance(workspace)).settings.businessName || workspace.name;
}

/**
 * Creates an agent (plan limit checked). Missing fields come from the template when one is given;
 * the provider defaults to Admin → Voice providers → default provider.
 */
export async function createAgent(workspace: { id: number; name: string; ownerId: number; settings: { defaultLanguage: string } }, entitlements: Pick<Entitlements, "maxAgents">, input: AgentInput, userId: number | null): Promise<CreateAgentResult> {
  const name = str(input.name, "", 120);
  if (!name) return { ok: false, error: "name" };
  const used = await countOwnerAgents(workspace.ownerId);
  if (atLimit(used, entitlements.maxAgents)) return { ok: false, error: "limit", used, limit: entitlements.maxAgents };
  const site = await getSettings();
  const provider = input.provider ?? site.voice_default_provider;
  if (!isProvider(provider)) return { ok: false, error: "provider" };

  const template = input.template ? getTemplate(input.template) : undefined;
  const settings = normalizeAgentSettings({
    ...(template ? { ...template.settings, analysisFields: template.analysisFields } : {}),
    ...asObj(input.settings),
  });
  const language = normalizeLanguageTag(input.language, workspace.settings.defaultLanguage);
  const business = await businessNameFor(workspace, settings);
  const firstMessage = ensureDisclosure(text(input.firstMessage ?? template?.firstMessage ?? "", 2000), business, language);
  const systemPrompt = text(input.systemPrompt ?? (template ? templatePrompt(template) : ""), 50_000);
  const ts = now();
  const db = await getDb();
  const res = await db
    .insertInto("agents")
    .values({
      workspace_id: workspace.id,
      name,
      template: template?.id ?? "",
      status: input.status ?? "draft",
      provider,
      provider_agent_id: null,
      provider_meta: "{}",
      sync_status: "pending",
      sync_error: null,
      synced_at: null,
      language,
      voice_id: str(input.voiceId, "", 190),
      voice_name: str(input.voiceName, "", 190),
      first_message: firstMessage,
      system_prompt: systemPrompt,
      llm: str(input.llm, "", 80),
      settings: JSON.stringify(settings),
      tool_secret: randomToken(32),
      created_by: userId,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();
  const agent = (await getAgent(workspace.id, Number(res.insertId)))!;
  await auditSafe({ workspaceId: workspace.id, actor: { type: "user", id: userId }, action: "agent.created", entityType: "agent", entityId: agent.id, data: { name, template: agent.template, provider } });
  return { ok: true, agent };
}

/**
 * Updates an agent and marks it for re-sync. The first message keeps its AI disclosure: when an
 * edit removes it, the disclosure sentence is put back in front.
 */
export async function updateAgent(workspace: { id: number; name: string }, agentId: number, patch: Partial<AgentInput>, userId: number | null): Promise<AgentRecord | undefined> {
  const current = await getAgent(workspace.id, agentId);
  if (!current) return undefined;
  const settings = patch.settings !== undefined ? normalizeAgentSettings({ ...current.settings, ...asObj(patch.settings) }) : current.settings;
  const language = patch.language !== undefined ? normalizeLanguageTag(patch.language, current.language) : current.language;
  const needsDisclosure = patch.firstMessage !== undefined || patch.settings !== undefined || patch.language !== undefined;
  const firstMessage = needsDisclosure ? ensureDisclosure(text(patch.firstMessage ?? current.firstMessage, 2000), await businessNameFor(workspace, settings), language) : current.firstMessage;
  const provider = patch.provider !== undefined && isProvider(patch.provider) ? patch.provider : current.provider;
  const db = await getDb();
  await db
    .updateTable("agents")
    .set({
      ...(patch.name !== undefined ? { name: str(patch.name, current.name, 120) || current.name } : {}),
      ...(patch.status !== undefined ? { status: normalizeAgentStatus(patch.status) } : {}),
      ...(patch.voiceId !== undefined ? { voice_id: str(patch.voiceId, "", 190) } : {}),
      ...(patch.voiceName !== undefined ? { voice_name: str(patch.voiceName, "", 190) } : {}),
      ...(patch.systemPrompt !== undefined ? { system_prompt: text(patch.systemPrompt, 50_000) } : {}),
      ...(patch.llm !== undefined ? { llm: str(patch.llm, "", 80) } : {}),
      // A provider switch starts from scratch at the new provider.
      ...(provider !== current.provider ? { provider, provider_agent_id: null, provider_meta: "{}", sync_key_source: null, sync_account: null } : {}),
      language,
      first_message: firstMessage,
      settings: JSON.stringify(settings),
      sync_status: "pending",
      sync_error: null,
      updated_at: now(),
    })
    .where("id", "=", agentId)
    .where("workspace_id", "=", workspace.id)
    .execute();
  await auditSafe({ workspaceId: workspace.id, actor: { type: "user", id: userId }, action: "agent.updated", entityType: "agent", entityId: agentId, data: { fields: Object.keys(patch) } });
  return getAgent(workspace.id, agentId);
}

export type DeleteAgentResult = { ok: true } | { ok: false; error: "not_found" | "in_use" };

/**
 * Deletes an agent with its own knowledge-base items and tool links; numbers that route to it
 * lose their inbound agent. Refused while a campaign that isn't finished uses it. The caller
 * deletes the provider's copy first (best effort).
 */
export async function deleteAgent(workspaceId: number, agentId: number, userId: number | null): Promise<DeleteAgentResult> {
  const db = await getDb();
  const agent = await getAgent(workspaceId, agentId);
  if (!agent) return { ok: false, error: "not_found" };
  const busy = await db.selectFrom("campaigns").select("id").where("workspace_id", "=", workspaceId).where("agent_id", "=", agentId).where("status", "in", ["scheduled", "running", "paused"]).executeTakeFirst();
  if (busy) return { ok: false, error: "in_use" };
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("agent_tools").where("agent_id", "=", agentId).execute();
    await trx.deleteFrom("kb_items").where("workspace_id", "=", workspaceId).where("agent_id", "=", agentId).execute();
    await trx.updateTable("phone_numbers").set({ inbound_agent_id: null, updated_at: now() }).where("workspace_id", "=", workspaceId).where("inbound_agent_id", "=", agentId).execute();
    await trx.updateTable("phone_numbers").set({ outbound_agent_id: null, updated_at: now() }).where("workspace_id", "=", workspaceId).where("outbound_agent_id", "=", agentId).execute();
    await trx.deleteFrom("agents").where("id", "=", agentId).execute();
  });
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "agent.deleted", entityType: "agent", entityId: agentId, data: { name: agent.name } });
  return { ok: true };
}

// ── Sync state (set by the provider sync) ──

export async function markAgentSynced(agentId: number, providerAgentId: string, providerMeta: Record<string, string>, account?: { keySource: "platform" | "byo"; account: string }): Promise<void> {
  const db = await getDb();
  const ts = now();
  await db
    .updateTable("agents")
    .set({
      provider_agent_id: providerAgentId,
      provider_meta: JSON.stringify(providerMeta),
      sync_status: "synced",
      sync_error: null,
      synced_at: ts,
      updated_at: ts,
      ...(account ? { sync_key_source: account.keySource, sync_account: account.account } : {}),
    })
    .where("id", "=", agentId)
    .execute();
}

export async function markAgentSyncError(agentId: number, error: string): Promise<void> {
  const db = await getDb();
  await db.updateTable("agents").set({ sync_status: "error", sync_error: error.slice(0, 1000), updated_at: now() }).where("id", "=", agentId).execute();
}

// ── Tools attached to an agent ──

export async function agentToolIds(agentId: number): Promise<number[]> {
  const db = await getDb();
  return (await db.selectFrom("agent_tools").select("tool_id").where("agent_id", "=", agentId).orderBy("tool_id").execute()).map((r) => r.tool_id);
}

/** Replaces the agent's tools with `toolIds` (other workspaces' tools are ignored). */
export async function setAgentTools(workspaceId: number, agentId: number, toolIds: number[]): Promise<void> {
  const db = await getDb();
  const valid = toolIds.length ? (await db.selectFrom("tools").select("id").where("workspace_id", "=", workspaceId).where("id", "in", toolIds).execute()).map((r) => r.id) : [];
  const ts = now();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("agent_tools").where("agent_id", "=", agentId).execute();
    if (valid.length) await trx.insertInto("agent_tools").values(valid.map((tool_id) => ({ agent_id: agentId, tool_id, workspace_id: workspaceId, created_at: ts }))).execute();
    await trx.updateTable("agents").set({ sync_status: "pending", updated_at: ts }).where("id", "=", agentId).execute();
  });
}

// ── For the provider adapters ──

const INBOUND_PURPOSE = "elevenlabs-inbound";
export const INBOUND_SECRET_HEADER = "x-dialzen-inbound-secret";

/** Secret header value ElevenLabs sends to our conversation-initiation webhook for one agent. */
export async function inboundWebhookSecret(agentId: number): Promise<string> {
  return sign(`agent:${agentId}`, INBOUND_PURPOSE);
}

/**
 * Our conversation-initiation webhook for an ElevenLabs agent (inbound calls get their variables
 * from it). Only set when the site is reachable from the internet over HTTPS: ElevenLabs doesn't
 * start the conversation when the webhook fails.
 */
export async function inboundWebhookFor(agentId: number, settings: Awaited<ReturnType<typeof getSettings>>): Promise<{ url: string; secret: string } | null> {
  const url = absoluteUrl(settings, "/api/voice/inbound/elevenlabs");
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(host)) return null;
  return { url, secret: await inboundWebhookSecret(agentId) };
}

/** The agent as adapters receive it (webhook URL built from the site URL). */
export async function toAgentSpec(agent: AgentRecord): Promise<AgentSpec> {
  const settings = await getSettings();
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    name: agent.name,
    language: agent.language,
    voiceId: agent.voiceId,
    firstMessage: agent.firstMessage,
    systemPrompt: agent.systemPrompt,
    llm: agent.llm,
    settings: agent.settings,
    providerAgentId: agent.providerAgentId,
    providerMeta: agent.providerMeta,
    webhookUrl: absoluteUrl(settings, `/api/voice/webhook/${agent.provider}`),
    inboundWebhook: agent.provider === "elevenlabs" ? await inboundWebhookFor(agent.id, settings) : null,
  };
}
