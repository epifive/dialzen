import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auditSafe } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { OAUTH_COOKIE, openOAuthCookie, verifyOAuthState } from "@/lib/oauth-state";
import { getSettings } from "@/lib/settings";
import { exchangeGoogleCode } from "@/lib/tools/google-oauth";
import { setGoogleTokens } from "@/lib/tools/store";
import { hasWorkspaceRole } from "@/lib/workspaces";

/** Google's redirect after consent: stores the refresh token in the tool's encrypted settings and returns to the agent's tools. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jar = await cookies();
  const sealed = await openOAuthCookie(jar.get(OAUTH_COOKIE)?.value);
  const carry = sealed?.carry ?? {};
  const wid = /^\d+$/.test(carry.wid ?? "") ? carry.wid : "";
  const agentId = /^\d+$/.test(carry.agentId ?? "") ? carry.agentId : "";
  const done = (q: string) => {
    const res = NextResponse.redirect(new URL(wid ? `/dashboard/w/${wid}/agents${agentId ? `/${agentId}?tab=tools&${q}` : `?${q}`}` : `/dashboard?${q}`, request.url));
    res.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/api/oauth/google", maxAge: 0 });
    return res;
  };
  const user = await getCurrentUser();
  if (!user || !sealed) return done("google=error&reason=session");
  const state = await verifyOAuthState(url.searchParams.get("state") ?? "", sealed.nonce, user.id);
  if (!state || String(state.workspaceId) !== wid || state.service !== carry.service) return done("google=error&reason=state");
  if (url.searchParams.get("error")) return done("google=error&reason=denied");
  if (!(await hasWorkspaceRole(state.workspaceId, user.id, "editor"))) return done("google=error&reason=role");
  const code = url.searchParams.get("code") ?? "";
  if (!code) return done("google=error&reason=code");
  const settings = await getSettings();
  const result = await exchangeGoogleCode(settings, code, sealed.codeVerifier);
  if ("error" in result) return done(`google=error&reason=exchange&message=${encodeURIComponent(result.error.slice(0, 200))}`);
  const ok = await setGoogleTokens(state.workspaceId, Number(carry.toolId), { refreshToken: result.refreshToken, accountEmail: result.email });
  if (!ok) return done("google=error&reason=tool");
  await auditSafe({ workspaceId: state.workspaceId, actor: { type: "user", id: user.id }, action: "tool.google_connected", entityType: "tool", entityId: carry.toolId, data: { service: state.service, account: result.email } });
  return done("google=connected");
}
