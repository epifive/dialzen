import "server-only";
import { NextResponse } from "next/server";
import { authenticateApiRequest } from "./api-keys";
import { rateLimit } from "./rate-limit";

/** Requests per minute per API key. */
export const API_RATE_LIMIT = 600;

export function apiError(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function apiJson(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

/** Authenticates and rate-limits a REST API request (/api/v1). */
export async function apiGuard(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return { ok: false as const, response: apiError(auth.status, auth.error) };
  if (!rateLimit(`api:${auth.keyId}`, API_RATE_LIMIT, 60_000)) {
    return { ok: false as const, response: apiError(429, "Too many requests. Slow down and try again in a minute.", { "Retry-After": "60" }) };
  }
  return { ok: true as const, user: auth.user, workspace: auth.workspace, role: auth.role };
}
