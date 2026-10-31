"use server";

import { auditSafe } from "@/lib/audit";
import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { contextForKeys, deleteWorkspaceKeys, getWorkspaceKeys, markWorkspaceKeysChecked, saveWorkspaceKeys } from "@/lib/providers";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { moveAgentsOffOwnKeys, removeRemoteAgentsBeforeKeyChange, resyncAfterKeyChange, syncAgentNow } from "@/lib/voice/sync";
import "@/lib/voice/index";
import type { ProviderId, ProviderKeys } from "@/voice/types";
import type { FormState } from "../types";
import { str } from "./helpers";

/**
 * The workspace's own voice provider keys (Settings → Voice provider keys; plans with "Own
 * provider keys"). Saving tests the keys first; when the API key changes, the workspace's agents
 * on that provider are deleted from the old account and synced into the new one. Removing keys the
 * plan no longer uses moves the agents still in that account too (a plan change alone is picked
 * up by the "voice-sync" job, src/lib/voice/sync.ts).
 */

const BYO_PROVIDERS = ["elevenlabs", "retell"] as const;
type ByoProvider = (typeof BYO_PROVIDERS)[number];
const providerOf = (v: FormDataEntryValue | null): ByoProvider | null => (BYO_PROVIDERS as readonly string[]).includes(str(v)) ? (str(v) as ByoProvider) : null;

async function guard(formData: FormData) {
  const g = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!g.ok) return { error: g.error } as const;
  const t = await getT();
  if (!g.entitlements.allowByoKeys) return { error: t("dash.byo.err.plan") } as const;
  const provider = providerOf(formData.get("provider"));
  if (!provider) return { error: t("dash.byo.err.provider") } as const;
  if (!rateLimit(`dz-byo:${g.user.id}`, 20, 10 * 60_000)) return { error: t("dash.byo.err.rate") } as const;
  return { ...g, t, provider } as const;
}

async function testKeys(provider: ProviderId, keys: ProviderKeys): Promise<{ ok: true; account: string } | { ok: false; error: string }> {
  const resolved = contextForKeys(provider, keys, await getSettings());
  if (!resolved) return { ok: false, error: "No API key." };
  const res = await resolved.provider.testConnection(resolved.ctx);
  return res.ok ? { ok: true, account: res.account } : { ok: false, error: res.error.message };
}

/** Saves (or replaces) the keys of one provider after a successful connection test. Empty fields keep the saved values. */
export async function saveProviderKeysAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const g = await guard(formData);
  if ("error" in g) return { error: g.error };
  const { t, provider, workspace, user } = g;
  const current = await getWorkspaceKeys(workspace.id, provider);
  const apiKey = str(formData.get("api_key")).trim().slice(0, 500);
  const secret = str(formData.get("webhook_secret")).trim().slice(0, 500);
  if (!apiKey && !current) return { error: t("dash.byo.err.apiKey") };
  if (/\s/.test(apiKey) || /\s/.test(secret)) return { error: t("dash.byo.err.format") };
  const keys: ProviderKeys = {
    apiKey: apiKey || current!.apiKey,
    // Retell signs its webhooks with the API key.
    webhookSecret: provider === "retell" ? "" : secret || current?.webhookSecret || "",
    extra: current?.extra ?? {},
  };
  const test = await testKeys(provider, keys);
  if (!test.ok) return { error: t("dash.byo.err.test", { error: test.error }) };
  const keyChanged = !current || current.apiKey !== keys.apiKey;
  if (keyChanged) await removeRemoteAgentsBeforeKeyChange(workspace.id, provider);
  await saveWorkspaceKeys(workspace.id, provider, keys, user.id, test.account);
  await markWorkspaceKeysChecked(workspace.id, provider, null);
  if (!keyChanged) return { success: t("dash.byo.saved") };
  const sync = await resyncAfterKeyChange(workspace.id, provider);
  return { success: sync.synced + sync.failed + sync.pending ? t("dash.byo.savedResync", { synced: sync.synced, failed: sync.failed + sync.pending }) : t("dash.byo.saved") };
}

/** Tests the saved keys of one provider. */
export async function testProviderKeysAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const g = await guard(formData);
  if ("error" in g) return { error: g.error };
  const { t, provider, workspace } = g;
  const keys = await getWorkspaceKeys(workspace.id, provider);
  if (!keys) return { error: t("dash.byo.err.none") };
  const test = await testKeys(provider, keys);
  await markWorkspaceKeysChecked(workspace.id, provider, test.ok ? null : test.error);
  return test.ok ? { success: t("dash.byo.testOk", { account: test.account }) } : { error: t("dash.byo.err.test", { error: test.error }) };
}

/** Removes the keys of one provider: the workspace's agents on it move back to the site's keys. */
export async function deleteProviderKeysAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const g = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!g.ok) return { error: g.error };
  const t = await getT();
  const provider = providerOf(formData.get("provider"));
  if (!provider) return { error: t("dash.byo.err.provider") };
  const saved = await getWorkspaceKeys(g.workspace.id, provider);
  if (!g.entitlements.allowByoKeys || !saved) {
    // Not in use (plan without own keys, unreadable or already gone). Agents still in the own
    // account are deleted from it while its keys are here, then synced into the site's account.
    const moved = saved ? await moveAgentsOffOwnKeys(g.workspace.id, provider) : [];
    await deleteWorkspaceKeys(g.workspace.id, provider, g.user.id);
    let failed = 0;
    for (const id of moved.slice(0, 10)) if (!(await syncAgentNow(id, { workspaceId: g.workspace.id })).ok) failed++;
    if (failed) await auditSafe({ workspaceId: g.workspace.id, actor: { type: "user", id: g.user.id }, action: "provider_keys.resync_failed", entityType: "provider", entityId: provider, data: { synced: Math.min(moved.length, 10) - failed, failed, pending: Math.max(0, moved.length - 10) } });
    return { success: t("dash.byo.removed") };
  }
  await removeRemoteAgentsBeforeKeyChange(g.workspace.id, provider);
  await deleteWorkspaceKeys(g.workspace.id, provider, g.user.id);
  const sync = await resyncAfterKeyChange(g.workspace.id, provider);
  if (sync.failed) await auditSafe({ workspaceId: g.workspace.id, actor: { type: "user", id: g.user.id }, action: "provider_keys.resync_failed", entityType: "provider", entityId: provider, data: sync });
  return { success: t("dash.byo.removed") };
}
