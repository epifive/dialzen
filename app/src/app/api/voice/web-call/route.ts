import { getAgent } from "@/lib/agents";
import { guardWorkspace } from "@/lib/dashboard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { startWebCall, WebCallError } from "@/lib/voice/web-call";

/**
 * The agent builder's test call: POST {workspaceId, agentId} with a member's session (agents.manage)
 * → {callId, sdk, token, url, providerCallId, expiresAt, dynamicVariables}. ElevenLabs: `url` is
 * the signed WebSocket URL; Retell: `token` is the access token; simulated: use
 * /api/voice/simulated/chat with the callId.
 */
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = { suspended: 403, concurrency: 429, insufficient_credits: 402, agent_not_synced: 409, provider_unavailable: 503, unsupported: 400, provider_error: 502 };

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const guard = await guardWorkspace(typeof body.workspaceId === "number" || typeof body.workspaceId === "string" ? body.workspaceId : null, { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return Response.json({ error: guard.error }, { status: 403 });
  if (!rateLimit(`dz-webcall:${guard.user.id}`, 10, 60_000)) return Response.json({ error: "Too many test calls. Wait a minute and try again." }, { status: 429 });
  const agent = await getAgent(guard.workspace.id, Number(body.agentId));
  if (!agent) return Response.json({ error: "This agent doesn't exist." }, { status: 404 });
  try {
    const { callId, session, dynamicVariables } = await startWebCall({ workspace: guard.workspace, agent, entitlements: guard.entitlements, source: "test", ip: await clientIp(), origin: request.headers.get("origin") ?? undefined });
    return Response.json({ callId, ...session, dynamicVariables }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WebCallError) return Response.json({ error: error.message, code: error.code }, { status: STATUS[error.code] ?? 400 });
    console.error("[dialzen] web call failed:", error);
    return Response.json({ error: "The test call could not be started." }, { status: 500 });
  }
}
