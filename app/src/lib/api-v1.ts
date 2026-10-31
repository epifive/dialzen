import "server-only";
import { apiError } from "./api-guard";
import { BodyTooLargeError, isRecord, parseJsonText, readBodyText } from "./public-api";

/**
 * Shared helpers of the REST API (/api/v1, Authorization: Bearer <API key of a workspace>).
 * The endpoints themselves (agents, calls, contacts, campaigns) are built on these helpers.
 * Errors are JSON { error } with: 401 missing / invalid key, 403 plan without API access, a role
 * that doesn't allow it or a plan limit, 404 unknown id (or another workspace's), 409 conflict,
 * 413 body too large, 422 invalid input, 429 rate limit.
 */

export const MAX_API_BODY = 256 * 1024;

/** The JSON object body of a request, or an error response. */
export async function readApiJson(request: Request): Promise<Record<string, unknown> | Response> {
  let text: string;
  try {
    text = await readBodyText(request, MAX_API_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return apiError(413, "Request body too large (max 256 KB).");
    return apiError(422, "Could not read the request body.");
  }
  const body = parseJsonText(text);
  if (!isRecord(body)) return apiError(422, "Send a JSON object (Content-Type: application/json).");
  return body;
}

/** Object keys camelCase → snake_case, recursively (API output). */
export function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), snakeKeys(v)]));
}

/** Object keys snake_case → camelCase, recursively (API input; camelCase keys pass unchanged). */
export function camelKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), camelKeys(v)]));
}

/** limit / offset query parameters (default 50, max 500). */
export function pageParams(url: URL): { limit: number; offset: number } {
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
  return { limit, offset };
}

/** A positive integer id from a path segment, or NaN. */
export function pathId(value: string): number {
  return /^\d{1,10}$/.test(value) ? Number(value) : NaN;
}

/** Integer query parameter clamped to [min, max] (fallback when missing or invalid). */
export function intQuery(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** 201 Created with a JSON body. */
export function apiCreated(data: unknown, status = 201) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
