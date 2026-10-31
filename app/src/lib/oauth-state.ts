import "server-only";
import crypto from "node:crypto";
import { decryptSecret, encryptSecret, sign, verifySignature } from "@/lib/crypto";

/**
 * OAuth "state" and PKCE for connect flows of third-party accounts, e.g. the Google account of a
 * Google Calendar or Google Sheets tool (start → the provider's consent screen → callback):
 *
 *   state = "<user>.<workspace>.<service>.<expires ms>.<nonce>.<HMAC>"
 *
 * signed with the app secret, bound to the signed-in user and workspace, valid for 15 minutes,
 * and its nonce must also be in the OAUTH_COOKIE (httpOnly, SameSite=Lax) set when the flow
 * started. The cookie also carries the PKCE verifier and any values the flow wants back at the
 * callback (`carry`), encrypted, so nothing has to be stored in the database. That double check
 * stops cross-site requests from attaching someone else's account to a workspace.
 */

export const OAUTH_COOKIE = "dz_oauth";
export const OAUTH_STATE_TTL_MS = 15 * 60_000;
const PURPOSE = "oauth-state";
const COOKIE_PURPOSE = "oauth-cookie";
const SERVICE_RE = /^[a-z][a-z_]{1,39}$/;

export interface OAuthState {
  userId: number;
  workspaceId: number;
  /** What is being connected ("google_calendar", "google_sheets"…): lower-case letters and _. */
  service: string;
  nonce: string;
}

/** RFC 7636 verifier (43–128 chars) and its S256 challenge. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function createOAuthState(input: { userId: number; workspaceId: number; service: string }, nowMs = Date.now()): Promise<{ state: string; nonce: string }> {
  const nonce = crypto.randomBytes(16).toString("base64url");
  if (!SERVICE_RE.test(input.service)) throw new Error("Invalid OAuth service name.");
  const body = `${input.userId}.${input.workspaceId}.${input.service}.${nowMs + OAUTH_STATE_TTL_MS}.${nonce}`;
  return { state: `${body}.${await sign(body, PURPOSE)}`, nonce };
}

/** The state's content when the signature, expiry, user and cookie nonce all match; null otherwise. */
export async function verifyOAuthState(state: string, cookieNonce: string | undefined, userId: number, nowMs = Date.now()): Promise<OAuthState | null> {
  const parts = state.split(".");
  if (parts.length !== 6 || !cookieNonce) return null;
  const [user, workspace, service, expires, nonce, signature] = parts;
  if (!(await verifySignature(parts.slice(0, 5).join("."), signature, PURPOSE))) return null;
  if (!/^\d+$/.test(user) || !/^\d+$/.test(workspace) || !/^\d+$/.test(expires) || !SERVICE_RE.test(service)) return null;
  if (Number(expires) < nowMs || Number(user) !== userId) return null;
  const a = Buffer.from(nonce);
  const b = Buffer.from(cookieNonce);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { userId: Number(user), workspaceId: Number(workspace), service, nonce };
}

/** What the OAUTH_COOKIE holds between start and callback. */
export interface OAuthCookie {
  nonce: string;
  codeVerifier: string;
  carry: Record<string, string>;
}

/** Encrypted cookie value (fits the 4 KB cookie limit for normal `carry` values). */
export async function sealOAuthCookie(value: OAuthCookie): Promise<string> {
  return encryptSecret(JSON.stringify(value), COOKIE_PURPOSE);
}

export async function openOAuthCookie(raw: string | undefined): Promise<OAuthCookie | null> {
  if (!raw) return null;
  try {
    const v = JSON.parse(await decryptSecret(raw, COOKIE_PURPOSE)) as Partial<OAuthCookie>;
    if (typeof v.nonce !== "string" || typeof v.codeVerifier !== "string") return null;
    const carry = v.carry && typeof v.carry === "object" ? Object.fromEntries(Object.entries(v.carry).filter(([, x]) => typeof x === "string")) : {};
    return { nonce: v.nonce, codeVerifier: v.codeVerifier, carry: carry as Record<string, string> };
  } catch {
    return null;
  }
}
