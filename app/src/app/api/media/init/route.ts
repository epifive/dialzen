import { NextResponse } from "next/server";
import { guardMediaRequest, jsonError, mediaErrorMessage, noStore, readJson } from "@/lib/media/http";
import { initUpload } from "@/lib/media/service";

/**
 * Step 1 of an upload: POST {workspaceId, filename, mime, size, folderId?} →
 * {token, upload: {method, url, headers, returnsUrl}}. The browser then sends the file straight
 * to `upload.url` (S3 presigned PUT, Vercel Blob, or /api/media/upload on local disk) and calls
 * /api/media/complete with the token.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const guard = await guardMediaRequest(body.workspaceId);
  if (!guard.ok) return guard.response;
  const filename = typeof body.filename === "string" ? body.filename : "file";
  const mime = typeof body.mime === "string" ? body.mime : "";
  const size = typeof body.size === "number" ? body.size : Number(body.size);
  const folderId = typeof body.folderId === "number" && body.folderId > 0 ? body.folderId : null;
  try {
    const result = await initUpload({ workspace: guard.workspace, userId: guard.userId, filename, mime, size, folderId });
    return NextResponse.json({ token: result.token, key: result.key, driver: result.driver, upload: result.upload }, { headers: noStore });
  } catch (error) {
    return jsonError(await mediaErrorMessage(error), 400);
  }
}
