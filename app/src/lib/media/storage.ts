import "server-only";
import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { storagePath } from "@/lib/config";
import { getSettings, type Settings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { EMPTY_SHA256, presignUrl, sha256Hex, signHeaders, UNSIGNED_PAYLOAD, type SigV4Credentials } from "./sigv4";

/**
 * Storage adapters of the media library. Uploads never pass through a serverless function: the
 * browser sends the bytes straight to the storage (S3 presigned PUT, Vercel Blob client token) or,
 * on a VPS, streams them to `storage/uploads/media` through /api/media/upload (no size limit there).
 *
 * - local: files under storage/uploads/media, served with range support by /api/media/f/<key>
 * - s3:    any S3-compatible store (AWS S3, Cloudflare R2, MinIO, Wasabi, B2); SigV4 signed by us
 * - blob:  Vercel Blob (client uploads with a client token from the read-write token, REST API)
 *
 * Settings come from Admin → Settings → Media storage; environment variables override them
 * (STORAGE_DRIVER, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 * S3_PUBLIC_URL, S3_PATH_STYLE, BLOB_READ_WRITE_TOKEN).
 */

export const STORAGE_DRIVERS = ["local", "s3", "blob"] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

/** Where the browser sends the file. */
export interface UploadTarget {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  /** Vercel Blob answers with JSON {url}; the client passes it to /complete. */
  returnsUrl: boolean;
}

export interface StorageAdapter {
  readonly driver: StorageDriver;
  /** A browser upload of `size` bytes of `mime` to `key`. `token` is our signed upload token (local only). */
  uploadTarget(key: string, mime: string, size: number, token: string): Promise<UploadTarget>;
  /** Public HTTPS URL of a stored file (platforms that pull media fetch it). */
  publicUrl(key: string): string;
  /** Size of a stored file, null when it doesn't exist. */
  head(key: string): Promise<{ size: number } | null>;
  /** Bytes [start, end] (inclusive). */
  read(key: string, start: number, end: number): Promise<Uint8Array>;
  /** A stream of the file or a part of it. */
  open(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>>;
  /** Server-side upload (URL imports, the admin test). */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {}

// ── Configuration ──

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  pathStyle: boolean;
}

export interface StorageConfig {
  driver: StorageDriver;
  s3: S3Config;
  blobToken: string;
  /** The value came from environment variables (the admin form shows them read-only). */
  fromEnv: { driver: boolean; s3: boolean; blob: boolean };
}

const env = (name: string) => process.env[name]?.trim() ?? "";
const truthy = (v: string) => ["1", "true", "yes", "on"].includes(v.toLowerCase());

export function isStorageDriver(v: unknown): v is StorageDriver {
  return typeof v === "string" && (STORAGE_DRIVERS as readonly string[]).includes(v);
}

export function storageConfigFrom(settings: Settings): StorageConfig {
  const driverEnv = env("STORAGE_DRIVER");
  const s3Env = Boolean(env("S3_BUCKET") && env("S3_ACCESS_KEY_ID"));
  return {
    driver: isStorageDriver(driverEnv) ? driverEnv : isStorageDriver(settings.storage_driver) ? settings.storage_driver : "local",
    s3: s3Env
      ? {
          endpoint: env("S3_ENDPOINT").replace(/\/+$/, ""),
          region: env("S3_REGION") || "us-east-1",
          bucket: env("S3_BUCKET"),
          accessKeyId: env("S3_ACCESS_KEY_ID"),
          secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
          publicUrl: env("S3_PUBLIC_URL").replace(/\/+$/, ""),
          pathStyle: truthy(env("S3_PATH_STYLE")),
        }
      : {
          endpoint: settings.s3_endpoint.trim().replace(/\/+$/, ""),
          region: settings.s3_region.trim() || "us-east-1",
          bucket: settings.s3_bucket.trim(),
          accessKeyId: settings.s3_access_key.trim(),
          secretAccessKey: settings.s3_secret_key.trim(),
          publicUrl: settings.s3_public_url.trim().replace(/\/+$/, ""),
          pathStyle: Boolean(settings.s3_path_style),
        },
    blobToken: env("BLOB_READ_WRITE_TOKEN") || settings.blob_token.trim(),
    fromEnv: { driver: isStorageDriver(driverEnv), s3: s3Env, blob: Boolean(env("BLOB_READ_WRITE_TOKEN")) },
  };
}

export async function getStorageConfig(): Promise<StorageConfig> {
  return storageConfigFrom(await getSettings());
}

/** Keys we create: "w12/2026/10/ab12cd34ef-photo.jpg" (no "..", no leading slash, no "//"). */
export function isSafeKey(key: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(key) && !key.includes("..") && key.length <= 400;
}

function assertKey(key: string): void {
  if (!isSafeKey(key)) throw new StorageError("Invalid storage key.");
}

const toUint8 = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

async function readAll(res: Response): Promise<Uint8Array> {
  return new Uint8Array(await res.arrayBuffer());
}

// ── Local disk ──

export function localRoot(): string {
  return storagePath("uploads", "media");
}

export function localFile(key: string): string {
  assertKey(key);
  const root = localRoot();
  const file = path.resolve(root, ...key.split("/"));
  if (!file.startsWith(root + path.sep)) throw new StorageError("Invalid storage key.");
  return file;
}

class LocalStorage implements StorageAdapter {
  readonly driver = "local" as const;
  constructor(private readonly settings: Settings) {}

  async uploadTarget(_key: string, mime: string, _size: number, token: string): Promise<UploadTarget> {
    return { method: "PUT", url: `/api/media/upload?token=${encodeURIComponent(token)}`, headers: { "content-type": mime }, returnsUrl: false };
  }

  publicUrl(key: string): string {
    return absoluteUrl(this.settings, `/api/media/f/${key.split("/").map(encodeURIComponent).join("/")}`);
  }

  async head(key: string) {
    try {
      const st = await fs.stat(localFile(key));
      return st.isFile() ? { size: st.size } : null;
    } catch {
      return null;
    }
  }

  async read(key: string, start: number, end: number): Promise<Uint8Array> {
    const handle = await fs.open(localFile(key), "r");
    try {
      const length = Math.max(0, end - start + 1);
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, start);
      return toUint8(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  async open(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    const file = localFile(key);
    await fs.access(file);
    return Readable.toWeb(createReadStream(file, range ? { start: range.start, end: range.end } : {})) as ReadableStream<Uint8Array>;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const file = localFile(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  /**
   * Streams a request body to disk (the /api/media/upload route): written to a ".part" file and
   * renamed once complete, so a half-finished upload never looks like a file. Stops at `maxBytes`.
   */
  async writeStream(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
    const file = localFile(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const part = `${file}.${crypto.randomBytes(4).toString("hex")}.part`;
    let written = 0;
    const counter = async function* (source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        written += chunk.byteLength;
        if (written > maxBytes) throw new StorageError("The file is larger than allowed.");
        yield chunk;
      }
    };
    try {
      await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>), counter, createWriteStream(part));
      await fs.rename(part, file);
    } catch (error) {
      await fs.rm(part, { force: true }).catch(() => undefined);
      throw error;
    }
    return written;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(localFile(key), { force: true });
  }
}

// ── S3-compatible ──

class S3Storage implements StorageAdapter {
  readonly driver = "s3" as const;
  private readonly creds: SigV4Credentials;
  constructor(private readonly cfg: S3Config) {
    if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) throw new StorageError("S3 storage isn't configured (bucket, access key and secret key are required).");
    this.creds = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region || "us-east-1", service: "s3" };
  }

  /** Object URL for API requests (path style or virtual-hosted). */
  objectUrl(key: string): URL {
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const endpoint = this.cfg.endpoint || `https://s3.${this.cfg.region || "us-east-1"}.amazonaws.com`;
    const base = new URL(endpoint);
    if (this.cfg.pathStyle) return new URL(`${base.protocol}//${base.host}/${encodeURIComponent(this.cfg.bucket)}/${encodedKey}`);
    return new URL(`${base.protocol}//${this.cfg.bucket}.${base.host}/${encodedKey}`);
  }

  async uploadTarget(key: string, mime: string): Promise<UploadTarget> {
    assertKey(key);
    const url = presignUrl({ method: "PUT", url: this.objectUrl(key).toString(), credentials: this.creds, date: new Date(), expiresIn: 3600, headers: { "content-type": mime } });
    return { method: "PUT", url, headers: { "content-type": mime }, returnsUrl: false };
  }

  publicUrl(key: string): string {
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return this.cfg.publicUrl ? `${this.cfg.publicUrl}/${encodedKey}` : this.objectUrl(key).toString();
  }

  private async request(method: string, key: string, extra: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    assertKey(key);
    const url = this.objectUrl(key);
    const payloadHash = body ? sha256Hex(body) : method === "PUT" ? UNSIGNED_PAYLOAD : EMPTY_SHA256;
    const headers = signHeaders({ method, path: decodeURIComponent(url.pathname), headers: { host: url.host, ...extra }, payloadHash, date: new Date(), credentials: this.creds });
    return fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined, signal: AbortSignal.timeout(120_000) });
  }

  async head(key: string) {
    const res = await this.request("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new StorageError(`S3 HEAD failed: HTTP ${res.status}`);
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  async read(key: string, start: number, end: number): Promise<Uint8Array> {
    const res = await this.request("GET", key, { range: `bytes=${start}-${end}` });
    if (!res.ok) throw new StorageError(`S3 GET failed: HTTP ${res.status}`);
    return readAll(res);
  }

  async open(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    const res = await this.request("GET", key, range ? { range: `bytes=${range.start}-${range.end}` } : {});
    if (!res.ok || !res.body) throw new StorageError(`S3 GET failed: HTTP ${res.status}`);
    return res.body;
  }

  async put(key: string, body: Uint8Array, mime: string): Promise<void> {
    const res = await this.request("PUT", key, { "content-type": mime }, body);
    if (!res.ok) throw new StorageError(`S3 PUT failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }

  async delete(key: string): Promise<void> {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) throw new StorageError(`S3 DELETE failed: HTTP ${res.status}`);
  }
}

// ── Vercel Blob ──

const BLOB_API = "https://vercel.com/api/blob";
const BLOB_API_VERSION = "11";

/** The store id inside a read-write token "vercel_blob_rw_<storeId>_<secret>". */
export function blobStoreId(token: string): string {
  const id = token.split("_")[3] ?? "";
  return /^[A-Za-z0-9]+$/.test(id) ? id : "";
}

/**
 * A client token (what @vercel/blob's generateClientTokenFromReadWriteToken makes): the browser
 * may PUT exactly `pathname`, of the allowed type and size, until `validUntil`.
 */
export function blobClientToken(readWriteToken: string, args: { pathname: string; allowedContentTypes: string[]; maximumSizeInBytes: number; validUntil: number }): string {
  const storeId = blobStoreId(readWriteToken);
  if (!storeId) throw new StorageError("The Vercel Blob token is invalid (expected vercel_blob_rw_…).");
  const payload = Buffer.from(JSON.stringify({ ...args, addRandomSuffix: false })).toString("base64");
  const secured = crypto.createHmac("sha256", readWriteToken).update(payload).digest("hex");
  return `vercel_blob_client_${storeId}_${Buffer.from(`${secured}.${payload}`).toString("base64")}`;
}

class BlobStorage implements StorageAdapter {
  readonly driver = "blob" as const;
  private readonly storeId: string;
  constructor(private readonly token: string) {
    this.storeId = blobStoreId(token);
    if (!this.storeId) throw new StorageError("Vercel Blob isn't configured (paste the read-write token, or set BLOB_READ_WRITE_TOKEN).");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, "x-api-version": BLOB_API_VERSION, ...extra };
  }

  async uploadTarget(key: string, mime: string, size: number): Promise<UploadTarget> {
    assertKey(key);
    const clientToken = blobClientToken(this.token, { pathname: key, allowedContentTypes: [mime], maximumSizeInBytes: size, validUntil: Date.now() + 3600_000 });
    return {
      method: "PUT",
      url: `${BLOB_API}/?${new URLSearchParams({ pathname: key }).toString()}`,
      headers: { authorization: `Bearer ${clientToken}`, "x-api-version": BLOB_API_VERSION, "x-content-type": mime },
      returnsUrl: true,
    };
  }

  publicUrl(key: string): string {
    return `https://${this.storeId.toLowerCase()}.public.blob.vercel-storage.com/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** True when `url` is this store's public URL of `key` (the client reports it after upload). */
  ownsUrl(url: string, key: string): boolean {
    try {
      return new URL(url).toString().toLowerCase() === this.publicUrl(key).toLowerCase();
    } catch {
      return false;
    }
  }

  async head(key: string) {
    const res = await fetch(this.publicUrl(key), { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new StorageError(`Blob HEAD failed: HTTP ${res.status}`);
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  async read(key: string, start: number, end: number): Promise<Uint8Array> {
    const res = await fetch(this.publicUrl(key), { headers: { range: `bytes=${start}-${end}` }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new StorageError(`Blob GET failed: HTTP ${res.status}`);
    return readAll(res);
  }

  async open(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(this.publicUrl(key), { headers: range ? { range: `bytes=${range.start}-${range.end}` } : {}, cache: "no-store", signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) throw new StorageError(`Blob GET failed: HTTP ${res.status}`);
    return res.body;
  }

  async put(key: string, body: Uint8Array, mime: string): Promise<void> {
    assertKey(key);
    const res = await fetch(`${BLOB_API}/?${new URLSearchParams({ pathname: key }).toString()}`, {
      method: "PUT",
      headers: this.headers({ "x-content-type": mime, "x-add-random-suffix": "0", "x-allow-overwrite": "1" }),
      body: Buffer.from(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new StorageError(`Blob PUT failed: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(`${BLOB_API}/delete`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ urls: [this.publicUrl(key)] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 404) throw new StorageError(`Blob delete failed: HTTP ${res.status}`);
  }
}

// ── Factory ──

/** The adapter for `driver` with the current settings (the media row's own driver for existing files). */
export async function getStorage(driver?: StorageDriver): Promise<StorageAdapter> {
  const settings = await getSettings();
  return createStorage(storageConfigFrom(settings), settings, driver);
}

export function createStorage(cfg: StorageConfig, settings: Settings, driver: StorageDriver = cfg.driver): StorageAdapter {
  if (driver === "s3") return new S3Storage(cfg.s3);
  if (driver === "blob") return new BlobStorage(cfg.blobToken);
  return new LocalStorage(settings);
}

export function isLocalStorage(adapter: StorageAdapter): adapter is LocalStorage {
  return adapter.driver === "local";
}

export function isBlobStorage(adapter: StorageAdapter): adapter is BlobStorage {
  return adapter.driver === "blob";
}

export type { LocalStorage, BlobStorage };
