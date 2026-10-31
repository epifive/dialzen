import { NextResponse } from "next/server";
import { providerContext, sellPricePerMinMicros } from "@/lib/providers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { startWebCall } from "@/lib/voice-bridge";
import { canFundCall, corsHeaders, widgetCallToken, widgetContext } from "@/lib/widget";

/**
 * Starts a widget call (POST /api/widget/<key>/token) for a visitor of an allowed site:
 * - the page's Origin must be one of the agent's allowed domains
 * - per-IP and per-agent rate limits
 * - the workspace must have plan minutes or call credits left (minutes are charged to it when
 *   the provider reports the call)
 * - a suspended (banned) owner's widget answers 403 {"error":"suspended"}
 * Answers with what the browser SDK needs: a signed URL / access token, or for the simulated
 * provider the greeting and a token for the text chat.
 */
export const dynamic = "force-dynamic";

/** Widget calls a visitor (IP) may start per 10 minutes, and per agent per hour. */
const WIDGET_IP_LIMIT = 5;
const WIDGET_AGENT_LIMIT = 60;

export async function OPTIONS(request: Request, { params }: { params: Promise<{ agentKey: string }> }): Promise<Response> {
  const ctx = await widgetContext((await params).agentKey, request);
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin"), ctx.allowed) });
}

export async function POST(request: Request, { params }: { params: Promise<{ agentKey: string }> }): Promise<Response> {
  const ctx = await widgetContext((await params).agentKey, request);
  const headers = corsHeaders(request.headers.get("origin"), ctx.allowed);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers });
  const ip = await clientIp();
  if (!rateLimit(`dz-widget-ip:${ctx.agent.id}:${ip}`, WIDGET_IP_LIMIT, 10 * 60_000) || !rateLimit(`dz-widget-agent:${ctx.agent.id}`, WIDGET_AGENT_LIMIT, 3600_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "600" } });
  }
  const settings = await getSettings();
  const resolved = await providerContext(ctx.workspace.id, ctx.agent.provider, ctx.entitlements, { timeoutMs: 8000 });
  const price = sellPricePerMinMicros(settings, ctx.agent.provider, resolved?.ctx.keySource ?? "platform");
  const funds = await canFundCall(ctx.workspace, ctx.entitlements, price);
  if (!funds.ok) return NextResponse.json({ error: "no_minutes" }, { status: 402, headers });
  const result = await startWebCall({ workspace: ctx.workspace, agent: ctx.agent, entitlements: ctx.entitlements, source: "widget", ip, origin: ctx.origin });
  // Suspended owner (banned meanwhile): 403 like every other endpoint.
  if (!result.ok && result.error === "suspended") return NextResponse.json({ error: "suspended" }, { status: 403, headers });
  if (!result.ok) {
    const status = result.error === "concurrency" ? 429 : result.error === "funds" ? 402 : 503;
    return NextResponse.json({ error: result.error === "concurrency" ? "busy" : result.error === "funds" ? "no_minutes" : "unavailable" }, { status, headers });
  }
  return NextResponse.json(
    {
      callId: result.callId,
      sdk: result.session.sdk,
      token: result.session.token,
      url: result.session.url,
      expiresAt: result.session.expiresAt,
      dynamicVariables: result.dynamicVariables,
      chatToken: result.session.sdk === "simulated" ? await widgetCallToken(result.callId, ctx.agent.id) : "",
      greeting: result.greeting,
    },
    { headers },
  );
}
