import "server-only";
import { auditSafe } from "./audit";
import { getDb, now } from "./db";
import type { KbItemRow } from "./db/schema";
import { deleteMedia, getMediaItems, openMediaItem, type MediaItem } from "./media/service";
import { parsePublicUrl } from "./net/ssrf";
import { str, text } from "@/voice/normalize";
import type { KbDoc, KbKind, KbStatus } from "@/voice/types";

/**
 * Knowledge-base items of an agent (Agents → Knowledge): uploaded documents (PDF, Word, TXT,
 * Markdown through the media library), web pages (URLs) and text snippets. An item with
 * agent_id null is shared by every agent of the workspace.
 *
 * Items start "pending"; the provider sync (src/lib/voice/sync.ts) uploads them and sets
 * "ready" (or "error" with the provider's message). Plain-text files keep their text in
 * `content` so providers and the post-call analysis can use it without reading storage.
 */

export const MAX_KB_ITEMS = 50;
/** Characters of a text snippet (and of text extracted from TXT / Markdown files). */
export const MAX_KB_TEXT = 100_000;
const TEXT_FILE_MIMES = ["text/plain", "text/markdown", "text/csv", "text/html"];
/** Document types accepted for the knowledge base. */
export const KB_FILE_MIMES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ...TEXT_FILE_MIMES];

export interface KbItemRecord {
  id: number;
  workspaceId: number;
  /** null = shared with every agent. */
  agentId: number | null;
  kind: KbKind;
  name: string;
  url: string | null;
  mediaId: number | null;
  /** Characters of text held (snippets, extracted text). */
  textLength: number;
  sizeBytes: number;
  provider: string | null;
  providerDocId: string | null;
  status: KbStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toKbItemRecord(row: KbItemRow): KbItemRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    kind: row.kind,
    name: row.name,
    url: row.url,
    mediaId: row.media_id,
    textLength: row.content?.length ?? 0,
    sizeBytes: Number(row.size_bytes),
    provider: row.provider,
    providerDocId: row.provider_doc_id,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The agent's own items and the workspace's shared ones, oldest first. */
export async function listKbItems(workspaceId: number, agentId: number): Promise<KbItemRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("kb_items")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .where((eb) => eb.or([eb("agent_id", "=", agentId), eb("agent_id", "is", null)]))
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map(toKbItemRecord);
}

export async function getKbItem(workspaceId: number, itemId: number): Promise<KbItemRecord | undefined> {
  if (!Number.isInteger(itemId) || itemId < 1) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("kb_items").selectAll().where("id", "=", itemId).where("workspace_id", "=", workspaceId).executeTakeFirst();
  return row ? toKbItemRecord(row) : undefined;
}

export type KbInput = { kind: "text"; name: string; text: string } | { kind: "url"; url: string; name?: string } | { kind: "file"; mediaId: number; name?: string };

export type AddKbResult = { ok: true; item: KbItemRecord } | { ok: false; error: "limit" | "name" | "text" | "url" | "file" | "file_type" | "duplicate" };

async function readTextFile(item: MediaItem): Promise<string> {
  const stream = await openMediaItem(item, { start: 0, end: Math.min(item.size, MAX_KB_TEXT * 4) });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return text(new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), MAX_KB_TEXT);
}

/**
 * Adds an item to an agent's knowledge base (`shared` = to every agent of the workspace) and
 * marks the agents that use it for re-sync.
 */
export async function addKbItem(workspaceId: number, agentId: number, input: KbInput, userId: number | null, shared = false): Promise<AddKbResult> {
  const db = await getDb();
  const count = await db
    .selectFrom("kb_items")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("workspace_id", "=", workspaceId)
    .where((eb) => eb.or([eb("agent_id", "=", agentId), eb("agent_id", "is", null)]))
    .executeTakeFirst();
  if (Number(count?.n ?? 0) >= MAX_KB_ITEMS) return { ok: false, error: "limit" };

  let values: { kind: KbKind; name: string; url: string | null; media_id: number | null; content: string | null; size_bytes: number };
  if (input.kind === "text") {
    const name = str(input.name, "", 190);
    if (!name) return { ok: false, error: "name" };
    const body = text(input.text, MAX_KB_TEXT);
    if (!body.trim()) return { ok: false, error: "text" };
    values = { kind: "text", name, url: null, media_id: null, content: body, size_bytes: Buffer.byteLength(body) };
  } else if (input.kind === "url") {
    let url: URL;
    try {
      url = parsePublicUrl(input.url);
    } catch {
      return { ok: false, error: "url" };
    }
    const href = url.toString().slice(0, 2000);
    const dup = await db.selectFrom("kb_items").select("id").where("workspace_id", "=", workspaceId).where("url", "=", href).where((eb) => eb.or([eb("agent_id", "=", agentId), eb("agent_id", "is", null)])).executeTakeFirst();
    if (dup) return { ok: false, error: "duplicate" };
    values = { kind: "url", name: str(input.name, "", 190) || `${url.host}${url.pathname === "/" ? "" : url.pathname}`.slice(0, 190), url: href, media_id: null, content: null, size_bytes: 0 };
  } else {
    const [media] = await getMediaItems(workspaceId, [input.mediaId]);
    if (!media) return { ok: false, error: "file" };
    if (!KB_FILE_MIMES.includes(media.mime)) return { ok: false, error: "file_type" };
    const content = TEXT_FILE_MIMES.includes(media.mime) ? await readTextFile(media).catch(() => null) : null;
    values = { kind: "file", name: str(input.name, "", 190) || media.filename.slice(0, 190), url: null, media_id: media.id, content, size_bytes: media.size };
  }
  const ts = now();
  const res = await db
    .insertInto("kb_items")
    .values({ workspace_id: workspaceId, agent_id: shared ? null : agentId, ...values, provider: null, provider_doc_id: null, status: "pending", error: null, created_at: ts, updated_at: ts })
    .executeTakeFirstOrThrow();
  await markKbAgentsPending(workspaceId, shared ? null : agentId);
  const item = (await getKbItem(workspaceId, Number(res.insertId)))!;
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "kb.added", entityType: "kb_item", entityId: item.id, data: { kind: item.kind, name: item.name, agentId: item.agentId } });
  return { ok: true, item };
}

/** Agents whose knowledge changed: one agent, or every agent of the workspace (shared items). */
async function markKbAgentsPending(workspaceId: number, agentId: number | null): Promise<void> {
  const db = await getDb();
  let q = db.updateTable("agents").set({ sync_status: "pending", updated_at: now() }).where("workspace_id", "=", workspaceId);
  if (agentId !== null) q = q.where("id", "=", agentId);
  await q.execute();
}

/**
 * Deletes an item and its uploaded file (when no other item uses it). Returns the deleted item
 * so the caller can remove the provider's copy (best effort).
 */
export async function deleteKbItem(workspaceId: number, itemId: number, userId: number | null): Promise<KbItemRecord | undefined> {
  const item = await getKbItem(workspaceId, itemId);
  if (!item) return undefined;
  const db = await getDb();
  await db.deleteFrom("kb_items").where("id", "=", itemId).where("workspace_id", "=", workspaceId).execute();
  if (item.mediaId) await deleteMedia(workspaceId, [item.mediaId]).catch(() => undefined);
  await markKbAgentsPending(workspaceId, item.agentId);
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "kb.deleted", entityType: "kb_item", entityId: itemId, data: { kind: item.kind, name: item.name } });
  return item;
}

/** Sync result of one item (provider sync). */
export async function markKbItem(itemId: number, result: { status: KbStatus; provider?: string | null; providerDocId?: string | null; error?: string | null }): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("kb_items")
    .set({
      status: result.status,
      ...(result.provider !== undefined ? { provider: result.provider } : {}),
      ...(result.providerDocId !== undefined ? { provider_doc_id: result.providerDocId } : {}),
      error: result.error ? result.error.slice(0, 1000) : null,
      updated_at: now(),
    })
    .where("id", "=", itemId)
    .execute();
}

/** The agent's knowledge as the provider adapters receive it (files are opened lazily). */
export async function kbDocsForAgent(workspaceId: number, agentId: number): Promise<KbDoc[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("kb_items")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .where((eb) => eb.or([eb("agent_id", "=", agentId), eb("agent_id", "is", null)]))
    .orderBy("id")
    .execute();
  const media = new Map((await getMediaItems(workspaceId, rows.map((r) => r.media_id ?? 0).filter(Boolean))).map((m) => [m.id, m]));
  return rows.map((row) => {
    const file = row.media_id ? media.get(row.media_id) : undefined;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      url: row.url ?? "",
      text: row.content ?? "",
      file: file ? { filename: file.filename, mime: file.mime, size: file.size, open: () => openMediaItem(file) } : null,
      providerDocId: row.provider_doc_id,
    };
  });
}
