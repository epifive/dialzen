import "server-only";
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

/**
 * SSRF guards for outgoing requests to user-supplied addresses: notification webhooks, webhook
 * tools of agents, knowledge-base URLs and file imports.
 *
 * They keep users from making the server reach private networks, loopback or cloud metadata
 * endpoints. The IP is checked when the socket connects, which also defeats DNS-rebinding tricks.
 */

export class ToolInputError extends Error {}

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

/** True when the address is loopback, private, link-local, multicast or otherwise not public. */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) {
    const g = expandIPv6(ip);
    if (!g) return true;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
    // Forms that embed an IPv4 address: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d),
    // SIIT (::ffff:0:a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::).
    if (zeros(5) && g[5] === 0xffff) return isBlockedV4(v4(g[6], g[7]));
    if (zeros(6)) return g[6] === 0 && g[7] <= 1 ? true : isBlockedV4(v4(g[6], g[7]));
    if (zeros(4) && g[4] === 0xffff && g[5] === 0) return isBlockedV4(v4(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b) return true;
    if (g[0] === 0x2002) return isBlockedV4(v4(g[1], g[2]));
    return (
      (g[0] === 0x2001 && g[1] === 0) || // Teredo
      (g[0] === 0x2001 && g[1] === 0xdb8) || // documentation
      (g[0] === 0x100 && zeros(4)) || // discard prefix
      (g[0] & 0xfe00) === 0xfc00 || // unique local
      (g[0] & 0xffc0) === 0xfe80 || // link-local
      (g[0] & 0xffc0) === 0xfec0 || // site-local (deprecated)
      (g[0] & 0xff00) === 0xff00 // multicast
    );
  }
  return true;
}

/** Expand an IPv6 address (any notation, including a trailing dotted IPv4 part) to 8 numbers. */
function expandIPv6(ip: string): number[] | null {
  let value = ip.toLowerCase().replace(/%.*$/, "");
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (net.isIP(dotted[2]) !== 4) return null;
    const n = ipv4ToInt(dotted[2]);
    value = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return groups.map((x) => Number.parseInt(x, 16));
}

/** Normalise and validate a hostname typed by a visitor (accepts URLs too). */
export function parseHostname(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new ToolInputError("Enter a domain name, e.g. example.com.");
  let value = input.trim().toLowerCase();
  if (/^[a-z]+:\/\//.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      throw new ToolInputError("That doesn't look like a valid domain.");
    }
  }
  value = value.replace(/\/.*$/, "").replace(/\.$/, "");
  if (value.length > 253 || !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(value)) {
    throw new ToolInputError("Enter a valid public domain name, e.g. example.com.");
  }
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal")) {
    throw new ToolInputError("Private and local addresses can't be checked.");
  }
  return value;
}

/** Validate a URL typed by a visitor. Adds https:// when the scheme is missing. */
export function parsePublicUrl(input: unknown): URL {
  if (typeof input !== "string" || !input.trim()) throw new ToolInputError("Enter a URL, e.g. https://example.com.");
  const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolInputError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ToolInputError("Only http:// and https:// URLs can be checked.");
  if (url.username || url.password) throw new ToolInputError("URLs with a username or password are not allowed.");
  if (!ALLOWED_PORTS.has(url.port)) throw new ToolInputError("Only standard web ports (80, 443, 8080, 8443) can be checked.");
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    if (isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ""))) throw new ToolInputError("Private and local addresses can't be checked.");
  } else {
    parseHostname(url.hostname);
  }
  return url;
}

/** Resolve a hostname and refuse private results. */
export async function resolvePublic(hostname: string): Promise<Array<{ address: string; family: number }>> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ToolInputError(`The domain ${hostname} could not be found.`);
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ToolInputError("Private and local addresses can't be checked.");
  }
  return addresses;
}

/**
 * DNS lookup used by the HTTP agent: refuses to connect to private addresses.
 * Also usable as the `lookup` option of net.connect / tls.connect.
 */
export function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("Blocked private address"), { code: "EBLOCKED" }), []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup, timeout: 8_000 }, headersTimeout: 10_000, bodyTimeout: 10_000 });

export interface FetchedResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  timeMs: number;
}

export interface Hop {
  url: string;
  status: number;
  location: string | null;
  timeMs: number;
}

const USER_AGENT = "Dialzen/1.0 (+alerts)";

async function readLimited(res: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  if (res.body) {
    for await (const chunk of res.body) {
      const piece = chunk as Uint8Array;
      bytes += piece.byteLength;
      if (bytes > maxBytes) {
        truncated = true;
        break;
      }
      chunks.push(piece);
    }
  }
  return { body: Buffer.concat(chunks).toString("utf8"), bytes, truncated };
}

/** One request without following redirects. */
export async function fetchOnce(
  url: URL,
  { method = "GET", maxBytes = 1_500_000, readBody = true }: { method?: "GET" | "HEAD"; maxBytes?: number; readBody?: boolean } = {},
): Promise<FetchedResponse> {
  const started = Date.now();
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(url, {
      method,
      redirect: "manual",
      dispatcher: agent,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === "EBLOCKED") throw new ToolInputError("Private and local addresses can't be checked.");
    if (code === "ENOTFOUND") throw new ToolInputError(`The domain ${url.hostname} could not be found.`);
    throw new ToolInputError(`Could not connect to ${url.host}. The site may be down or blocking requests.`);
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const read = readBody && method !== "HEAD" ? await readLimited(res, maxBytes) : { body: "", bytes: 0, truncated: false };
  if (!readBody) await res.body?.cancel().catch(() => undefined);
  return { url: url.toString(), status: res.status, statusText: res.statusText, headers, ...read, timeMs: Date.now() - started };
}

/** Agent without the private-address guard, only for installs that enable "allow private targets". */
const openAgent = new Agent({ connect: { timeout: 8_000 }, headersTimeout: 10_000, bodyTimeout: 10_000 });

/** Like parsePublicUrl, but any port 1-65535 is accepted (alert webhooks such as n8n on :5678). */
export function parseWebhookUrl(input: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ToolInputError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ToolInputError("Only http:// and https:// URLs can be used.");
  if (url.username || url.password) throw new ToolInputError("URLs with a username or password are not allowed.");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new ToolInputError("Private and local addresses can't be used.");
  } else if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ToolInputError("Private and local addresses can't be used.");
  }
  return url;
}

/**
 * POST a JSON body to a user-supplied URL (outgoing webhooks). Same guards as
 * fetchOnce: public addresses and standard ports only, redirects are not
 * followed, and the response body is discarded. Returns the HTTP status.
 * Throws ToolInputError for invalid or private URLs and network failures.
 *
 * `anyPort` accepts every port (the address is still checked when connecting);
 * `allowPrivate` skips the private-address guard (Admin → allow private targets).
 */
export async function postJson(
  input: string,
  body: string,
  {
    timeoutMs = 5_000,
    headers = {},
    anyPort = false,
    allowPrivate = false,
  }: { timeoutMs?: number; headers?: Record<string, string>; anyPort?: boolean; allowPrivate?: boolean } = {},
): Promise<number> {
  const url = anyPort || allowPrivate ? parseWebhookUrl(input, allowPrivate) : parsePublicUrl(input);
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    res = await undiciFetch(url, {
      method: "POST",
      redirect: "manual",
      dispatcher: allowPrivate ? openAgent : agent,
      headers: { "User-Agent": "Dialzen-Webhook/1.0", "Content-Type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    if (code === "EBLOCKED") throw new ToolInputError("Private and local addresses can't be used.");
    throw new ToolInputError(`Could not connect to ${url.host}.`);
  }
  await res.body?.cancel().catch(() => undefined);
  return res.status;
}

/** Follow redirects manually (each hop is validated) and return the chain plus the final response. */
export async function fetchFollow(
  start: URL,
  options: { maxRedirects?: number; maxBytes?: number; readBody?: boolean } = {},
): Promise<{ hops: Hop[]; final: FetchedResponse }> {
  const hops: Hop[] = [];
  let url = start;
  for (let i = 0; i <= (options.maxRedirects ?? 10); i++) {
    const res = await fetchOnce(url, { maxBytes: options.maxBytes, readBody: options.readBody });
    const location = res.headers.location ?? null;
    hops.push({ url: url.toString(), status: res.status, location, timeMs: res.timeMs });
    if (res.status >= 300 && res.status < 400 && location) {
      url = parsePublicUrl(new URL(location, url).toString());
      continue;
    }
    return { hops, final: res };
  }
  throw new ToolInputError(`Too many redirects (more than ${options.maxRedirects ?? 10}).`);
}
