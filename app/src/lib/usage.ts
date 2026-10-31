import "server-only";
import { sql } from "kysely";
import { getDb } from "./db";
import type { Entitlements } from "./plans";

/**
 * Monthly usage per account (usage_monthly, UTC month), always booked on the workspace OWNER:
 * - seconds_used: billed call seconds covered by the plan's included minutes
 *   (included_minutes_monthly × 60). Seconds beyond that are paid from the workspace wallet
 *   (src/lib/wallet.ts); they are not counted here.
 * - calls: calls finished this month (all directions, all of the owner's workspaces).
 * - ai_requests: AI prompt assistant requests (the plan's max_ai_monthly).
 * Agents, numbers and members are limits on what exists, not on usage: see src/lib/agents.ts,
 * src/lib/numbers.ts and src/lib/workspaces.ts.
 */

export interface MonthlyUsage {
  secondsUsed: number;
  calls: number;
  aiRequests: number;
}

export type UsageCounter = keyof MonthlyUsage;

const COLUMN: Record<UsageCounter, "seconds_used" | "calls" | "ai_requests"> = {
  secondsUsed: "seconds_used",
  calls: "calls",
  aiRequests: "ai_requests",
};

/** "YYYY-MM" of an instant (UTC). */
export function usageMonth(at: Date | number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 7);
}

export async function getUsage(userId: number, month = usageMonth()): Promise<MonthlyUsage> {
  const db = await getDb();
  const row = await db.selectFrom("usage_monthly").select(["seconds_used", "calls", "ai_requests"]).where("user_id", "=", userId).where("month", "=", month).executeTakeFirst();
  return { secondsUsed: Number(row?.seconds_used ?? 0), calls: Number(row?.calls ?? 0), aiRequests: Number(row?.ai_requests ?? 0) };
}

async function ensureRow(userId: number, month: string): Promise<void> {
  const db = await getDb();
  const exists = await db.selectFrom("usage_monthly").select("user_id").where("user_id", "=", userId).where("month", "=", month).executeTakeFirst();
  if (exists) return;
  try {
    await db.insertInto("usage_monthly").values({ user_id: userId, month, seconds_used: 0, calls: 0, ai_requests: 0, quota_alerts: null }).execute();
  } catch {
    // Created by a concurrent request in the meantime.
  }
}

/** Add to this month's counters (creates the row on first use). Negative deltas are allowed (corrections); counters never go below 0. */
export async function incrementUsage(userId: number, delta: Partial<MonthlyUsage>, month = usageMonth()): Promise<void> {
  const entries = (Object.keys(COLUMN) as UsageCounter[]).map((k) => [COLUMN[k], Math.trunc(delta[k] ?? 0)] as const).filter(([, n]) => n !== 0);
  if (!entries.length) return;
  await ensureRow(userId, month);
  const db = await getDb();
  const set = Object.fromEntries(entries.map(([col, n]) => [col, n >= 0 ? sql`${sql.ref(col)} + ${n}` : sql`CASE WHEN ${sql.ref(col)} + ${n} < 0 THEN 0 ELSE ${sql.ref(col)} + ${n} END`]));
  await db.updateTable("usage_monthly").set(set).where("user_id", "=", userId).where("month", "=", month).execute();
}

/** Included seconds left this month (Infinity when the plan's minutes are unlimited). */
export async function includedSecondsLeft(ownerId: number, entitlements: Pick<Entitlements, "includedMinutesMonthly">, month = usageMonth()): Promise<number> {
  if (entitlements.includedMinutesMonthly < 0) return Infinity;
  const usage = await getUsage(ownerId, month);
  return Math.max(0, entitlements.includedMinutesMonthly * 60 - usage.secondsUsed);
}

/**
 * Takes up to `seconds` from the owner's included minutes of the month, atomically (a
 * compare-and-set UPDATE per attempt, so two calls ending at the same moment can't both use the
 * last minute). Returns the seconds taken (0 when the allowance is used up); the rest is paid
 * from the wallet.
 */
export async function consumeIncludedSeconds(ownerId: number, seconds: number, entitlements: Pick<Entitlements, "includedMinutesMonthly">, month = usageMonth()): Promise<number> {
  const want = Math.max(0, Math.floor(seconds));
  if (!want) return 0;
  await ensureRow(ownerId, month);
  const db = await getDb();
  if (entitlements.includedMinutesMonthly < 0) {
    await db.updateTable("usage_monthly").set({ seconds_used: sql`seconds_used + ${want}` }).where("user_id", "=", ownerId).where("month", "=", month).execute();
    return want;
  }
  const cap = entitlements.includedMinutesMonthly * 60;
  // Optimistic: read, then update only if nobody changed the row meanwhile. Every round lets at
  // least one contender through, so this converges quickly.
  for (let attempt = 0; attempt < 50; attempt++) {
    const row = await db.selectFrom("usage_monthly").select("seconds_used").where("user_id", "=", ownerId).where("month", "=", month).executeTakeFirst();
    const used = Number(row?.seconds_used ?? 0);
    const take = Math.min(want, Math.max(0, cap - used));
    if (!take) return 0;
    const res = await db
      .updateTable("usage_monthly")
      .set({ seconds_used: sql`seconds_used + ${take}` })
      .where("user_id", "=", ownerId)
      .where("month", "=", month)
      .where("seconds_used", "=", used)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 1) return take;
  }
  return 0;
}
