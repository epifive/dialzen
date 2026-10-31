import "server-only";
import { absoluteUrl } from "@/lib/site";
import type { Settings } from "@/lib/settings";

/**
 * Google OAuth of the Google Calendar and Google Sheets tools (the site's OAuth client from
 * Admin → Voice providers → Google): consent URL, code exchange, and the account email from the
 * ID token. Routes: /api/oauth/google/start and /api/oauth/google/callback.
 */

export type GoogleService = "google_calendar" | "google_sheets";

export const GOOGLE_SCOPES: Record<GoogleService, string> = {
  google_calendar: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
  google_sheets: "openid email https://www.googleapis.com/auth/spreadsheets",
};

export const isGoogleService = (v: unknown): v is GoogleService => v === "google_calendar" || v === "google_sheets";

export function googleRedirectUri(settings: Settings): string {
  return absoluteUrl(settings, "/api/oauth/google/callback");
}

export function googleConsentUrl(settings: Settings, input: { service: GoogleService; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: settings.google_client_id,
    redirect_uri: googleRedirectUri(settings),
    response_type: "code",
    scope: GOOGLE_SCOPES[input.service],
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

/** The email claim of an ID token received straight from Google's token endpoint (over TLS). */
export function idTokenEmail(idToken: string): string {
  const part = idToken.split(".")[1];
  if (!part) return "";
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email.slice(0, 190) : "";
  } catch {
    return "";
  }
}

export async function exchangeGoogleCode(settings: Settings, code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<{ refreshToken: string; email: string } | { error: string }> {
  const base = process.env.DIALZEN_TEST_GOOGLE_API?.trim();
  const url = base ? `${base.replace(/\/+$/, "")}/token` : "https://oauth2.googleapis.com/token";
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ code, client_id: settings.google_client_id, client_secret: settings.google_client_secret, redirect_uri: googleRedirectUri(settings), grant_type: "authorization_code", code_verifier: verifier }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { error: "Google could not be reached." };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { error: typeof body.error_description === "string" ? body.error_description : "Google refused the connection." };
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!refreshToken) return { error: "Google did not grant offline access. Remove this site's access in your Google account settings and connect again." };
  return { refreshToken, email: typeof body.id_token === "string" ? idTokenEmail(body.id_token) : "" };
}
