import "server-only";
import crypto from "node:crypto";
import { toAgentRecord, type AgentRecord } from "./agents";
import { sign, verifySignature } from "./crypto";
import { getDb } from "./db";
import { includedSecondsLeft } from "./usage";
import { getWallet } from "./wallet";
import { getWorkspace, getWorkspaceEntitlements, type WorkspaceRecord } from "./workspaces";
import type { Entitlements } from "./plans";

/**
 * The embeddable web voice widget (<script src="/dz-widget.js" data-agent="KEY">):
 * - the public agent key: "<agent id>.<HMAC>" signed with the app secret, so ids can't be
 *   enumerated and no extra column is needed (changing APP_SECRET changes every key)
 * - which sites may embed it: the agent's allowed domains, checked against the Origin header
 * - whether a visitor may start a call now: plan minutes or call credits left
 * - a short-lived signed token that ties a widget visitor to the call they started (text chat
 *   of the simulated provider)
 */

const KEY_PURPOSE = "widget-key";
const CALL_PURPOSE = "widget-call";
/** Widget call tokens live as long as the longest call. */
const CALL_TOKEN_TTL_MS = 65 * 60_000;

export async function widgetKey(agentId: number): Promise<string> {
  return `${agentId}.${(await sign(`agent:${agentId}`, KEY_PURPOSE)).slice(0, 22)}`;
}

/** The agent id of a valid key, else null. */
export async function parseWidgetKey(key: string): Promise<number | null> {
  const m = /^(\d{1,10})\.([A-Za-z0-9_-]{22})$/.exec(key);
  if (!m) return null;
  const id = Number(m[1]);
  const expected = Buffer.from((await widgetKey(id)).split(".")[1]);
  const given = Buffer.from(m[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? id : null;
}

/** "https://Shop.Example.com:8443/x" → { host: "shop.example.com", port: "8443" }; null for anything else (incl. "null"). */
export function parseOrigin(origin: string | null | undefined): { host: string; port: string } | null {
  if (!origin || origin === "null") return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { host: u.hostname.toLowerCase(), port: u.port };
  } catch {
    return null;
  }
}

/**
 * Whether a page at `origin` may use the widget. Entries (normalizeWidget()):
 * - "example.com"   → example.com and www.example.com, any port
 * - "*.example.com" → every subdomain of example.com (not example.com itself)
 * - "localhost:3000" / "example.com:8443" → that host and port only
 * An empty list allows nowhere.
 */
export function originAllowed(origin: string | null | undefined, allowedDomains: readonly string[]): boolean {
  const o = parseOrigin(origin);
  if (!o) return false;
  for (const raw of allowedDomains) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    const [pattern, port = ""] = entry.split(":");
    if (port && port !== o.port) continue;
    if (pattern.startsWith("*.")) {
      if (o.host.endsWith(pattern.slice(1)) && o.host.length > pattern.length - 1) return true;
    } else if (o.host === pattern || o.host === `www.${pattern}`) {
      return true;
    }
  }
  return false;
}

/** CORS headers for a widget response (only an allowed origin is echoed). */
export function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  const h: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowed) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

export type CallFundsCheck = { ok: true; source: "included" | "wallet" } | { ok: false; reason: "no_minutes" };

/**
 * A visitor may start a call when the owner still has plan minutes this month or the workspace
 * has at least one minute of call credits (balance minus amounts held for live calls).
 */
export async function canFundCall(workspace: { id: number; ownerId: number }, entitlements: Pick<Entitlements, "includedMinutesMonthly">, pricePerMinMicros: number): Promise<CallFundsCheck> {
  if ((await includedSecondsLeft(workspace.ownerId, entitlements)) >= 30) return { ok: true, source: "included" };
  if (pricePerMinMicros <= 0) return { ok: true, source: "wallet" };
  const wallet = await getWallet(workspace.id);
  return wallet.balanceMicros - wallet.reservedMicros >= pricePerMinMicros ? { ok: true, source: "wallet" } : { ok: false, reason: "no_minutes" };
}

/** Token returned with a widget call: proves the visitor started call `callId` (chat turns, hang up). */
export async function widgetCallToken(callId: number, agentId: number, nowMs = Date.now()): Promise<string> {
  const body = `${callId}.${agentId}.${nowMs + CALL_TOKEN_TTL_MS}`;
  return `${body}.${await sign(body, CALL_PURPOSE)}`;
}

export async function readWidgetCallToken(token: string, agentId: number, nowMs = Date.now()): Promise<number | null> {
  const parts = token.split(".");
  if (parts.length !== 4 || !parts.slice(0, 3).every((p) => /^\d{1,15}$/.test(p))) return null;
  const [call, agent, expires, signature] = parts;
  if (Number(agent) !== agentId || Number(expires) < nowMs) return null;
  return (await verifySignature(parts.slice(0, 3).join("."), signature, CALL_PURPOSE)) ? Number(call) : null;
}

// ── Request context of the public widget endpoints ──

export type WidgetContext =
  | { ok: true; agent: AgentRecord; workspace: WorkspaceRecord; entitlements: Entitlements; origin: string; allowed: true }
  | { ok: false; status: 403 | 404; error: "not_found" | "disabled" | "origin" | "suspended"; origin: string | null; allowed: boolean };

/**
 * The page origin of a widget request: the Origin header, or (same-origin GETs send none) the
 * Referer's origin.
 */
export function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") return origin;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Resolves a widget key to its agent and workspace, and checks that the widget is on and the
 * page's site is allowed. A workspace whose owner is banned (suspended) answers 403 "suspended",
 * like the REST API and test calls; the widget then shows a neutral "unavailable" message.
 */
export async function widgetContext(key: string, request: Request): Promise<WidgetContext> {
  const origin = requestOrigin(request);
  const agentId = await parseWidgetKey(key);
  if (!agentId) return { ok: false, status: 404, error: "not_found", origin, allowed: false };
  const db = await getDb();
  const row = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
  if (!row) return { ok: false, status: 404, error: "not_found", origin, allowed: false };
  const agent = toAgentRecord(row);
  const allowed = originAllowed(origin, agent.settings.widget.allowedDomains);
  if (!agent.settings.widget.enabled || agent.status === "paused") return { ok: false, status: 404, error: "disabled", origin, allowed };
  if (!allowed || !origin) return { ok: false, status: 403, error: "origin", origin, allowed: false };
  const workspace = await getWorkspace(agent.workspaceId);
  if (!workspace) return { ok: false, status: 404, error: "not_found", origin, allowed };
  const owner = await db.selectFrom("users").select("status").where("id", "=", workspace.ownerId).executeTakeFirst();
  if (!owner || owner.status !== "active") return { ok: false, status: 403, error: "suspended", origin, allowed };
  const entitlements = await getWorkspaceEntitlements(workspace);
  if (entitlements.suspended) return { ok: false, status: 403, error: "suspended", origin, allowed };
  return { ok: true, agent, workspace, entitlements, origin, allowed: true };
}
