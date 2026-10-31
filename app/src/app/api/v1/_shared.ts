import "server-only";
import { apiError, apiGuard } from "@/lib/api-guard";
import { rateLimit } from "@/lib/rate-limit";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { roleCan } from "@/voice/normalize";
import type { WorkspaceCapability } from "@/voice/types";

/**
 * Helpers of the REST API v1 routes (src/app/api/v1/**). Authentication, the plan's API access
 * and the per-key rate limit come from apiGuard (src/lib/api-guard.ts); writes get a second,
 * tighter limit. Errors are JSON { error } (+ details) with 401/403/404/409/422/429.
 */

/** Writes (POST / PATCH / DELETE) per API key and minute, on top of the general limit. */
export const API_WRITE_LIMIT = 120;

export async function v1Guard(request: Request, options: { capability?: WorkspaceCapability; write?: boolean } = {}) {
  const guard = await apiGuard(request);
  if (!guard.ok) return guard;
  if (options.capability && !roleCan(guard.role, options.capability)) {
    return { ok: false as const, response: apiError(403, "The API key's member role doesn't allow this.") };
  }
  if (options.write && !rateLimit(`api-write:${guard.workspace.id}:${guard.user.id}`, API_WRITE_LIMIT, 60_000)) {
    return { ok: false as const, response: apiError(429, "Too many write requests. Slow down and try again in a minute.", { "Retry-After": "60" }) };
  }
  return { ...guard, entitlements: await getWorkspaceEntitlements(guard.workspace) };
}

/** A timestamp from a body field: ISO-8601 with a zone ("2026-10-21T09:30:00Z") or epoch seconds. */
export function timestampFrom(raw: unknown): string | null | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return new Date(raw * 1000).toISOString();
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(raw.trim())) {
    const ms = Date.parse(raw.trim());
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "invalid";
  }
  return "invalid";
}
