import { guardWorkspace } from "@/lib/dashboard";
import { rateLimit } from "@/lib/rate-limit";
import { SimulatedChatError, simulatedChat } from "@/lib/voice/web-call";

/**
 * Text-mode test call of the Simulated provider: POST {workspaceId, callId, message} → {reply, end};
 * {workspaceId, callId} without a message → the agent's greeting; {workspaceId, callId, end: true}
 * finishes the call (transcript, summary and billing through the webhook ingest).
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const guard = await guardWorkspace(typeof body.workspaceId === "number" || typeof body.workspaceId === "string" ? body.workspaceId : null, { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return Response.json({ error: guard.error }, { status: 403 });
  if (!rateLimit(`dz-simchat:${guard.user.id}`, 60, 60_000)) return Response.json({ error: "Too many messages. Wait a moment." }, { status: 429 });
  try {
    const result = await simulatedChat({ workspaceId: guard.workspace.id, callId: Number(body.callId), message: typeof body.message === "string" ? body.message : undefined, end: body.end === true });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SimulatedChatError) return Response.json({ error: error.message, code: error.code }, { status: error.code === "ended" ? 409 : 404 });
    console.error("[dialzen] simulated chat failed:", error);
    return Response.json({ error: "The agent could not answer." }, { status: 500 });
  }
}
