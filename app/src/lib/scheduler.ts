import "server-only";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { JOBS, type JobContext } from "@/lib/jobs";

/**
 * The background scheduler. One "tick" runs the registered jobs (src/lib/jobs) within a
 * time budget: campaign dialing, call reconciliation, recordings, retention and housekeeping.
 * It is started by:
 *   - cron:   GET /api/cron/tick?key=SECRET (cPanel cron, Vercel cron, any pinger)
 *   - worker: `npm run worker` (calls the cron URL every 15 s)
 *   - lazy:   page views when no tick ran for a minute (setting `lazy_scheduler`)
 *   - manual: Admin → System → Run jobs now
 * A lock row in `settings` keeps ticks from overlapping.
 */

export type TickSource = JobContext["source"];

export interface TickSummary {
  source: TickSource;
  startedAt: string;
  /** Items handled per job, e.g. { campaigns: 12, housekeeping: 2 }. */
  jobs: Record<string, number>;
  /** Jobs that threw (their error is logged on the server). */
  failed: string[];
  /** Jobs not started because the time budget ran out. */
  skipped: string[];
  durationMs: number;
  /** Another tick was running: nothing was done. */
  skippedLocked: boolean;
}

const KEY = {
  lock: "scheduler_lock",
  lastTickAt: "scheduler_last_tick_at",
  lastSource: "scheduler_last_source",
  lastSummary: "scheduler_last_summary",
  cronSecret: "cron_secret",
} as const;

// ── settings rows that are not part of SETTING_DEFAULTS ──

export async function readRaw(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
  return row?.value ?? null;
}

export async function writeRaw(key: string, value: string | null): Promise<void> {
  const db = await getDb();
  const exists = await db.selectFrom("settings").select("key").where("key", "=", key).executeTakeFirst();
  if (exists) {
    await db.updateTable("settings").set({ value }).where("key", "=", key).execute();
    return;
  }
  try {
    await db.insertInto("settings").values({ key, value }).execute();
  } catch {
    await db.updateTable("settings").set({ value }).where("key", "=", key).execute();
  }
}

/** The example value shipped in ecosystem.config.cjs / docker-compose.yml: never accepted. */
const PLACEHOLDER_SECRET = "change-me-to-a-long-random-string";

function envSecret(): string {
  const value = process.env.CRON_SECRET?.trim() ?? "";
  return value && value !== PLACEHOLDER_SECRET && value.length >= 12 ? value : "";
}

/** Secret for /api/cron/tick: env CRON_SECRET, else one generated once and stored in settings. */
export async function getCronSecret(): Promise<string> {
  const fromEnv = envSecret();
  if (fromEnv) return fromEnv;
  const stored = await readRaw(KEY.cronSecret);
  if (stored) return stored;
  const secret = crypto.randomBytes(24).toString("base64url");
  const db = await getDb();
  try {
    await db.insertInto("settings").values({ key: KEY.cronSecret, value: secret }).execute();
    return secret;
  } catch {
    // Another request created it at the same moment.
    return (await readRaw(KEY.cronSecret)) ?? secret;
  }
}

/** Replace the stored secret (no effect while CRON_SECRET is set in the environment). */
export async function regenerateCronSecret(): Promise<string> {
  const secret = crypto.randomBytes(24).toString("base64url");
  await writeRaw(KEY.cronSecret, secret);
  return getCronSecret();
}

export function cronSecretFromEnv(): boolean {
  return Boolean(envSecret());
}

/** Constant-time comparison for the cron key. */
export async function isValidCronSecret(candidate: string | null | undefined): Promise<boolean> {
  if (!candidate) return false;
  const secret = await getCronSecret();
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function getLastTickAt(): Promise<string | null> {
  return readRaw(KEY.lastTickAt);
}

export interface SchedulerStatus {
  lastTickAt: string | null;
  lastSource: TickSource | null;
  lastSummary: TickSummary | null;
  locked: boolean;
  /** A tick finished in the last 3 minutes. */
  healthy: boolean;
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const [lastTickAt, lastSource, lastSummary, lock] = await Promise.all([
    readRaw(KEY.lastTickAt),
    readRaw(KEY.lastSource),
    readRaw(KEY.lastSummary),
    readRaw(KEY.lock),
  ]);
  let summary: TickSummary | null = null;
  try {
    summary = lastSummary ? (JSON.parse(lastSummary) as TickSummary) : null;
  } catch {
    summary = null;
  }
  return {
    lastTickAt,
    lastSource: (lastSource as TickSource | null) ?? null,
    lastSummary: summary,
    locked: Boolean(lock && lock > new Date().toISOString()),
    healthy: Boolean(lastTickAt && Date.now() - Date.parse(lastTickAt) < 3 * 60_000),
  };
}

// ── lock ──

async function acquireLock(ttlMs: number): Promise<string | null> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const until = new Date(Date.now() + ttlMs).toISOString();
  const exists = await db.selectFrom("settings").select("key").where("key", "=", KEY.lock).executeTakeFirst();
  if (!exists) {
    try {
      await db.insertInto("settings").values({ key: KEY.lock, value: until }).execute();
      return until;
    } catch {
      // Created concurrently: fall through to the atomic update.
    }
  }
  const result = await db
    .updateTable("settings")
    .set({ value: until })
    .where("key", "=", KEY.lock)
    .where((eb) => eb.or([eb("value", "is", null), eb("value", "=", ""), eb("value", "<", nowIso)]))
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1 ? until : null;
}

async function releaseLock(token: string): Promise<void> {
  const db = await getDb();
  await db.updateTable("settings").set({ value: null }).where("key", "=", KEY.lock).where("value", "=", token).execute();
}

const iso = (ms: number) => new Date(ms).toISOString();

export async function runTick({ budgetMs = 25_000, source }: { budgetMs?: number; source: TickSource }): Promise<TickSummary> {
  const started = Date.now();
  const summary: TickSummary = { source, startedAt: iso(started), jobs: {}, failed: [], skipped: [], durationMs: 0, skippedLocked: false };
  const lock = await acquireLock(budgetMs + 30_000);
  if (!lock) {
    summary.skippedLocked = true;
    summary.durationMs = Date.now() - started;
    return summary;
  }

  const ctx: JobContext = { deadline: started + budgetMs, source };
  try {
    for (const job of JOBS) {
      if (Date.now() >= ctx.deadline) {
        summary.skipped.push(job.name);
        continue;
      }
      try {
        summary.jobs[job.name] = await job.run(ctx);
      } catch (error) {
        summary.failed.push(job.name);
        console.error(`[dialzen] job "${job.name}" failed:`, error);
      }
    }
  } finally {
    summary.durationMs = Date.now() - started;
    try {
      await writeRaw(KEY.lastTickAt, iso(Date.now()));
      await writeRaw(KEY.lastSource, source);
      await writeRaw(KEY.lastSummary, JSON.stringify(summary));
    } finally {
      await releaseLock(lock).catch(() => undefined);
    }
  }
  return summary;
}
