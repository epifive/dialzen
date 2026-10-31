import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { simulatedChat } from "@/lib/voice-bridge";
import { corsHeaders, readWidgetCallToken, widgetContext } from "@/lib/widget";

/**
 * Text chat of a widget call with a simulated agent (POST /api/widget/<key>/chat,
 * JSON {chatToken, message?, end?}). The chat token from /token ties the visitor to their call.
 */
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request, { params }: { params: Promise<{ agentKey: string }> }): Promise<Response> {
  const ctx = await widgetContext((await params).agentKey, request);
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin"), ctx.allowed) });
}

export async function POST(request: Request, { params }: { params: Promise<{ agentKey: string }> }): Promise<Response> {
  const ctx = await widgetContext((await params).agentKey, request);
  const headers = corsHeaders(request.headers.get("origin"), ctx.allowed);
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status, headers });
  const ip = await clientIp();
  if (!rateLimit(`dz-widget-chat:${ip}`, 40, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await request.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // Empty body.
  }
  const callId = await readWidgetCallToken(typeof body.chatToken === "string" ? body.chatToken : "", ctx.agent.id);
  if (!callId) return NextResponse.json({ error: "token" }, { status: 403, headers });
  const message = typeof body.message === "string" ? body.message.slice(0, 1000) : "";
  const result = await simulatedChat({ workspaceId: ctx.workspace.id, callId, message, end: body.end === true });
  if (!result) return NextResponse.json({ error: "ended" }, { status: 410, headers });
  return NextResponse.json({ reply: result.reply, end: result.end }, { headers });
}
