import "server-only";
import { auditSafe } from "@/lib/audit";
import { getDb, now } from "@/lib/db";
import { getStorage, isStorageDriver } from "@/lib/media/storage";
import { DEFAULT_COMPLIANCE, normalizeComplianceSettings, parseJson } from "@/voice/normalize";
import type { Job } from "./index";
import { chunk, isDue, scheduleNext } from "./shared";

/**
 * retention (hourly): deletes call recordings and transcripts older than each workspace's
 * retention (Compliance → Recording: recordingRetentionDays / transcriptRetentionDays, 0 = keep).
 * Recordings are removed from storage and the call keeps a "deleted" mark; transcripts and
 * summaries are cleared, the extracted data stays. Audited per workspace and run.
 */
const INTERVAL_MS = 60 * 60_000;
const BATCH = 200;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export const retentionJob: Job = {
  name: "retention",
  async run(ctx) {
    if (!(await isDue("retention", ctx))) return 0;
    const db = await getDb();
    const [workspaces, saved] = await Promise.all([
      db.selectFrom("workspaces").select("id").execute(),
      db.selectFrom("compliance_settings").select(["workspace_id", "settings"]).execute(),
    ]);
    const settingsOf = new Map(saved.map((s) => [s.workspace_id, normalizeComplianceSettings(parseJson(s.settings))]));
    let handled = 0;
    let more = false;
    for (const ws of workspaces) {
      if (Date.now() >= ctx.deadline) {
        more = true;
        break;
      }
      const s = settingsOf.get(ws.id) ?? DEFAULT_COMPLIANCE;
      let recordings = 0;
      let transcripts = 0;
      if (s.recordingRetentionDays > 0) {
        const rows = await db
          .selectFrom("calls")
          .select(["id", "recording_storage", "recording_key"])
          .where("workspace_id", "=", ws.id)
          .where("recording_deleted_at", "is", null)
          .where((eb) => eb.or([eb("recording_key", "is not", null), eb("recording_url", "is not", null)]))
          .where("created_at", "<", ago(s.recordingRetentionDays))
          .limit(BATCH)
          .execute();
        if (rows.length >= BATCH) more = true;
        for (const r of rows) {
          if (r.recording_key && r.recording_storage && isStorageDriver(r.recording_storage)) {
            try {
              await (await getStorage(r.recording_storage)).delete(r.recording_key);
            } catch (error) {
              console.error(`[dialzen] retention: could not delete the recording of call ${r.id}:`, error);
              continue;
            }
          }
          await db.updateTable("calls").set({ recording_deleted_at: now(), recording_url: null, updated_at: now() }).where("id", "=", r.id).execute();
          recordings += 1;
        }
      }
      if (s.transcriptRetentionDays > 0) {
        const ids = (
          await db
            .selectFrom("calls")
            .select("id")
            .where("workspace_id", "=", ws.id)
            .where((eb) => eb.or([eb("transcript", "is not", null), eb("summary", "is not", null)]))
            .where("created_at", "<", ago(s.transcriptRetentionDays))
            .limit(BATCH * 2)
            .execute()
        ).map((r) => r.id);
        if (ids.length >= BATCH * 2) more = true;
        for (const part of chunk(ids, 200)) {
          await db.updateTable("calls").set({ transcript: null, summary: null, updated_at: now() }).where("id", "in", part).execute();
        }
        transcripts = ids.length;
      }
      if (recordings || transcripts) {
        handled += recordings + transcripts;
        await auditSafe({ workspaceId: ws.id, actor: { type: "system", id: null }, action: "retention.purged", entityType: "workspace", entityId: ws.id, data: { recordings, transcripts, recordingDays: s.recordingRetentionDays, transcriptDays: s.transcriptRetentionDays } });
      }
    }
    await scheduleNext("retention", more ? 0 : INTERVAL_MS);
    return handled;
  },
};
