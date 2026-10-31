import crypto from "node:crypto";
import { END_REASONS, ProviderError, type EndReason, type ProviderContext, type ProviderErrorKind } from "@/voice/types";

/**
 * Shared plumbing of the provider adapters: every HTTP request goes through ctx.fetch (tests
 * inject a fake), with a timeout, JSON handling and HTTP status → ProviderError mapping. Pure:
 * no settings, no database, no server-only imports (the adapters are bundled into the tests).
 */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  /** JSON body. */
  json?: unknown;
  /** Multipart body (knowledge-base uploads). */
  form?: FormData;
  /** Raw response wanted (audio): the Response is returned unread. */
  raw?: boolean;
  /** 404 → null instead of throwing. */
  allow404?: boolean;
}

/** Base URL of a provider API: the test override (ctx.apiBase) or the real one. */
export function apiBase(ctx: Pick<ProviderContext, "apiBase">, real: string): string {
  return (ctx.apiBase || real).replace(/\/+$/, "");
}

export function errorKind(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 409 || status === 422) return "validation";
  if (status >= 500) return "network";
  return "unknown";
}

/** The provider's own error message from a JSON / text error body (kept short, no secrets echoed). */
export function errorMessage(body: unknown, fallback: string): string {
  const pick = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(pick).filter(Boolean).join("; ");
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of ["message", "error_message", "detail", "error", "msg", "status"]) {
        const m = pick(o[k]);
        if (m) return m;
      }
    }
    return "";
  };
  const msg = pick(body).replace(/\s+/g, " ").trim();
  return (msg || fallback).slice(0, 300);
}

/** One request to a provider API. Throws ProviderError (network / timeout / HTTP errors). */
export async function providerRequest(ctx: ProviderContext, url: string, options: RequestOptions = {}): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json", ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form;
  }
  let res: Response;
  try {
    res = await ctx.fetch(url, { method: options.method ?? (body ? "POST" : "GET"), headers, body, signal: AbortSignal.timeout(Math.max(1000, ctx.timeoutMs)), redirect: "follow" });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ProviderError("network", timeout ? `The ${ctx.provider} API did not answer in time.` : `Could not reach the ${ctx.provider} API.`, { retryable: true });
  }
  if (options.allow404 && res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (options.raw && res.ok) return res;
  const text = await res.text().catch(() => "");
  let parsed: unknown = text;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Plain text body.
    }
  }
  if (!res.ok) {
    const kind = errorKind(res.status);
    throw new ProviderError(kind, `${ctx.provider}: ${errorMessage(parsed, `HTTP ${res.status}`)}`, { status: res.status });
  }
  return text ? parsed : null;
}

// ── Signatures ──

export function hmacHex(key: string | Buffer, data: string | Buffer): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

/** Constant-time string comparison (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** "k1=v1,k2=v2" header → map (first value of each key wins; v0/v1 lists keep all values). */
export function parseSignatureHeader(header: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out.set(k, [...(out.get(k) ?? []), v]);
  }
  return out;
}

// ── Small parsers shared by the adapters ──

export const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asStr = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : fallback);
export const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** ISO time of a unix timestamp in seconds or milliseconds (null when missing). */
export function isoOf(v: unknown, unit: "s" | "ms"): string | null {
  const n = asNum(v);
  if (n === null || n <= 0) return null;
  const d = new Date(unit === "s" ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** USD → micros (the site currency is assumed to be USD for provider costs). */
export const usdToMicros = (usd: number): number => Math.round(usd * 1_000_000);

export function endReasonOf(v: unknown, fallback: EndReason): EndReason {
  return typeof v === "string" && (END_REASONS as readonly string[]).includes(v) ? (v as EndReason) : fallback;
}
