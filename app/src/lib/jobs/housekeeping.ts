import "server-only";
import { cleanupExpiredSessions } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * housekeeping (hourly): expired sessions and password reset links, expired workspace invites,
 * notification log rows older than 90 days, and webhook idempotency records older than 30 days
 * (providers stop retrying long before that).
 */

const INTERVAL_MS = 60 * 60_000;
const ALERT_LOG_DAYS = 90;
const WEBHOOK_EVENT_DAYS = 30;

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export const housekeepingJob: Job = {
  name: "housekeeping",
  async run(ctx) {
    if (!(await isDue("housekeeping", ctx))) return 0;
    const db = await getDb();
    await cleanupExpiredSessions();
    const results = await Promise.all([
      db.deleteFrom("alert_log").where("created_at", "<", ago(ALERT_LOG_DAYS)).executeTakeFirst(),
      db.deleteFrom("workspace_invites").where("expires_at", "<", new Date().toISOString()).executeTakeFirst(),
      db.deleteFrom("webhook_events").where("received_at", "<", ago(WEBHOOK_EVENT_DAYS)).executeTakeFirst(),
    ]);
    await scheduleNext("housekeeping", INTERVAL_MS);
    return results.reduce((n, r) => n + Number(r.numDeletedRows ?? 0), 0);
  },
};
