import "server-only";
import { headers } from "next/headers";

/**
 * Small in-memory fixed-window rate limiter. Good enough for a single
 * Node.js process (VPS, cPanel, Docker). Counters reset on restart.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForLimiter = globalThis as unknown as { __dialzenRate?: Map<string, Bucket> };
const buckets = (globalForLimiter.__dialzenRate ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const nowMs = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= nowMs) buckets.delete(k);
    }
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    // Each proxy appends the address it received the request from, so only the last
    // entries are trustworthy: anything before them can be forged by the visitor.
    // Set TRUSTED_PROXY_HOPS=2 when there are two proxies, e.g. Cloudflare in front of Nginx.
    const list = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const hops = Math.min(10, Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1));
    if (list.length) return list[Math.max(0, list.length - hops)];
  }
  return h.get("x-real-ip") ?? "unknown";
}
