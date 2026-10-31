import "server-only";
import { getAgent, markAgentSyncError, markAgentSynced, toAgentSpec, type AgentRecord } from "@/lib/agents";
import { auditSafe } from "@/lib/audit";
import { getDb, now } from "@/lib/db";
import type { KbItemRow } from "@/lib/db/schema";
import { getMediaItems, openMediaItem } from "@/lib/media/service";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "@/lib/notify";
import { accountFingerprint, contextAccount, getWorkspaceKeys, keySourceContext, platformKeys, providerContext, type KeySource, type ResolvedContext } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { buildToolSpec } from "@/lib/tools/specs";
import { agentRuntimeTools } from "@/lib/tools/store";
import { bannedOwnerWorkspaceIds, getWorkspace, getWorkspaceEntitlements } from "@/lib/workspaces";
import { isProvider } from "@/voice/normalize";
import { ProviderError, type KbDoc, type ToolSpec } from "@/voice/types";
import "./index";

/**
 * Pushes our agents (prompt, voice, tools, knowledge base, analysis fields, webhook) to the
 * provider that runs them. The agent builder calls syncAgentNow() after every save; the
 * "voice-sync" job retries agents left "pending" or "error".
 *
 * Provider accounts: an agent lives in the account of the keys it was synced with, the site's
 * ("platform") or the workspace's own ("byo"), recorded with a fingerprint of that account
 * (agents.sync_key_source / sync_account, kb_items.sync_account). When the account the workspace
 * uses changes (plan downgrade or upgrade, keys removed or replaced, the site's key changed), the
 * agent moves: its copy in the old account is deleted while that account's keys are still saved,
 * and it is created again in the account in use, with its knowledge-base documents. This is
 * checked whenever an agent is used (calls, numbers: ensureAgentSynced()) and by the "voice-sync"
 * job (agentsInOtherAccount()). Agents of suspended owners stay where they are until the ban is
 * lifted.
 */

export type SyncResult = { ok: true; agent: AgentRecord } | { ok: false; error: string; kind: ProviderError["kind"] | "not_found" | "no_provider" };

function message(error: unknown): { text: string; kind: ProviderError["kind"] } {
  if (error instanceof ProviderError) return { text: error.message, kind: error.kind };
  return { text: error instanceof Error ? error.message : "Sync failed.", kind: "unknown" };
}

const notFound = (e: unknown) => e instanceof ProviderError && e.kind === "not_found";

// ── Provider accounts ──

export interface SyncAccount {
  keySource: KeySource;
  /** accountFingerprint() of the account's API key. */
  account: string;
}

type AgentAccountFields = Pick<AgentRecord, "workspaceId" | "provider" | "providerAgentId" | "syncKeySource" | "syncAccount">;

const sameAccount = (a: SyncAccount | null, b: SyncAccount | null): boolean => Boolean(a && b && a.keySource === b.keySource && a.account === b.account);

/**
 * The account an agent's provider copy is in (null = not synced). Agents synced before this was
 * recorded are taken to be in the account of the workspace's saved keys, else the site's.
 */
export async function agentSyncedAccount(agent: AgentAccountFields): Promise<SyncAccount | null> {
  if (!agent.providerAgentId) return null;
  if (agent.syncKeySource && agent.syncAccount) return { keySource: agent.syncKeySource, account: agent.syncAccount };
  if (agent.provider === "simulated") return { keySource: "platform", account: "simulated" };
  const byo = await getWorkspaceKeys(agent.workspaceId, agent.provider);
  if (byo) return { keySource: "byo", account: accountFingerprint(agent.provider, byo) };
  return { keySource: "platform", account: accountFingerprint(agent.provider, platformKeys(await getSettings(), agent.provider)) };
}

/** True when the agent's provider copy is in another account than `resolved` (the one in use). */
export async function agentInOtherAccount(agent: AgentAccountFields, resolved: ResolvedContext): Promise<boolean> {
  const synced = await agentSyncedAccount(agent);
  return synced !== null && !sameAccount(synced, contextAccount(resolved.ctx));
}

/** The context of the account an agent's copy is in (with that key source's keys as saved now); null when they are gone. */
export async function agentAccountContext(agent: AgentAccountFields, timeoutMs = 15_000): Promise<ResolvedContext | null> {
  const synced = await agentSyncedAccount(agent);
  if (!synced) return null;
  return keySourceContext(agent.workspaceId, agent.provider, synced.keySource, { timeoutMs });
}

/**
 * Moves an agent whose copy is in another account than `account`: deletes the old copy (and the
 * workspace's knowledge-base documents there) while that account's keys are still saved, and
 * clears the provider ids so the agent and its documents are created again. Returns the agent.
 */
async function moveToAccount(agent: AgentRecord, account: SyncAccount): Promise<AgentRecord> {
  const synced = await agentSyncedAccount(agent);
  if (!synced || sameAccount(synced, account)) return agent;
  const db = await getDb();
  const old = await keySourceContext(agent.workspaceId, agent.provider, synced.keySource);
  let removed = false;
  if (old && agent.providerAgentId) {
    try {
      await old.provider.deleteAgent(old.ctx, agent.providerAgentId, agent.providerMeta);
      removed = true;
    } catch (error) {
      removed = notFound(error);
    }
  }
  const docs = await db
    .selectFrom("kb_items")
    .select(["id", "provider_doc_id", "sync_account"])
    .where("workspace_id", "=", agent.workspaceId)
    .where("provider", "=", agent.provider)
    .execute();
  const stale = docs.filter((d) => d.sync_account !== account.account);
  if (old?.provider.capabilities.knowledgeBase) {
    for (const d of stale.slice(0, 200)) if (d.provider_doc_id) await old.provider.deleteKbItem(old.ctx, d.provider_doc_id).catch(() => undefined);
  }
  const ts = now();
  if (stale.length) {
    await db
      .updateTable("kb_items")
      .set({ provider_doc_id: null, sync_account: null, status: "pending", error: null, updated_at: ts })
      .where("id", "in", stale.map((d) => d.id))
      .execute();
  }
  await db.updateTable("agents").set({ provider_agent_id: null, provider_meta: "{}", sync_key_source: null, sync_account: null, sync_status: "pending", updated_at: ts }).where("id", "=", agent.id).execute();
  await auditSafe({
    workspaceId: agent.workspaceId,
    actor: { type: "system", id: null },
    action: "agent.account_changed",
    entityType: "agent",
    entityId: agent.id,
    data: { provider: agent.provider, from: synced.keySource, to: account.keySource, oldCopyRemoved: removed },
  });
  return (await getAgent(agent.workspaceId, agent.id)) ?? agent;
}

async function toKbDoc(row: KbItemRow): Promise<KbDoc> {
  let file: KbDoc["file"] = null;
  if (row.kind === "file" && row.media_id) {
    const [media] = await getMediaItems(row.workspace_id, [row.media_id]);
    if (media) file = { filename: media.filename, mime: media.mime, size: media.size, open: () => openMediaItem(media) };
  }
  return { id: row.id, kind: row.kind, name: row.name, url: row.url ?? "", text: row.content ?? "", file, providerDocId: row.provider_doc_id };
}

/** Knowledge-base items of an agent: its own and the workspace's shared ones. */
async function agentKbRows(agent: AgentRecord): Promise<KbItemRow[]> {
  const db = await getDb();
  return db
    .selectFrom("kb_items")
    .selectAll()
    .where("workspace_id", "=", agent.workspaceId)
    .where((eb) => eb.or([eb("agent_id", "=", agent.id), eb("agent_id", "is", null)]))
    .orderBy("id")
    .limit(200)
    .execute();
}

/** Tool specs of an agent as adapters receive them. */
export async function agentToolSpecs(agent: AgentRecord, baseUrl: string): Promise<ToolSpec[]> {
  const tools = await agentRuntimeTools(agent.id);
  return tools.map((t) => buildToolSpec(t, t.config, agent, baseUrl));
}

/**
 * Syncs an agent now: uploads knowledge-base items the provider doesn't have yet, then creates or
 * updates the provider's agent, and stores the provider ids and the sync status. Never throws.
 */
export async function syncAgentNow(agentId: number, options: { workspaceId?: number; notifyOnError?: boolean } = {}): Promise<SyncResult> {
  const db = await getDb();
  const row = await db.selectFrom("agents").select(["workspace_id"]).where("id", "=", agentId).executeTakeFirst();
  if (!row || (options.workspaceId && row.workspace_id !== options.workspaceId)) return { ok: false, error: "Agent not found.", kind: "not_found" };
  const found = await getAgent(row.workspace_id, agentId);
  const workspace = await getWorkspace(row.workspace_id);
  if (!found || !workspace) return { ok: false, error: "Agent not found.", kind: "not_found" };
  let agent: AgentRecord = found;
  const entitlements = await getWorkspaceEntitlements(workspace);
  let resolved = await providerContext(workspace.id, agent.provider, entitlements);
  // A suspended owner's agents stay in the account they are in until the ban is lifted.
  if (entitlements.suspended && agent.providerAgentId) resolved = (await agentAccountContext(agent)) ?? resolved;
  if (!resolved) {
    const error = `The ${agent.provider} provider is not configured on this site.`;
    await markAgentSyncError(agent.id, error);
    return { ok: false, error, kind: "no_provider" };
  }
  const { provider, ctx } = resolved;
  const account = contextAccount(ctx);
  try {
    agent = await moveToAccount(agent, account);
    const kbRows = provider.capabilities.knowledgeBase ? await agentKbRows(agent) : [];
    const docs: KbDoc[] = [];
    for (const kb of kbRows) {
      const doc = await toKbDoc(kb);
      const sameDocAccount = kb.provider === agent.provider && (kb.sync_account === null || kb.sync_account === account.account);
      if (sameDocAccount && kb.provider_doc_id && kb.status === "ready") {
        // Uploaded before accounts were recorded: record it now.
        if (kb.sync_account === null) await db.updateTable("kb_items").set({ sync_account: account.account }).where("id", "=", kb.id).execute();
        docs.push(doc);
        continue;
      }
      try {
        const { providerDocId } = await provider.syncKbItem(ctx, { ...doc, providerDocId: sameDocAccount ? kb.provider_doc_id : null });
        await db.updateTable("kb_items").set({ provider: agent.provider, provider_doc_id: providerDocId, sync_account: account.account, status: "ready", error: null, updated_at: now() }).where("id", "=", kb.id).execute();
        docs.push({ ...doc, providerDocId });
      } catch (error) {
        const m = message(error);
        await db.updateTable("kb_items").set({ status: "error", error: m.text.slice(0, 1000), updated_at: now() }).where("id", "=", kb.id).execute();
        // An auth or network problem stops the whole sync; a bad document only skips itself.
        if (m.kind !== "validation" && m.kind !== "unsupported") throw error;
      }
    }
    const spec = await toAgentSpec(agent);
    const tools = await agentToolSpecs(agent, ctx.baseUrl);
    const result = await provider.syncAgent(ctx, spec, tools, docs);
    await markAgentSynced(agent.id, result.providerAgentId, result.providerMeta, account);
    // Numbers routed to this agent follow a newly created provider agent.
    if (result.providerAgentId !== agent.providerAgentId) await relinkNumbers(agent.workspaceId, agent.id, result.providerAgentId);
    return { ok: true, agent: (await getAgent(agent.workspaceId, agent.id))! };
  } catch (error) {
    const m = message(error);
    await markAgentSyncError(agent.id, m.text);
    if (options.notifyOnError) {
      const payload = await buildNotifyPayload(workspace, "agent_sync_failed", `The agent "${agent.name}" could not be updated at ${agent.provider}: ${m.text}`, { agent: agent.name, agent_id: agent.id, error: m.text }, workspaceDashboardPath(workspace.id, `agents/${agent.id}`));
      await notifyWorkspace(workspace.id, payload);
    }
    return { ok: false, error: m.text, kind: m.kind };
  }
}

/** Points the provider's numbers that route to this agent at its (new) provider agent id. Best effort. */
async function relinkNumbers(workspaceId: number, agentId: number, providerAgentId: string): Promise<void> {
  const db = await getDb();
  const numbers = await db.selectFrom("phone_numbers").selectAll().where("workspace_id", "=", workspaceId).where("inbound_agent_id", "=", agentId).where("status", "=", "active").execute();
  if (!numbers.length) return;
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return;
  const { setNumberInboundAgent } = await import("./numbers");
  for (const n of numbers) await setNumberInboundAgent(workspace, n.id, agentId, { providerAgentIdOverride: providerAgentId }).catch(() => undefined);
}

/**
 * Ensures an agent is synced into the account in use (`resolved`) before a call or a number uses
 * it: syncs a pending agent, and moves one whose copy is in another account.
 */
export async function ensureAgentSynced(agent: AgentRecord, resolved: ResolvedContext | null): Promise<{ ok: true; agent: AgentRecord } | { ok: false; error: string }> {
  const elsewhere = resolved ? await agentInOtherAccount(agent, resolved) : false;
  if (agent.syncStatus === "synced" && agent.providerAgentId && !elsewhere) return { ok: true, agent };
  const res = await syncAgentNow(agent.id, { workspaceId: agent.workspaceId });
  return res.ok ? { ok: true, agent: res.agent } : { ok: false, error: res.error };
}

/** Deletes the provider's copy of an agent in the account it is in (call before lib/agents deleteAgent). Best effort; returns an error text or null. */
export async function deleteAgentRemote(agent: AgentAccountFields & Pick<AgentRecord, "providerMeta">): Promise<string | null> {
  if (!agent.providerAgentId) return null;
  const resolved = await agentAccountContext(agent);
  if (!resolved) return null;
  try {
    await resolved.provider.deleteAgent(resolved.ctx, agent.providerAgentId, agent.providerMeta);
    return null;
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "not_found") return null;
    return message(error).text;
  }
}

/** Deletes a knowledge-base item's provider document (call before deleting the kb_items row). Best effort. */
export async function deleteKbItemRemote(workspaceId: number, kbItemId: number): Promise<string | null> {
  const db = await getDb();
  const row = await db.selectFrom("kb_items").selectAll().where("id", "=", kbItemId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!row?.provider || !row.provider_doc_id) return null;
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return null;
  const resolved = await providerContext(workspaceId, row.provider, await getWorkspaceEntitlements(workspace));
  if (!resolved) return null;
  try {
    await resolved.provider.deleteKbItem(resolved.ctx, row.provider_doc_id);
    return null;
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "not_found") return null;
    return message(error).text;
  }
}

/**
 * Agents whose provider copy is in another account than their workspace uses now (plan changed,
 * keys removed or replaced, the site's key changed): marked "pending" and returned for the
 * "voice-sync" job to move. Skips suspended owners and providers that aren't configured.
 */
export async function agentsInOtherAccount(limit = 10): Promise<number[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("agents")
    .select(["id", "workspace_id", "provider", "provider_agent_id", "sync_key_source", "sync_account"])
    .where("provider", "!=", "simulated")
    .where("provider_agent_id", "is not", null)
    .where("sync_status", "=", "synced")
    .orderBy("id")
    .limit(5000)
    .execute();
  if (!rows.length) return [];
  const suspended = new Set(await bannedOwnerWorkspaceIds());
  const inUse = new Map<string, SyncAccount | null>();
  const out: number[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (suspended.has(r.workspace_id) || !isProvider(r.provider)) continue;
    const key = `${r.workspace_id}:${r.provider}`;
    if (!inUse.has(key)) {
      const ws = await getWorkspace(r.workspace_id);
      const ent = ws ? await getWorkspaceEntitlements(ws) : null;
      const resolved = ws && ent && !ent.suspended ? await providerContext(ws.id, r.provider, ent) : null;
      inUse.set(key, resolved ? contextAccount(resolved.ctx) : null);
    }
    const current = inUse.get(key) ?? null;
    if (!current) continue;
    const syncKeySource = r.sync_key_source === "byo" || r.sync_key_source === "platform" ? r.sync_key_source : null;
    const synced = await agentSyncedAccount({ workspaceId: r.workspace_id, provider: r.provider, providerAgentId: r.provider_agent_id, syncKeySource, syncAccount: r.sync_account ?? null });
    if (sameAccount(synced, current)) {
      // Synced before accounts were recorded: record it now.
      if (!r.sync_account) await db.updateTable("agents").set({ sync_key_source: current.keySource, sync_account: current.account }).where("id", "=", r.id).execute();
      continue;
    }
    await db.updateTable("agents").set({ sync_status: "pending", sync_error: null, updated_at: now() }).where("id", "=", r.id).execute();
    out.push(r.id);
  }
  return out;
}

/** Agents to (re)sync: pending ones, and failed ones every 30 minutes. */
export async function agentsNeedingSync(limit = 10): Promise<number[]> {
  const db = await getDb();
  const retryBefore = new Date(Date.now() - 30 * 60_000).toISOString();
  const settle = new Date(Date.now() - 20_000).toISOString();
  const rows = await db
    .selectFrom("agents")
    .select("id")
    .where((eb) => eb.or([eb.and([eb("sync_status", "=", "pending"), eb("updated_at", "<", settle)]), eb.and([eb("sync_status", "=", "error"), eb("updated_at", "<", retryBefore)])]))
    .orderBy("updated_at")
    .limit(limit)
    .execute();
  return rows.map((r) => r.id);
}

// ── Workspace keys (BYO) changed ──

/**
 * The workspace's own keys of a provider are about to change (saved, replaced or removed): its
 * agents on that provider move to another provider account. Deletes their copies in the account
 * that is still in use (best effort). Call before the keys change, then resyncAfterKeyChange().
 */
export async function removeRemoteAgentsBeforeKeyChange(workspaceId: number, provider: string): Promise<void> {
  const db = await getDb();
  const rows = await db.selectFrom("agents").select("id").where("workspace_id", "=", workspaceId).where("provider", "=", provider).where("provider_agent_id", "is not", null).limit(200).execute();
  for (const r of rows) {
    const agent = await getAgent(workspaceId, r.id);
    if (agent) await deleteAgentRemote(agent).catch(() => null);
  }
}

/**
 * The workspace's own keys of a provider are about to be removed while its plan doesn't use them
 * (any more): agents still in that account are deleted from it (best effort, with those keys) and
 * marked "pending" for the site's account. Call before deleting the keys; returns their ids.
 */
export async function moveAgentsOffOwnKeys(workspaceId: number, provider: string): Promise<number[]> {
  if (!isProvider(provider) || provider === "simulated") return [];
  const target: SyncAccount = { keySource: "platform", account: accountFingerprint(provider, platformKeys(await getSettings(), provider)) };
  const db = await getDb();
  const rows = await db.selectFrom("agents").select("id").where("workspace_id", "=", workspaceId).where("provider", "=", provider).where("provider_agent_id", "is not", null).orderBy("id").limit(500).execute();
  const moved: number[] = [];
  for (const r of rows) {
    const agent = await getAgent(workspaceId, r.id);
    if (!agent || (await agentSyncedAccount(agent))?.keySource !== "byo") continue;
    await moveToAccount(agent, target);
    moved.push(agent.id);
  }
  return moved;
}

/**
 * After a key change: the agents (and knowledge-base documents) of that provider get no provider
 * ids, are marked "pending" and synced now with the keys in use (the first 10; the "voice-sync"
 * job does the rest). Returns how many synced now and how many failed.
 */
export async function resyncAfterKeyChange(workspaceId: number, provider: string): Promise<{ synced: number; failed: number; pending: number }> {
  const db = await getDb();
  const ts = now();
  await db.updateTable("kb_items").set({ provider_doc_id: null, sync_account: null, status: "pending", error: null, updated_at: ts }).where("workspace_id", "=", workspaceId).where("provider", "=", provider).execute();
  const rows = await db.selectFrom("agents").select("id").where("workspace_id", "=", workspaceId).where("provider", "=", provider).orderBy("id").limit(500).execute();
  if (!rows.length) return { synced: 0, failed: 0, pending: 0 };
  await db.updateTable("agents").set({ provider_agent_id: null, provider_meta: "{}", sync_key_source: null, sync_account: null, sync_status: "pending", sync_error: null, updated_at: ts }).where("workspace_id", "=", workspaceId).where("provider", "=", provider).execute();
  let synced = 0;
  let failed = 0;
  for (const r of rows.slice(0, 10)) {
    const res = await syncAgentNow(r.id, { workspaceId });
    if (res.ok) synced++;
    else failed++;
  }
  return { synced, failed, pending: rows.length - synced - failed };
}
