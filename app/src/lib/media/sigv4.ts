import crypto from "node:crypto";

/**
 * AWS Signature Version 4 with node:crypto only (no AWS SDK): presigned URLs for direct browser
 * uploads (PUT) and reads, and signed headers for the server's own requests (HEAD, GET with Range,
 * DELETE, PUT). Works with AWS S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2 (S3 API) and other
 * S3-compatible stores. Verified against AWS's documented test vectors (see the unit tests).
 *
 * No server-only import: the unit tests bundle it with esbuild.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** "s3" for object storage. */
  service?: string;
}

export const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac("sha256", key).update(data, "utf8").digest();
export const sha256Hex = (data: string | Uint8Array) => crypto.createHash("sha256").update(data).digest("hex");

/** RFC 3986 encoding as SigV4 wants it (unreserved characters stay, everything else %XX upper case). */
export function uriEncode(value: string, keepSlash = false): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (keepSlash && ch === "/")) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** "20150830T123600Z" */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
}

export function signingKey(secret: string, day: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, day);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Canonical URI of a path. S3 encodes each segment once; other AWS services encode the already
 * encoded path again (`doubleEncode`). `path` is the raw (decoded) path, e.g. "/bucket/my file.jpg".
 */
export function canonicalUri(path: string, doubleEncode = false): string {
  const once = uriEncode(path || "/", true);
  return doubleEncode ? uriEncode(once, true) : once;
}

export function canonicalQuery(params: Array<[string, string]>): string {
  return params
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { canonical: entries.map(([k, v]) => `${k}:${v}\n`).join(""), signed: entries.map(([k]) => k).join(";") };
}

export interface SignInput {
  method: string;
  /** The raw (decoded) path, e.g. "/bucket/key with spaces.jpg". */
  path: string;
  /** Query parameters (decoded). */
  query?: Array<[string, string]>;
  /** Headers to sign; "host" must be included. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED-PAYLOAD. */
  payloadHash: string;
  date: Date;
  credentials: SigV4Credentials;
  doubleEncodePath?: boolean;
}

/** The string to sign and the signature of a request (shared by header auth and presigning). */
export function signature(input: SignInput): { signature: string; signedHeaders: string; scope: string; canonicalRequest: string; stringToSign: string } {
  const service = input.credentials.service ?? "s3";
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${input.credentials.region}/${service}/aws4_request`;
  const { canonical, signed } = canonicalHeaders(input.headers);
  const canonicalRequest = [input.method.toUpperCase(), canonicalUri(input.path, input.doubleEncodePath), canonicalQuery(input.query ?? []), canonical, signed, input.payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const sig = crypto.createHmac("sha256", signingKey(input.credentials.secretAccessKey, day, input.credentials.region, service)).update(stringToSign, "utf8").digest("hex");
  return { signature: sig, signedHeaders: signed, scope, canonicalRequest, stringToSign };
}

/**
 * Headers for a server-side request signed in the Authorization header. `headers` must contain
 * "host"; x-amz-date (and x-amz-content-sha256 for S3) are added.
 */
export function signHeaders(input: Omit<SignInput, "headers"> & { headers: Record<string, string>; addContentSha?: boolean }): Record<string, string> {
  const headers: Record<string, string> = { ...input.headers, "x-amz-date": amzDate(input.date) };
  if (input.addContentSha ?? true) headers["x-amz-content-sha256"] = input.payloadHash;
  const s = signature({ ...input, headers });
  const out = { ...headers };
  out.authorization = `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${s.scope}, SignedHeaders=${s.signedHeaders}, Signature=${s.signature}`;
  delete out.host;
  return out;
}

/**
 * A presigned URL (query-string auth). `headers` lists extra headers the client must send with
 * the same values (e.g. content-type); host is always signed. Expires in `expiresIn` seconds
 * (max 7 days).
 */
export function presignUrl(input: {
  method: string;
  /** Full URL without the signature parameters (protocol, host, path; existing query kept). */
  url: string;
  credentials: SigV4Credentials;
  date: Date;
  expiresIn: number;
  headers?: Record<string, string>;
  payloadHash?: string;
}): string {
  const u = new URL(input.url);
  const service = input.credentials.service ?? "s3";
  const stamp = amzDate(input.date);
  const scope = `${stamp.slice(0, 8)}/${input.credentials.region}/${service}/aws4_request`;
  const headers: Record<string, string> = { host: u.host, ...(input.headers ?? {}) };
  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(";");
  const query: Array<[string, string]> = [...u.searchParams.entries()];
  query.push(
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${input.credentials.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(Math.max(1, Math.min(604_800, Math.floor(input.expiresIn))))],
    ["X-Amz-SignedHeaders", signedHeaders],
  );
  const path = decodeURIComponent(u.pathname);
  const { signature: sig } = signature({ method: input.method, path, query, headers, payloadHash: input.payloadHash ?? UNSIGNED_PAYLOAD, date: input.date, credentials: input.credentials });
  query.push(["X-Amz-Signature", sig]);
  return `${u.protocol}//${u.host}${canonicalUri(path)}?${canonicalQuery(query)}`;
}
