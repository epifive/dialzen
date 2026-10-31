import "@/lib/voice";
import { elevenLabsInitiation } from "@/lib/voice/inbound";
import { headerMap } from "@/lib/voice/ingest";

/**
 * ElevenLabs conversation-initiation webhook for inbound phone calls: answers the agent's dynamic
 * variables (caller, contact, business, time zone) and our call tags. Set on every ElevenLabs
 * agent automatically when it syncs; checked with the X-Dialzen-Inbound-Secret header. See
 * src/lib/voice/inbound.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64 * 1024) return Response.json({ error: "Payload too large." }, { status: 413 });
  const result = await elevenLabsInitiation(headerMap(request.headers), await request.text());
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
