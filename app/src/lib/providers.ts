import "server-only";
import crypto from "node:crypto";
import { auditSafe } from "./audit";
import { isDemoMode } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb, now } from "./db";
import type { Entitlements } from "./plans";
import { getSettings, type Settings } from "./settings";
import { absoluteUrl } from "./site";
import { asObj, isProvider, str, toMicros } from "@/voice/normalize";
import type { ProviderContext, ProviderId, ProviderKeys, VoiceProvider } from "@/voice/types";

/**
 * The voice provider registry and how an adapter gets its keys.
 *
 * Adapters (src/lib/voice/<provider>.ts, added with the provider phase) call registerProvider()
 * when their module is imported; the rest of the app asks getProvider(id) and builds a
 * ProviderContext with providerContext(): the workspace's own keys when it has some and its plan
 * allows them (allow_byo_keys), else the admin's master keys from settings. Tests swap adapters
 * with setProviderOverride().
 *
 * Prices: workspaces pay the admin's sell price per minute of the provider (voice_price_<id>),
 * or the BYO platform fee (voice_price_byo) when the call used their own key.
 */

const registry = new Map<ProviderId, VoiceProvider>();
const overrides = new Map<ProviderId, VoiceProvider>();

export function registerProvider(provider: VoiceProvider): void {
  registry.set(provider.id, provider);
}

/** Test hook: replace (or with null restore) the adapter of a provider. */
export function setProviderOverride(id: ProviderId, provider: VoiceProvider | null): void {
  if (provider) overrides.set(id, provider);
  else overrides.delete(id);
}

export function getProvider(id: string): VoiceProvider | null {
  if (!isProvider(id)) return null;
  return overrides.get(id) ?? registry.get(id) ?? null;
}

export function registeredProviders(): ProviderId[] {
  return [...new Set([...registry.keys(), ...overrides.keys()])];
}

/** The Simulated provider is usable: always in demo mode, otherwise only when the admin turned it on (testing). */
export function simulatedAllowed(settings: Settings): boolean {
  return isDemoMode() || settings.voice_simulated;
}

/** The admin's master keys of a provider ("" apiKey = not configured). */
export function platformKeys(settings: Settings, id: ProviderId): ProviderKeys {
  switch (id) {
    case "elevenlabs":
      return { apiKey: settings.elevenlabs_api_key, webhookSecret: settings.elevenlabs_webhook_secret, extra: {} };
    case "retell":
      // Retell signs webhooks with the API key.
      return { apiKey: settings.retell_api_key, webhookSecret: settings.retell_api_key, extra: {} };
    case "simulated":
      return { apiKey: "simulated", webhookSecret: "simulated", extra: {} };
  }
}

/** Providers new agents can use on this site (configured keys, or the simulated one when allowed). */
export async function availableProviders(): Promise<ProviderId[]> {
  const settings = await getSettings();
  const out: ProviderId[] = [];
  if (settings.elevenlabs_api_key) out.push("elevenlabs");
  if (settings.retell_api_key) out.push("retell");
  if (simulatedAllowed(settings)) out.push("simulated");
  return out;
}

// ── Workspace keys (BYO) ──

const KEY_PURPOSE = "provider-keys";

export async function getWorkspaceKeys(workspaceId: number, id: ProviderId): Promise<ProviderKeys | null> {
  const db = await getDb();
  const row = await db.selectFrom("provider_accounts").select(["credentials", "status"]).where("workspace_id", "=", workspaceId).where("provider", "=", id).executeTakeFirst();
  if (!row || row.status === "disabled") return null;
  try {
    const o = asObj(JSON.parse(await decryptSecret(row.credentials, KEY_PURPOSE)));
    const extra = asObj(o.extra);
    const keys: ProviderKeys = { apiKey: str(o.apiKey, "", 500), webhookSecret: str(o.webhookSecret, "", 500), extra: Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, str(v, "", 500)])) };
    if (id === "retell" && !keys.webhookSecret) keys.webhookSecret = keys.apiKey;
    return keys.apiKey ? keys : null;
  } catch {
    // Unreadable (APP_SECRET changed): treat as missing.
    return null;
  }
}

/** Saves (or replaces) a workspace's own keys of a provider, encrypted. */
export async function saveWorkspaceKeys(workspaceId: number, id: ProviderId, keys: ProviderKeys, userId: number | null, label = ""): Promise<void> {
  const db = await getDb();
  const ts = now();
  const credentials = await encryptSecret(JSON.stringify(keys), KEY_PURPOSE);
  const exists = await db.selectFrom("provider_accounts").select("id").where("workspace_id", "=", workspaceId).where("provider", "=", id).executeTakeFirst();
  if (exists) {
    await db.updateTable("provider_accounts").set({ credentials, label: label.slice(0, 120), status: "active", last_error: null, updated_at: ts }).where("id", "=", exists.id).execute();
  } else {
    await db
      .insertInto("provider_accounts")
      .values({ workspace_id: workspaceId, provider: id, label: label.slice(0, 120), credentials, status: "active", last_checked_at: null, last_error: null, created_by: userId, created_at: ts, updated_at: ts })
      .execute();
  }
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "provider_keys.updated", entityType: "provider", entityId: id });
}

export async function deleteWorkspaceKeys(workspaceId: number, id: ProviderId, userId: number | null): Promise<void> {
  const db = await getDb();
  await db.deleteFrom("provider_accounts").where("workspace_id", "=", workspaceId).where("provider", "=", id).execute();
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "provider_keys.removed", entityType: "provider", entityId: id });
}

/** What the settings page may show about a workspace's own keys (never the secrets themselves). */
export interface WorkspaceKeysSummary {
  provider: ProviderId;
  /** Last 4 characters of the API key. */
  apiKeyLast4: string;
  hasWebhookSecret: boolean;
  status: "active" | "error" | "disabled";
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export async function workspaceKeysSummary(workspaceId: number): Promise<WorkspaceKeysSummary[]> {
  const db = await getDb();
  const rows = await db.selectFrom("provider_accounts").selectAll().where("workspace_id", "=", workspaceId).orderBy("provider").execute();
  const out: WorkspaceKeysSummary[] = [];
  for (const row of rows) {
    if (!isProvider(row.provider) || row.provider === "simulated") continue;
    let apiKey = "";
    let webhookSecret = "";
    try {
      const o = asObj(JSON.parse(await decryptSecret(row.credentials, KEY_PURPOSE)));
      apiKey = str(o.apiKey, "", 500);
      webhookSecret = str(o.webhookSecret, "", 500);
    } catch {
      // Unreadable: shown as saved without details.
    }
    out.push({ provider: row.provider, apiKeyLast4: apiKey.slice(-4), hasWebhookSecret: Boolean(webhookSecret), status: row.status, lastCheckedAt: row.last_checked_at, lastError: row.last_error, updatedAt: row.updated_at });
  }
  return out;
}

/** Stores the result of a connection test of a workspace's own keys. */
export async function markWorkspaceKeysChecked(workspaceId: number, id: ProviderId, error: string | null): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("provider_accounts")
    .set({ status: error ? "error" : "active", last_error: error ? error.slice(0, 1000) : null, last_checked_at: now() })
    .where("workspace_id", "=", workspaceId)
    .where("provider", "=", id)
    .execute();
}

/** A provider context for explicit keys (testing a workspace's keys before they are saved). */
export function contextForKeys(id: ProviderId, keys: ProviderKeys, settings: Settings, keySource: "platform" | "byo" = "byo", timeoutMs = 10_000): ResolvedContext | null {
  const provider = getProvider(id);
  if (!provider || !keys.apiKey) return null;
  return {
    provider,
    ctx: {
      provider: id,
      keys,
      keySource,
      fetch,
      now: Date.now,
      baseUrl: absoluteUrl(settings).replace(/\/+$/, ""),
      apiBase: process.env[`DIALZEN_TEST_${id.toUpperCase()}_API`]?.trim() ?? "",
      timeoutMs,
    },
  };
}

// ── Contexts and prices ──

export interface ResolvedContext {
  ctx: ProviderContext;
  provider: VoiceProvider;
}

/**
 * The adapter and context for a workspace's call or sync. null when the provider has no adapter
 * or no usable keys (not configured, simulated not allowed). `entitlements` decide whether the
 * workspace's own keys may be used.
 */
export async function providerContext(
  workspaceId: number,
  id: string,
  entitlements: Pick<Entitlements, "allowByoKeys"> | null,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ResolvedContext | null> {
  const provider = getProvider(id);
  if (!provider || !isProvider(id)) return null;
  const settings = await getSettings();
  if (id === "simulated" && !simulatedAllowed(settings)) return null;
  const byo = entitlements?.allowByoKeys && id !== "simulated" ? await getWorkspaceKeys(workspaceId, id) : null;
  const resolved = contextForKeys(id, byo ?? platformKeys(settings, id), settings, byo ? "byo" : "platform", options.timeoutMs ?? 15_000);
  if (resolved && options.fetchImpl) resolved.ctx.fetch = options.fetchImpl;
  return resolved;
}

// ── Provider accounts ──

export type KeySource = "platform" | "byo";

/**
 * A short, one-way fingerprint of the provider account a set of keys points at (a hash of the API
 * key; never the key itself). Stored with synced agents and documents to notice that the account
 * in use changed.
 */
export function accountFingerprint(provider: ProviderId, keys: Pick<ProviderKeys, "apiKey">): string {
  if (provider === "simulated") return "simulated";
  return crypto.createHash("sha256").update(`dialzen-account:${provider}:${keys.apiKey}`).digest("hex").slice(0, 24);
}

/** The account of a resolved context: its key source and fingerprint. */
export function contextAccount(ctx: Pick<ProviderContext, "provider" | "keys" | "keySource">): { keySource: KeySource; account: string } {
  return { keySource: ctx.keySource, account: accountFingerprint(ctx.provider, ctx.keys) };
}

/**
 * The context of one key source of a workspace whatever its plan allows now: "byo" = the
 * workspace's saved keys (null when there are none any more), "platform" = the site's keys. Used
 * to reach resources (agents, calls, recordings) in the account they were created in.
 */
export async function keySourceContext(workspaceId: number, id: string, keySource: KeySource, options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<ResolvedContext | null> {
  if (!getProvider(id) || !isProvider(id)) return null;
  const settings = await getSettings();
  if (id === "simulated") {
    if (!simulatedAllowed(settings)) return null;
  } else if (keySource === "byo") {
    const keys = await getWorkspaceKeys(workspaceId, id);
    const resolved = keys ? contextForKeys(id, keys, settings, "byo", options.timeoutMs ?? 15_000) : null;
    if (resolved && options.fetchImpl) resolved.ctx.fetch = options.fetchImpl;
    return resolved;
  }
  const resolved = contextForKeys(id, platformKeys(settings, id), settings, "platform", options.timeoutMs ?? 15_000);
  if (resolved && options.fetchImpl) resolved.ctx.fetch = options.fetchImpl;
  return resolved;
}

/**
 * The context of the provider account a call was made in: the site's keys, or for a call on the
 * workspace's own keys (calls.key_source "byo") those keys while they are still saved, whatever
 * the plan allows now. null when that account can't be reached any more.
 */
export function callAccountContext(call: { workspaceId: number; provider: string; keySource: KeySource }, timeoutMs = 15_000): Promise<ResolvedContext | null> {
  return keySourceContext(call.workspaceId, call.provider, call.keySource, { timeoutMs });
}

/** What a workspace pays per minute (micros) for a call of this provider with this key source. */
export function sellPricePerMinMicros(settings: Settings, id: ProviderId, keySource: "platform" | "byo"): number {
  if (keySource === "byo") return Math.max(0, toMicros(settings.voice_price_byo));
  const price = id === "elevenlabs" ? settings.voice_price_elevenlabs : id === "retell" ? settings.voice_price_retell : settings.voice_price_simulated;
  return Math.max(0, toMicros(price));
}

/** Webhook URL of a provider on this site (ElevenLabs: one per provider account; Retell: set per agent). */
export async function webhookUrl(id: ProviderId): Promise<string> {
  return absoluteUrl(await getSettings(), `/api/voice/webhook/${id}`);
}
