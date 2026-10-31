import "server-only";
import { NextResponse } from "next/server";
import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { formatNumber } from "@/lib/dash-format";
import { rateLimit } from "@/lib/rate-limit";
import { MediaServiceError, type MediaItem } from "./service";

/** Shared pieces of the /api/media routes (JSON in and out, session auth, translated errors). */

export const noStore = { "Cache-Control": "no-store" };

export function jsonError(message: string, status = 400): Response {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}

/** A media error in the visitor's language. */
export async function mediaErrorMessage(error: unknown): Promise<string> {
  const t = await getT();
  if (error instanceof MediaServiceError) {
    const params = { ...error.params } as Record<string, string | number>;
    if (typeof params.used === "number") params.used = formatNumber(Math.round(params.used / 1048576), "en");
    if (typeof params.limit === "number") params.limit = formatNumber(Math.round(params.limit / 1048576), "en");
    if (error.code === "storage" || error.code === "download") return `${t(`dash.media.err.${error.code}` as MessageKey)} ${error.message}`;
    return t(`dash.media.err.${error.code}` as MessageKey, params);
  }
  console.error("[dialzen] media request failed:", error);
  return t("dash.media.err.storage");
}

/** Session + membership + agents.manage (knowledge-base uploads) for a workspace id from a JSON body; rate limited per user. */
export async function guardMediaRequest(wid: unknown): Promise<{ ok: true; workspace: { id: number; ownerId: number }; userId: number } | { ok: false; response: Response }> {
  const guard = await guardWorkspace(typeof wid === "number" || typeof wid === "string" ? wid : null, { capability: "agents.manage" });
  if (!guard.ok) return { ok: false, response: jsonError(guard.error, 403) };
  if (!rateLimit(`media:${guard.user.id}`, 240, 60_000)) {
    const t = await getT();
    return { ok: false, response: jsonError(t("dash.media.err.rate"), 429) };
  }
  return { ok: true, workspace: { id: guard.workspace.id, ownerId: guard.workspace.ownerId }, userId: guard.user.id };
}

/** What the browser gets for a library item. */
export function mediaJson(item: MediaItem) {
  return {
    id: item.id,
    kind: item.kind,
    mime: item.mime,
    size: item.size,
    width: item.width,
    height: item.height,
    duration: item.duration,
    altText: item.altText,
    url: item.url,
    filename: item.filename,
    folderId: item.folderId,
    createdAt: item.createdAt,
  };
}

/** A media item for the REST API (/api/v1): the same fields in snake_case. */
export function mediaApiJson(item: MediaItem) {
  return {
    id: item.id,
    kind: item.kind,
    mime: item.mime,
    size: item.size,
    width: item.width,
    height: item.height,
    duration: item.duration,
    alt_text: item.altText,
    url: item.url,
    filename: item.filename,
    folder_id: item.folderId,
    created_at: item.createdAt,
  };
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
