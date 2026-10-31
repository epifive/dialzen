import "server-only";
import { getAgent } from "@/lib/agents";
import { auditSafe, type AuditActorType } from "@/lib/audit";
import { getDb, now } from "@/lib/db";
import { markNumberReleased } from "@/lib/numbers";
import { getEntitlements } from "@/lib/plans";
import { contextForKeys, getProvider, getWorkspaceKeys, platformKeys, providerContext } from "@/lib/providers";
import { readRaw, writeRaw } from "@/lib/scheduler";
import { getSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspaces";
import { isProvider, parseJson } from "@/voice/normalize";
import { LIVE_CALL_STATUSES, ProviderError, type ProviderId } from "@/voice/types";
import { agentAccountContext } from "./sync";
import "./index";

/**
 * What a deleted workspace leaves at the voice providers: phone numbers (bought numbers cost the
 * site every month), agents (which keep answering those numbers), their server tools and
 * knowledge-base documents. cleanupWorkspaceProviders() removes them, best effort, before the
 * workspace's rows are deleted (Settings → Delete workspace, Admin → Users → Delete):
 *
 *   campaigns stopped → live calls closed without billing → numbers released (inbound routing
 *   goes with them) → provider agents deleted (with their tools) → knowledge-base documents deleted
 *
 * Whatever fails is written to the audit log and kept in the settings row
 * "voice_cleanup_leftovers" for Admin → Voice providers, where the admin can retry it (with the
 * site's keys, or a workspace's own keys while they are still saved). Erasure requests
 * (src/lib/erasure.ts) record the provider copies of calls they couldn't delete the same way.
 */

export interface CleanupLeftover {
  at: string;
  workspaceId: number;
  workspaceName: string;
  provider: ProviderId;
  kind: "number" | "agent" | "kb" | "call";
  /** The provider's id of the resource. */
  ref: string;
  /** Extra provider ids (agent meta: LLM, tools, KB). */
  meta: Record<string, string>;
  keySource: "platform" | "byo";
  label: string;
  error: string;
}

export interface CleanupResult {
  numbers: number;
  agents: number;
  kb: number;
  leftovers: CleanupLeftover[];
}

const LEFTOVERS_KEY = "voice_cleanup_leftovers";
const MAX_LEFTOVERS = 200;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const notFound = (e: unknown) => e instanceof ProviderError && e.kind === "not_found";

export async function cleanupLeftovers(): Promise<CleanupLeftover[]> {
  const v = parseJson(await readRaw(LEFTOVERS_KEY));
  return Array.isArray(v) ? (v as CleanupLeftover[]) : [];
}

async function saveLeftovers(list: CleanupLeftover[]): Promise<void> {
  await writeRaw(LEFTOVERS_KEY, list.length ? JSON.stringify(list.slice(-MAX_LEFTOVERS)) : null);
}

export type LeftoverInput = Omit<CleanupLeftover, "at" | "workspaceId" | "workspaceName">;

/**
 * Records resources that could not be removed at a provider: one audit entry each (`action`) and
 * the admin's "Provider cleanup failed" list (Admin → Voice providers), where they can be retried.
 */
export async function recordLeftovers(
  workspace: { id: number; name: string },
  actor: { type: AuditActorType; id: number | null },
  items: LeftoverInput[],
  action = "workspace.provider_cleanup_failed",
): Promise<void> {
  if (!items.length) return;
  const at = new Date().toISOString();
  const list = items.map((l) => ({ ...l, at, workspaceId: workspace.id, workspaceName: workspace.name }));
  for (const l of list) await auditSafe({ workspaceId: workspace.id, actor, action, entityType: l.kind, entityId: l.ref, data: { provider: l.provider, label: l.label, error: l.error, keySource: l.keySource } });
  await saveLeftovers([...(await cleanupLeftovers()), ...list]);
}

/** Removes the workspace's resources at the voice providers. Never throws. */
export async function cleanupWorkspaceProviders(workspaceId: number, actor: { type: "user" | "system"; id: number | null } = { type: "system", id: null }): Promise<CleanupResult> {
  const result: CleanupResult = { numbers: 0, agents: 0, kb: 0, leftovers: [] };
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return result;
  const db = await getDb();
  const ts = now();
  try {
    // 1. No more dialing.
    await db.updateTable("campaigns").set({ status: "canceled", paused_reason: null, completed_at: ts, updated_at: ts }).where("workspace_id", "=", workspaceId).where("status", "in", ["scheduled", "running", "paused"]).execute();
    // 2. Live calls are closed without billing (late webhooks then find no call and are ignored).
    await db
      .updateTable("calls")
      .set({ status: "canceled", end_reason: "canceled", ended_at: ts, error: "The workspace was deleted.", updated_at: ts })
      .where("workspace_id", "=", workspaceId)
      .where("status", "in", [...LIVE_CALL_STATUSES])
      .execute();
  } catch (error) {
    console.error("[dialzen] cleanup: campaigns / calls", error);
  }

  // The owner's plan decides which account the resources are in (own keys or the site's), banned or not.
  const owner = await db.selectFrom("users").select(["role", "plan_id", "plan_expires_at"]).where("id", "=", workspace.ownerId).executeTakeFirst();
  const entitlements = await getEntitlements(owner ?? null);
  const contexts = new Map<string, Awaited<ReturnType<typeof providerContext>>>();
  const ctxFor = async (provider: string) => {
    if (!contexts.has(provider)) contexts.set(provider, await providerContext(workspaceId, provider, entitlements, { timeoutMs: 15_000 }));
    return contexts.get(provider) ?? null;
  };
  const leftover = (l: Omit<LeftoverInput, "keySource">, keySource: "platform" | "byo") => result.leftovers.push({ ...l, at: new Date().toISOString(), workspaceId, workspaceName: workspace.name, keySource });

  // 3. Phone numbers.
  const numbers = await db.selectFrom("phone_numbers").selectAll().where("workspace_id", "=", workspaceId).where("status", "!=", "released").execute();
  for (const n of numbers) {
    const resolved = n.provider_number_id && isProvider(n.provider) ? await ctxFor(n.provider) : null;
    if (n.provider_number_id && isProvider(n.provider)) {
      if (!resolved) {
        leftover({ provider: n.provider, kind: "number", ref: n.provider_number_id, meta: {}, label: n.e164, error: "The provider is not configured." }, "platform");
        continue;
      }
      try {
        await resolved.provider.releaseNumber(resolved.ctx, n.provider_number_id);
      } catch (error) {
        if (!notFound(error)) {
          leftover({ provider: n.provider, kind: "number", ref: n.provider_number_id, meta: {}, label: n.e164, error: errText(error) }, resolved.ctx.keySource);
          continue;
        }
      }
    }
    await markNumberReleased(workspaceId, n.id, actor.type === "user" ? actor.id : null);
    result.numbers++;
  }

  // 4. Agents (ElevenLabs deletes their server tools with them, Retell their LLM and KB), in the
  //    account each was synced into.
  const agents = await db.selectFrom("agents").select("id").where("workspace_id", "=", workspaceId).where("provider_agent_id", "is not", null).execute();
  for (const r of agents) {
    const agent = await getAgent(workspaceId, r.id);
    if (!agent?.providerAgentId || !isProvider(agent.provider) || agent.provider === "simulated") continue;
    const resolved = await agentAccountContext(agent);
    if (!resolved) {
      leftover({ provider: agent.provider, kind: "agent", ref: agent.providerAgentId, meta: agent.providerMeta, label: agent.name, error: "The provider is not configured." }, agent.syncKeySource ?? "platform");
      continue;
    }
    try {
      await resolved.provider.deleteAgent(resolved.ctx, agent.providerAgentId, agent.providerMeta);
      result.agents++;
    } catch (error) {
      if (notFound(error)) result.agents++;
      else leftover({ provider: agent.provider, kind: "agent", ref: agent.providerAgentId, meta: agent.providerMeta, label: agent.name, error: errText(error) }, resolved.ctx.keySource);
    }
  }

  // 5. Knowledge-base documents.
  const docs = await db.selectFrom("kb_items").select(["id", "name", "provider", "provider_doc_id"]).where("workspace_id", "=", workspaceId).where("provider_doc_id", "is not", null).execute();
  for (const d of docs) {
    if (!d.provider || !d.provider_doc_id || !isProvider(d.provider) || d.provider === "simulated") continue;
    const resolved = await ctxFor(d.provider);
    if (!resolved) {
      leftover({ provider: d.provider, kind: "kb", ref: d.provider_doc_id, meta: {}, label: d.name, error: "The provider is not configured." }, "platform");
      continue;
    }
    try {
      await resolved.provider.deleteKbItem(resolved.ctx, d.provider_doc_id);
      result.kb++;
    } catch (error) {
      if (notFound(error)) result.kb++;
      else leftover({ provider: d.provider, kind: "kb", ref: d.provider_doc_id, meta: {}, label: d.name, error: errText(error) }, resolved.ctx.keySource);
    }
  }

  await auditSafe({ workspaceId, actor, action: "workspace.provider_cleanup", entityType: "workspace", entityId: workspaceId, data: { numbers: result.numbers, agents: result.agents, kb: result.kb, leftovers: result.leftovers.length } });
  await recordLeftovers(workspace, actor, result.leftovers);
  return result;
}

/**
 * Admin → Voice providers → Retry: removes leftovers again with the site's keys, or for a
 * workspace's own account with its keys while they are still saved. Own-account leftovers whose
 * keys are gone (deleted workspace, removed keys) can't be retried and are dropped when `dropByo`.
 * Returns what is left.
 */
export async function retryCleanupLeftovers(options: { dropByo?: boolean } = {}): Promise<{ removed: number; left: number }> {
  const settings = await getSettings();
  const list = await cleanupLeftovers();
  const keep: CleanupLeftover[] = [];
  let removed = 0;
  for (const l of list) {
    let resolved: ReturnType<typeof contextForKeys> = null;
    if (l.keySource === "byo") {
      const keys = getProvider(l.provider) ? await getWorkspaceKeys(l.workspaceId, l.provider) : null;
      resolved = keys ? contextForKeys(l.provider, keys, settings, "byo", 15_000) : null;
      if (!resolved) {
        if (!options.dropByo) keep.push(l);
        continue;
      }
    } else {
      resolved = getProvider(l.provider) ? contextForKeys(l.provider, platformKeys(settings, l.provider), settings, "platform", 15_000) : null;
    }
    if (!resolved) {
      keep.push(l);
      continue;
    }
    try {
      if (l.kind === "number") await resolved.provider.releaseNumber(resolved.ctx, l.ref);
      else if (l.kind === "agent") await resolved.provider.deleteAgent(resolved.ctx, l.ref, l.meta);
      else if (l.kind === "call") {
        if (!resolved.provider.deleteCall) throw new Error("This provider has no API to delete calls.");
        await resolved.provider.deleteCall(resolved.ctx, l.ref);
      } else await resolved.provider.deleteKbItem(resolved.ctx, l.ref);
      removed++;
    } catch (error) {
      if (notFound(error)) removed++;
      else keep.push({ ...l, at: new Date().toISOString(), error: errText(error) });
    }
  }
  await saveLeftovers(keep);
  await auditSafe({ workspaceId: null, actor: { type: "system", id: null }, action: "provider_cleanup.retried", entityType: "provider", data: { removed, left: keep.length } });
  return { removed, left: keep.length };
}
