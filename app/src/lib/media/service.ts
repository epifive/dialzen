import "server-only";
import crypto from "node:crypto";
import { sql } from "kysely";
import { sign, verifySignature } from "@/lib/crypto";
import { getDb, now } from "@/lib/db";
import type { MediaRow } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { DOCX_MIME, probeMedia, sniffMime, TEXT_MIMES } from "./probe";
import { downloadPublicFile } from "./remote";
import { getStorage, isBlobStorage, isStorageDriver, StorageError, type StorageAdapter, type StorageDriver, type UploadTarget } from "./storage";

/**
 * The media library of a workspace: knowledge-base documents, audio files and images (logos,
 * widget avatars). Upload tokens (init → browser upload → complete), validation of stored files
 * (real type from the magic bytes, image dimensions, audio duration), folders, deletion (refused
 * while a knowledge-base item uses the file) and streaming the bytes back (provider sync).
 */

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const AUDIO_MIMES = ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg", "audio/webm", "audio/flac"] as const;
export const DOCUMENT_MIMES = ["application/pdf", DOCX_MIME, ...TEXT_MIMES] as const;
export const ACCEPTED_MIMES: readonly string[] = [...IMAGE_MIMES, ...AUDIO_MIMES, ...DOCUMENT_MIMES];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "application/pdf": "pdf",
  [DOCX_MIME]: "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "html",
};
const MB = 1024 * 1024;
const TOKEN_TTL_MS = 2 * 3600_000;

export type MediaKind = "image" | "audio" | "document";

export function mediaKindOf(mime: string): MediaKind | null {
  if (!ACCEPTED_MIMES.includes(mime)) return null;
  return mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "document";
}

export interface MediaInfo {
  id: number;
  kind: MediaKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  /** Seconds (audio). */
  duration: number | null;
  altText: string;
  url: string;
}

export interface MediaItem extends MediaInfo {
  workspaceId: number;
  folderId: number | null;
  storage: StorageDriver;
  storageKey: string;
  filename: string;
  createdAt: string;
}

export interface MediaFolder {
  id: number;
  name: string;
  count: number;
}

export type MediaError =
  | "type"
  | "too_large"
  | "quota"
  | "folder"
  | "token"
  | "missing"
  | "invalid_file"
  | "in_use"
  | "not_found"
  | "storage"
  | "download";

export class MediaServiceError extends Error {
  constructor(
    readonly code: MediaError,
    message: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}

export function toMediaItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    folderId: row.folder_id,
    storage: isStorageDriver(row.storage) ? row.storage : "local",
    storageKey: row.storage_key,
    url: row.url,
    filename: row.filename,
    mime: row.mime,
    kind: row.kind,
    size: Number(row.size),
    width: row.width,
    height: row.height,
    duration: row.duration === null ? null : Number(row.duration),
    altText: row.alt_text,
    createdAt: row.created_at,
  };
}

// ── Limits ──

export interface MediaLimits {
  maxImageBytes: number;
  /** Documents and audio files. */
  maxFileBytes: number;
  /** 0 = unlimited. */
  quotaBytes: number;
}

export async function getMediaLimits(): Promise<MediaLimits> {
  const s = await getSettings();
  return {
    maxImageBytes: Math.max(1, Number(s.media_max_image_mb) || 10) * MB,
    maxFileBytes: Math.max(1, Number(s.media_max_file_mb) || 25) * MB,
    quotaBytes: Math.max(0, Number(s.media_quota_mb) || 0) * MB,
  };
}

/** Bytes stored in the media libraries of every workspace the owner owns. */
export async function mediaBytesUsed(ownerId: number): Promise<number> {
  const db = await getDb();
  const row = await db
    .selectFrom("media as m")
    .innerJoin("workspaces as w", "w.id", "m.workspace_id")
    .select((eb) => eb.fn.sum<number>("m.size").as("bytes"))
    .where("w.owner_id", "=", ownerId)
    .executeTakeFirst();
  return Number(row?.bytes ?? 0);
}

function sizeCap(limits: MediaLimits, mime: string): number {
  return mime.startsWith("image/") ? limits.maxImageBytes : limits.maxFileBytes;
}

// ── Upload tokens ──

interface UploadClaims {
  /** workspace id */
  w: number;
  /** user id (null = API key without a user) */
  u: number | null;
  /** storage key */
  k: string;
  /** declared MIME */
  m: string;
  /** largest size accepted */
  s: number;
  /** storage driver at init time */
  d: StorageDriver;
  /** folder id */
  f: number | null;
  /** original file name */
  n: string;
  /** expiry (epoch ms) */
  e: number;
}

async function encodeToken(claims: UploadClaims): Promise<string> {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${await sign(body, "media-upload")}`;
}

/** The claims of a valid, unexpired upload token, else null. */
export async function readUploadToken(token: string): Promise<UploadClaims | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig || !(await verifySignature(body, sig, "media-upload"))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadClaims;
    if (typeof claims.e !== "number" || claims.e < Date.now() || !isStorageDriver(claims.d)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** "My Photo (1).JPG" → "my-photo-1" (ASCII, safe in keys and URLs). */
export function slugFilename(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const slug = base
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "file";
}

export function newStorageKey(workspaceId: number, filename: string, mime: string, at = new Date()): string {
  const month = `${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  return `w${workspaceId}/${month}/${crypto.randomBytes(5).toString("hex")}-${slugFilename(filename)}.${EXT[mime] ?? "bin"}`;
}

async function checkFolder(workspaceId: number, folderId: number | null | undefined): Promise<number | null> {
  if (!folderId) return null;
  const db = await getDb();
  const row = await db.selectFrom("media_folders").select("id").where("id", "=", folderId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!row) throw new MediaServiceError("folder", "This folder no longer exists.");
  return row.id;
}

async function checkQuota(ownerId: number, adding: number, limits: MediaLimits): Promise<void> {
  if (!limits.quotaBytes) return;
  const used = await mediaBytesUsed(ownerId);
  if (used + adding > limits.quotaBytes) throw new MediaServiceError("quota", "The media library is full.", { used, limit: limits.quotaBytes });
}

function checkType(mime: string, size: number, limits: MediaLimits): void {
  if (!ACCEPTED_MIMES.includes(mime)) throw new MediaServiceError("type", "Upload a document (PDF, Word, TXT, Markdown, CSV, HTML), an audio file (MP3, WAV, M4A, OGG, WebM, FLAC) or an image (JPEG, PNG, WebP, GIF).", { mime });
  const cap = sizeCap(limits, mime);
  if (size > cap) throw new MediaServiceError("too_large", "The file is too large.", { max: Math.round(cap / MB) });
}

export interface InitUploadInput {
  workspace: { id: number; ownerId: number };
  userId: number | null;
  filename: string;
  mime: string;
  size: number;
  folderId?: number | null;
}

/** Step 1: checks type, size and quota, and returns where the browser must send the file. */
export async function initUpload(input: InitUploadInput): Promise<{ token: string; key: string; upload: UploadTarget; driver: StorageDriver }> {
  const mime = input.mime.toLowerCase().split(";")[0].trim();
  const size = Math.floor(Number(input.size));
  if (!Number.isFinite(size) || size <= 0) throw new MediaServiceError("invalid_file", "The file is empty.");
  const limits = await getMediaLimits();
  checkType(mime, size, limits);
  await checkQuota(input.workspace.ownerId, size, limits);
  const folderId = await checkFolder(input.workspace.id, input.folderId);
  let adapter: StorageAdapter;
  try {
    adapter = await getStorage();
  } catch (error) {
    throw new MediaServiceError("storage", error instanceof Error ? error.message : "Storage isn't configured.");
  }
  const key = newStorageKey(input.workspace.id, input.filename, mime);
  const token = await encodeToken({ w: input.workspace.id, u: input.userId, k: key, m: mime, s: size, d: adapter.driver, f: folderId, n: input.filename.slice(0, 200), e: Date.now() + TOKEN_TTL_MS });
  return { token, key, upload: await adapter.uploadTarget(key, mime, size, token), driver: adapter.driver };
}

/** Real type, dimensions and duration of a stored file (null mime = not an accepted file). */
async function inspectStored(adapter: StorageAdapter, key: string, size: number, declared: string) {
  return probeMedia((start, end) => adapter.read(key, start, Math.min(end, size - 1)), size, declared);
}

async function insertMedia(values: {
  workspaceId: number;
  userId: number | null;
  folderId: number | null;
  driver: StorageDriver;
  key: string;
  url: string;
  filename: string;
  mime: string;
  kind: MediaKind;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  altText: string;
}): Promise<MediaItem> {
  const db = await getDb();
  const res = await db
    .insertInto("media")
    .values({
      workspace_id: values.workspaceId,
      folder_id: values.folderId,
      uploaded_by: values.userId,
      storage: values.driver,
      storage_key: values.key,
      url: values.url,
      filename: values.filename.slice(0, 255) || "file",
      mime: values.mime,
      kind: values.kind,
      size: values.size,
      width: values.width,
      height: values.height,
      duration: values.duration,
      alt_text: values.altText.slice(0, 1500),
      created_at: now(),
    })
    .executeTakeFirstOrThrow();
  const row = await db.selectFrom("media").selectAll().where("id", "=", Number(res.insertId)).executeTakeFirstOrThrow();
  return toMediaItem(row);
}

/** Validates bytes already in storage and records them; deletes the file when it isn't acceptable. */
async function recordStored(
  adapter: StorageAdapter,
  claims: Pick<UploadClaims, "w" | "u" | "k" | "m" | "f" | "n">,
  options: { altText?: string; maxBytes: number; url?: string },
): Promise<MediaItem> {
  const head = await adapter.head(claims.k).catch(() => null);
  if (!head || head.size <= 0) throw new MediaServiceError("missing", "The upload didn't arrive. Try again.");
  const reject = async (code: MediaError, message: string, params: Record<string, string | number> = {}) => {
    await adapter.delete(claims.k).catch(() => undefined);
    throw new MediaServiceError(code, message, params);
  };
  if (head.size > options.maxBytes) await reject("too_large", "The file is too large.", { max: Math.round(options.maxBytes / MB) });
  const info = await inspectStored(adapter, claims.k, head.size, claims.m).catch(() => null);
  const mime = info?.mime ?? null;
  const kind = mime ? mediaKindOf(mime) : null;
  if (!info || !mime || !kind) return reject("invalid_file", "This file isn't a supported document, audio file or image.");
  // The declared type must match what the bytes are (an image can't become a document).
  if (mediaKindOf(claims.m) !== kind) return reject("invalid_file", "This file isn't a supported document, audio file or image.");
  if (kind === "image" && (!info.width || !info.height)) return reject("invalid_file", "This image couldn't be read.");
  return insertMedia({
    workspaceId: claims.w,
    userId: claims.u,
    folderId: claims.f,
    driver: adapter.driver,
    key: claims.k,
    url: options.url ?? adapter.publicUrl(claims.k),
    filename: claims.n,
    mime,
    kind,
    size: head.size,
    width: info.width,
    height: info.height,
    duration: info.duration,
    altText: options.altText ?? "",
  });
}

/**
 * Step 3: after the browser uploaded the file, checks it and adds it to the library. Calling it
 * twice with the same token returns the same item.
 */
export async function completeUpload(input: { token: string; workspaceId: number; userId: number | null; altText?: string; blobUrl?: string }): Promise<MediaItem> {
  const claims = await readUploadToken(input.token);
  if (!claims || claims.w !== input.workspaceId || (claims.u !== null && claims.u !== input.userId)) throw new MediaServiceError("token", "This upload expired. Upload the file again.");
  const db = await getDb();
  const existing = await db.selectFrom("media").selectAll().where("workspace_id", "=", claims.w).where("storage_key", "=", claims.k).executeTakeFirst();
  if (existing) return toMediaItem(existing);
  let adapter: StorageAdapter;
  try {
    adapter = await getStorage(claims.d);
  } catch (error) {
    throw new MediaServiceError("storage", error instanceof Error ? error.message : "Storage isn't configured.");
  }
  const limits = await getMediaLimits();
  const url = isBlobStorage(adapter) && input.blobUrl && adapter.ownsUrl(input.blobUrl, claims.k) ? input.blobUrl : undefined;
  return recordStored(adapter, claims, { altText: input.altText, maxBytes: Math.min(sizeCap(limits, claims.m), Math.max(claims.s, 1) * 1.05 + 1024), url });
}

/** Server-side add (CSV imports, API): stores `bytes` and records them. */
export async function storeMediaBytes(input: { workspace: { id: number; ownerId: number }; userId: number | null; bytes: Uint8Array; filename: string; folderId?: number | null; altText?: string; mime?: string }): Promise<MediaItem> {
  const mime = sniffMime(input.bytes.subarray(0, 64 * 1024), input.mime ?? "");
  const limits = await getMediaLimits();
  if (!mime) throw new MediaServiceError("invalid_file", "This file isn't a supported document, audio file or image.");
  checkType(mime, input.bytes.byteLength, limits);
  await checkQuota(input.workspace.ownerId, input.bytes.byteLength, limits);
  const folderId = await checkFolder(input.workspace.id, input.folderId);
  let adapter: StorageAdapter;
  try {
    adapter = await getStorage();
  } catch (error) {
    throw new MediaServiceError("storage", error instanceof Error ? error.message : "Storage isn't configured.");
  }
  const key = newStorageKey(input.workspace.id, input.filename, mime);
  try {
    await adapter.put(key, input.bytes, mime);
  } catch (error) {
    throw new MediaServiceError("storage", error instanceof StorageError ? error.message : "The file couldn't be stored.");
  }
  return recordStored(adapter, { w: input.workspace.id, u: input.userId, k: key, m: mime, f: folderId, n: input.filename || "file" }, { altText: input.altText, maxBytes: sizeCap(limits, mime) });
}

/** Downloads a public URL into the library (SSRF-safe, size-capped). */
export async function importMediaFromUrl(input: { workspace: { id: number; ownerId: number }; userId: number | null; url: string; folderId?: number | null }): Promise<MediaItem> {
  const limits = await getMediaLimits();
  // Imports run inside a request: keep them reasonably small.
  const cap = Math.min(Math.max(limits.maxImageBytes, limits.maxFileBytes), 100 * MB);
  let file;
  try {
    file = await downloadPublicFile(input.url, cap);
  } catch (error) {
    throw new MediaServiceError("download", error instanceof Error ? error.message : "The file couldn't be downloaded.");
  }
  return storeMediaBytes({ workspace: input.workspace, userId: input.userId, bytes: file.bytes, filename: file.filename || "import", folderId: input.folderId });
}

// ── Library queries ──

export interface MediaListFilter {
  /** undefined = all folders, null = root only. */
  folderId?: number | null;
  q?: string;
  kind?: MediaKind | "";
  limit?: number;
  offset?: number;
}

export async function listMedia(workspaceId: number, filter: MediaListFilter = {}): Promise<{ items: MediaItem[]; total: number }> {
  const db = await getDb();
  let q = db.selectFrom("media").where("workspace_id", "=", workspaceId);
  if (filter.folderId === null) q = q.where("folder_id", "is", null);
  else if (filter.folderId) q = q.where("folder_id", "=", filter.folderId);
  if (filter.kind) q = q.where("kind", "=", filter.kind);
  const term = (filter.q ?? "").trim().slice(0, 100).replace(/[%_\\]/g, "");
  if (term) q = q.where((eb) => eb.or([eb("filename", "like", `%${term}%`), eb("alt_text", "like", `%${term}%`)]));
  const [rows, count] = await Promise.all([
    q
      .selectAll()
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.min(filter.limit ?? 60, 500))
      .offset(filter.offset ?? 0)
      .execute(),
    q.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
  ]);
  return { items: rows.map(toMediaItem), total: Number(count?.n ?? 0) };
}

/** Library items by id (other workspaces' ids are left out), in the order of `ids`. */
export async function getMediaItems(workspaceId: number, ids: number[]): Promise<MediaItem[]> {
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!clean.length) return [];
  const db = await getDb();
  const rows = await db.selectFrom("media").selectAll().where("workspace_id", "=", workspaceId).where("id", "in", clean).execute();
  const byId = new Map(rows.map((r) => [r.id, toMediaItem(r)]));
  return clean.map((id) => byId.get(id)).filter((m): m is MediaItem => Boolean(m));
}

export async function listFolders(workspaceId: number): Promise<MediaFolder[]> {
  const db = await getDb();
  const [folders, counts] = await Promise.all([
    db.selectFrom("media_folders").select(["id", "name"]).where("workspace_id", "=", workspaceId).orderBy("name").execute(),
    db.selectFrom("media").select(["folder_id", (eb) => eb.fn.countAll<number>().as("n")]).where("workspace_id", "=", workspaceId).groupBy("folder_id").execute(),
  ]);
  const byFolder = new Map(counts.map((c) => [c.folder_id, Number(c.n)]));
  return folders.map((f) => ({ id: f.id, name: f.name, count: byFolder.get(f.id) ?? 0 }));
}

export const MAX_FOLDERS = 100;

export async function createFolder(workspaceId: number, name: string): Promise<number> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) throw new MediaServiceError("folder", "Enter a folder name.");
  const db = await getDb();
  const count = await db.selectFrom("media_folders").select((eb) => eb.fn.countAll<number>().as("n")).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (Number(count?.n ?? 0) >= MAX_FOLDERS) throw new MediaServiceError("folder", "Too many folders.");
  const res = await db.insertInto("media_folders").values({ workspace_id: workspaceId, parent_id: null, name: clean, created_at: now() }).executeTakeFirstOrThrow();
  return Number(res.insertId);
}

export async function renameFolder(workspaceId: number, folderId: number, name: string): Promise<boolean> {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!clean) return false;
  const db = await getDb();
  const res = await db.updateTable("media_folders").set({ name: clean }).where("id", "=", folderId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

/** Deletes a folder; its items move to the root. */
export async function deleteFolder(workspaceId: number, folderId: number): Promise<boolean> {
  const db = await getDb();
  return db.transaction().execute(async (trx) => {
    await trx.updateTable("media").set({ folder_id: null }).where("workspace_id", "=", workspaceId).where("folder_id", "=", folderId).execute();
    const res = await trx.deleteFrom("media_folders").where("id", "=", folderId).where("workspace_id", "=", workspaceId).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  });
}

export async function updateMediaItem(workspaceId: number, mediaId: number, input: { altText?: string; folderId?: number | null; filename?: string }): Promise<boolean> {
  const db = await getDb();
  const folderId = input.folderId === undefined ? undefined : await checkFolder(workspaceId, input.folderId);
  const res = await db
    .updateTable("media")
    .set({
      ...(input.altText !== undefined ? { alt_text: input.altText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, 1500) } : {}),
      ...(folderId !== undefined ? { folder_id: folderId } : {}),
      ...(input.filename !== undefined && input.filename.trim() ? { filename: input.filename.trim().slice(0, 255) } : {}),
    })
    .where("id", "=", mediaId)
    .where("workspace_id", "=", workspaceId)
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

/** Media ids → ids of the knowledge-base items that use them (they block deletion). */
export async function mediaInUse(workspaceId: number, ids: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  const clean = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (!clean.length) return out;
  const db = await getDb();
  const rows = await db.selectFrom("kb_items").select(["id", "media_id"]).where("workspace_id", "=", workspaceId).where("media_id", "in", clean).execute();
  for (const r of rows) if (r.media_id) out.set(r.media_id, [...(out.get(r.media_id) ?? []), r.id]);
  return out;
}

/** Deletes library items (and their files). Items used by a knowledge-base item are refused. */
export async function deleteMedia(workspaceId: number, ids: number[]): Promise<{ deleted: number; blocked: number[] }> {
  const items = await getMediaItems(workspaceId, ids);
  if (!items.length) return { deleted: 0, blocked: [] };
  const inUse = await mediaInUse(workspaceId, items.map((i) => i.id));
  const removable = items.filter((i) => !inUse.has(i.id));
  if (removable.length) {
    const db = await getDb();
    await db.deleteFrom("media").where("workspace_id", "=", workspaceId).where("id", "in", removable.map((i) => i.id)).execute();
    const adapters = new Map<StorageDriver, StorageAdapter | null>();
    for (const item of removable) {
      if (!adapters.has(item.storage)) adapters.set(item.storage, await getStorage(item.storage).catch(() => null));
      await adapters
        .get(item.storage)
        ?.delete(item.storageKey)
        .catch((error: unknown) => console.error(`[dialzen] media file ${item.storageKey} could not be deleted:`, error));
    }
  }
  return { deleted: removable.length, blocked: [...inUse.keys()] };
}

/**
 * Removes the stored files of every library item and call recording of a workspace (call it before
 * deleteWorkspaceData() in src/lib/workspaces.ts, which deletes the rows). Best effort.
 */
export async function deleteWorkspaceMediaFiles(workspaceId: number): Promise<number> {
  const db = await getDb();
  const media = await db.selectFrom("media").select(["storage", "storage_key"]).where("workspace_id", "=", workspaceId).execute();
  // Call recordings copied into the storage (recordings/ prefix, not in the media table).
  const recordings = await db
    .selectFrom("calls")
    .select(["recording_storage as storage", "recording_key as storage_key"])
    .where("workspace_id", "=", workspaceId)
    .where("recording_key", "is not", null)
    .where("recording_deleted_at", "is", null)
    .execute();
  const rows = [...media, ...recordings.filter((r): r is { storage: string; storage_key: string } => Boolean(r.storage_key)).map((r) => ({ storage: r.storage ?? "local", storage_key: r.storage_key }))];
  const adapters = new Map<StorageDriver, StorageAdapter | null>();
  let removed = 0;
  for (const row of rows) {
    const driver = isStorageDriver(row.storage) ? row.storage : "local";
    if (!adapters.has(driver)) adapters.set(driver, await getStorage(driver).catch(() => null));
    const ok = await adapters
      .get(driver)
      ?.delete(row.storage_key)
      .then(() => true)
      .catch(() => false);
    if (ok) removed += 1;
  }
  return removed;
}

// ── Reading files back (provider sync of knowledge-base documents) ──

/** Opens a stored file as a stream (`range.end` EXCLUSIVE; reads past the end are truncated). */
export async function openMediaItem(item: Pick<MediaItem, "storage" | "storageKey" | "size">, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
  const adapter = await getStorage(item.storage);
  return adapter.open(item.storageKey, range ? { start: Math.max(0, range.start), end: Math.min(item.size, range.end) - 1 } : undefined);
}

/** Total media count of a workspace (dashboard, demo checks). */
export async function countMedia(workspaceId: number): Promise<number> {
  const db = await getDb();
  const row = await db.selectFrom("media").select(sql<number>`count(*)`.as("n")).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return Number(row?.n ?? 0);
}
