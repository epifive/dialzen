import "server-only";
import crypto from "node:crypto";
import { toCallRecord, updateCall, type CallRecord } from "@/lib/calls";
import { sign, verifySignature } from "@/lib/crypto";
import { getDb, now } from "@/lib/db";
import { getStorage, getStorageConfig, type StorageDriver } from "@/lib/media/storage";
import { callAccountContext, getWorkspaceKeys } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { isProvider } from "@/voice/normalize";
import { LIVE_CALL_STATUSES, type RecordingStream } from "@/voice/types";
import { callById, RECORDING_VIA_API } from "./ingest";
import "./index";

/**
 * Call recordings: copied from the provider into the site's media storage under the
 * "recordings/" prefix (never served by the public file route) by the "recordings" job, and
 * streamed to members through /api/voice/recordings/<callId> with a short-lived signed URL. With
 * copies off, or on Vercel Blob (public files), the route streams the provider's audio instead.
 */

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_ATTEMPTS = 6;
const SIGN_PURPOSE = "call-recording";

const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/webm": "webm" };

export function recordingKey(call: Pick<CallRecord, "id" | "workspaceId">, mime: string, at = new Date()): string {
  const month = `${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  return `recordings/w${call.workspaceId}/${month}/${call.id}-${crypto.randomBytes(6).toString("hex")}.${EXT[mime.split(";")[0].trim()] ?? "mp3"}`;
}

async function readLimited(stream: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The recording is larger than allowed.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The provider's audio of a call (null when there is none, or its account's keys are gone). */
export async function providerRecording(call: CallRecord): Promise<RecordingStream | null> {
  if (!call.providerCallId) return null;
  const resolved = await callAccountContext(call, 60_000);
  if (!resolved) return null;
  return resolved.provider.fetchRecording(resolved.ctx, call.providerCallId);
}

/**
 * Where a call's recording can be played from: a stored copy, the provider, "unavailable" (it is
 * only in a provider account whose keys were removed) or "none".
 */
export async function recordingAvailability(call: CallRecord): Promise<"stored" | "provider" | "unavailable" | "none"> {
  if (call.recordingDeletedAt) return "none";
  if (call.recording) return "stored";
  if (!call.recordingUrl) return "none";
  if (call.keySource === "byo" && isProvider(call.provider) && call.provider !== "simulated" && !(await getWorkspaceKeys(call.workspaceId, call.provider))) return "unavailable";
  return "provider";
}

/** Copies one call's recording into storage. "copied", "none" (nothing to copy) or throws (retried later). */
export async function copyRecording(call: CallRecord): Promise<"copied" | "none"> {
  if (call.recording || call.recordingDeletedAt) return "none";
  const audio = await providerRecording(call);
  if (!audio) {
    await updateCall(call.id, { recording_url: null });
    return "none";
  }
  const bytes = await readLimited(audio.body, MAX_BYTES);
  if (!bytes.byteLength) {
    await updateCall(call.id, { recording_url: null });
    return "none";
  }
  const storage = await getStorage();
  const key = recordingKey(call, audio.mime);
  await storage.put(key, bytes, audio.mime.split(";")[0].trim() || "audio/mpeg");
  await updateCall(call.id, { recording_storage: storage.driver, recording_key: key });
  return "copied";
}

/** Calls with a recording waiting to be copied (ended in the last 7 days). */
async function pendingRecordings(limit: number): Promise<CallRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("calls")
    .selectAll()
    .where("recording_url", "is not", null)
    .where("recording_key", "is", null)
    .where("recording_deleted_at", "is", null)
    .where("status", "not in", [...LIVE_CALL_STATUSES])
    .where("ended_at", ">", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .orderBy("ended_at")
    .limit(limit)
    .execute();
  return rows.map(toCallRecord);
}

/** The "recordings" job's work: copies pending recordings, retrying failures a few times. */
export async function copyPendingRecordings(options: { limit?: number; deadline?: number } = {}): Promise<number> {
  const settings = await getSettings();
  if (!settings.voice_copy_recordings) return 0;
  // Vercel Blob files are public: recordings are never copied there, they keep streaming from the
  // provider through the signed /api/voice/recordings route.
  if ((await getStorageConfig()).driver === "blob") return 0;
  let copied = 0;
  for (const call of await pendingRecordings(options.limit ?? 10)) {
    if (options.deadline && Date.now() > options.deadline) break;
    const attempts = Number(call.metadata.recording_attempts ?? 0);
    try {
      if ((await copyRecording(call)) === "copied") copied++;
    } catch (error) {
      const next = attempts + 1;
      const fresh = await callById(call.id);
      const meta = { ...(fresh?.metadata ?? call.metadata), recording_attempts: next, recording_error: error instanceof Error ? error.message.slice(0, 300) : "copy failed" };
      // Give up after a few tries (the provider may have deleted it); the player then falls back to the provider.
      await updateCall(call.id, { metadata: JSON.stringify(meta), ...(next >= MAX_ATTEMPTS ? { recording_url: null } : {}) });
    }
  }
  return copied;
}

// ── Signed playback URLs ──

/** A short-lived URL of a call's recording for the player (members only; checked again by the route). */
export async function recordingUrlFor(call: Pick<CallRecord, "id" | "workspaceId">, ttlSec = 3600): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await sign(`${call.workspaceId}.${call.id}.${exp}`, SIGN_PURPOSE);
  return `/api/voice/recordings/${call.id}?exp=${exp}&sig=${sig}`;
}

export async function verifyRecordingSignature(call: Pick<CallRecord, "id" | "workspaceId">, exp: string, sig: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!/^\d{1,12}$/.test(exp) || !sig || Number(exp) < nowSec) return false;
  return verifySignature(`${call.workspaceId}.${call.id}.${exp}`, sig, SIGN_PURPOSE);
}

/** True when the call has audio to play (copied, or still at the provider). */
export function hasRecording(call: CallRecord): boolean {
  return Boolean(call.recording) || (Boolean(call.recordingUrl) && !call.recordingDeletedAt);
}

/** Deletes a stored recording (retention / workspace request). */
export async function deleteRecording(call: CallRecord): Promise<void> {
  if (call.recording) {
    const storage = await getStorage(call.recording.storage as StorageDriver);
    await storage.delete(call.recording.key).catch(() => undefined);
  }
  await updateCall(call.id, { recording_deleted_at: now(), recording_url: null });
}

export { RECORDING_VIA_API };
