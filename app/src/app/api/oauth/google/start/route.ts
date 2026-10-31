import { NextResponse } from "next/server";
import { guardWorkspace } from "@/lib/dashboard";
import { createOAuthState, createPkcePair, OAUTH_COOKIE, sealOAuthCookie } from "@/lib/oauth-state";
import { getSettings } from "@/lib/settings";
import { googleConsentUrl, isGoogleService } from "@/lib/tools/google-oauth";
import { loadToolForRuntime } from "@/lib/tools/store";

/**
 * Connect a Google account to a Google Calendar / Sheets tool:
 * GET /api/oauth/google/start?wid=<id>&tool=<toolId>&service=google_calendar|google_sheets[&agent=<id>]
 * → Google's consent screen → /api/oauth/google/callback.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const wid = url.searchParams.get("wid") ?? "";
  const service = url.searchParams.get("service");
  const toolId = Number(url.searchParams.get("tool"));
  const agentId = url.searchParams.get("agent") ?? "";
  const back = (q: string) => NextResponse.redirect(new URL(`/dashboard/w/${/^\d+$/.test(wid) ? wid : "0"}/agents${/^\d+$/.test(agentId) ? `/${agentId}?tab=tools&${q}` : `?${q}`}`, request.url));
  const guard = await guardWorkspace(wid, { capability: "agents.manage" });
  if (!guard.ok) return Response.json({ error: guard.error }, { status: 403 });
  if (!isGoogleService(service)) return back("google=error&reason=service");
  const tool = await loadToolForRuntime(toolId);
  if (!tool || tool.workspaceId !== guard.workspace.id || tool.kind !== service) return back("google=error&reason=tool");
  const settings = await getSettings();
  if (!settings.google_client_id || !settings.google_client_secret) return back("google=error&reason=not_configured");
  const pkce = createPkcePair();
  const { state, nonce } = await createOAuthState({ userId: guard.user.id, workspaceId: guard.workspace.id, service });
  const cookie = await sealOAuthCookie({ nonce, codeVerifier: pkce.verifier, carry: { wid: String(guard.workspace.id), toolId: String(tool.id), agentId: /^\d+$/.test(agentId) ? agentId : "", service } });
  const res = NextResponse.redirect(googleConsentUrl(settings, { service, state, challenge: pkce.challenge }));
  res.cookies.set(OAUTH_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/api/oauth/google", maxAge: 15 * 60 });
  return res;
}
