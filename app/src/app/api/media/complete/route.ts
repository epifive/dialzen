import { NextResponse } from "next/server";
import { guardMediaRequest, jsonError, mediaErrorMessage, mediaJson, noStore, readJson } from "@/lib/media/http";
import { completeUpload } from "@/lib/media/service";

/**
 * Step 3 of an upload: POST {workspaceId, token, altText?, blobUrl?} after the file reached the
 * storage. Checks the stored bytes (real type, size, dimensions, video length) and adds the item
 * to the library → {media}. Idempotent per token.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  const guard = await guardMediaRequest(body.workspaceId);
  if (!guard.ok) return guard.response;
  const token = typeof body.token === "string" ? body.token : "";
  try {
    const item = await completeUpload({
      token,
      workspaceId: guard.workspace.id,
      userId: guard.userId,
      altText: typeof body.altText === "string" ? body.altText : "",
      blobUrl: typeof body.blobUrl === "string" ? body.blobUrl : undefined,
    });
    return NextResponse.json({ media: mediaJson(item) }, { headers: noStore });
  } catch (error) {
    return jsonError(await mediaErrorMessage(error), 400);
  }
}
