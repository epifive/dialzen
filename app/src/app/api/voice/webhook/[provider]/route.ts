import "@/lib/voice";
import { headerMap, ingestWebhook } from "@/lib/voice/ingest";

/**
 * Provider webhooks: POST /api/voice/webhook/elevenlabs (post-call webhook of the ElevenLabs
 * workspace), /api/voice/webhook/retell (set on every agent and number automatically) and
 * /api/voice/webhook/simulated (demo). The raw body is verified before anything is parsed into a
 * call; see src/lib/voice/ingest.ts.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return Response.json({ error: "Payload too large." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "Payload too large." }, { status: 413 });
  const result = await ingestWebhook(provider, headerMap(request.headers), raw);
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
