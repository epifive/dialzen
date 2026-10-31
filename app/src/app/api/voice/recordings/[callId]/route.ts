import { getCurrentUser } from "@/lib/auth/session";
import { getStorage, type StorageDriver } from "@/lib/media/storage";
import { callById } from "@/lib/voice/ingest";
import { providerRecording, verifyRecordingSignature } from "@/lib/voice/recordings";
import { getMembership } from "@/lib/workspaces";

/**
 * Call recordings for the player: GET /api/voice/recordings/<callId>?exp=…&sig=… (a signed URL from
 * recordingUrlFor()) or with the session of a workspace member. Streams the copy in media storage
 * (with byte ranges), or the provider's audio while the copy isn't made yet. Never cached publicly.
 */
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm" };
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

async function allowed(request: Request, call: { id: number; workspaceId: number }): Promise<boolean> {
  const url = new URL(request.url);
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  if (exp && sig) return verifyRecordingSignature(call, exp, sig);
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return false;
  return Boolean(await getMembership(call.workspaceId, user.id));
}

async function serve(request: Request, params: Promise<{ callId: string }>, head: boolean): Promise<Response> {
  const { callId } = await params;
  if (!/^\d{1,10}$/.test(callId)) return notFound();
  const call = await callById(Number(callId));
  if (!call || call.recordingDeletedAt || !(await allowed(request, call))) return notFound();
  const headers: Record<string, string> = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Accept-Ranges": "bytes" };

  if (call.recording) {
    const storage = await getStorage(call.recording.storage as StorageDriver);
    const info = await storage.head(call.recording.key).catch(() => null);
    if (!info) return notFound();
    const size = info.size;
    headers["Content-Type"] = TYPES[call.recording.key.split(".").pop() ?? ""] ?? "audio/mpeg";
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = request.headers.get("range");
    if (range && size > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      if (m[1]) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      } else start = Math.max(0, size - Number(m[2]));
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    }
    headers["Content-Length"] = String(size === 0 ? 0 : end - start + 1);
    if (head || size === 0) return new Response(null, { status, headers });
    return new Response(await storage.open(call.recording.key, { start, end }), { status, headers });
  }

  if (!call.recordingUrl) return notFound();
  const audio = await providerRecording(call).catch(() => null);
  if (!audio) return notFound();
  headers["Content-Type"] = audio.mime;
  delete headers["Accept-Ranges"];
  if (audio.size) headers["Content-Length"] = String(audio.size);
  if (head) {
    await audio.body.cancel().catch(() => undefined);
    return new Response(null, { status: 200, headers });
  }
  return new Response(audio.body, { status: 200, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  return serve(request, params, false);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ callId: string }> }) {
  return serve(request, params, true);
}
