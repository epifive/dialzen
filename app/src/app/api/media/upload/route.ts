import { NextResponse } from "next/server";
import { jsonError, mediaErrorMessage, noStore } from "@/lib/media/http";
import { getMediaLimits, readUploadToken } from "@/lib/media/service";
import { getStorage, isLocalStorage, StorageError } from "@/lib/media/storage";

/**
 * Step 2 of an upload on local disk (VPS): PUT /api/media/upload?token=… with the file as the raw
 * body. The body is streamed to storage/uploads/media (never buffered in memory), so videos of
 * hundreds of MB work. The signed, short-lived token says where the file goes and how big it may
 * be, like an S3 presigned URL. Left out of the proxy (src/proxy.ts) so Next.js doesn't buffer it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function PUT(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = await readUploadToken(token);
  if (!claims || claims.d !== "local") return jsonError("This upload link expired. Upload the file again.", 403);
  if (!request.body) return jsonError("The file is empty.", 400);
  const declared = Number(request.headers.get("content-length") ?? 0);
  const limits = await getMediaLimits();
  const cap = Math.min(claims.m.startsWith("image/") ? limits.maxImageBytes : limits.maxFileBytes, Math.max(claims.s, 1) * 1.05 + 1024);
  if (declared > cap) return jsonError("The file is larger than allowed.", 413);
  try {
    const adapter = await getStorage("local");
    if (!isLocalStorage(adapter)) return jsonError("Local storage is not available.", 500);
    const written = await adapter.writeStream(claims.k, request.body, cap);
    return NextResponse.json({ ok: true, size: written }, { headers: noStore });
  } catch (error) {
    if (error instanceof StorageError) return jsonError(error.message, 413);
    return jsonError(await mediaErrorMessage(error), 500);
  }
}
