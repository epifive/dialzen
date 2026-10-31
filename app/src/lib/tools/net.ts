import "server-only";
import { Agent, fetch as undiciFetch } from "undici";
import { guardedLookup } from "@/lib/net/ssrf";

/**
 * fetch for user-supplied tool URLs (webhook tools, self-hosted Cal.com): connections to private,
 * loopback and metadata addresses are refused when the socket connects (DNS rebinding safe),
 * unless the server sets ALLOW_PRIVATE_WEBHOOKS=1 (n8n on the LAN, local tests).
 */

const guarded = new Agent({ connect: { lookup: guardedLookup, timeout: 5_000 }, headersTimeout: 6_000, bodyTimeout: 6_000 });
const open = new Agent({ connect: { timeout: 5_000 }, headersTimeout: 6_000, bodyTimeout: 6_000 });

export function allowPrivateTargets(): boolean {
  const v = process.env.ALLOW_PRIVATE_WEBHOOKS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const guardedFetch: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const protocol = new URL(url).protocol;
  if (protocol !== "https:" && protocol !== "http:") return Promise.reject(new TypeError("Only http and https URLs are allowed."));
  return undiciFetch(url, { ...(init as object), dispatcher: allowPrivateTargets() ? open : guarded } as never) as unknown as Promise<Response>;
};
