import "server-only";
import { getDb } from "@/lib/db";
import type { JobContext } from "./index";

/**
 * Helpers shared by the background jobs: time-zone aware days and a throttle stored in
 * `settings` rows (keys "job_next:<name>"), so expensive checks don't run on every
 * 15-second worker tick. A manual run (Admin → System → Run jobs now) ignores throttles.
 */

// ── days in a time zone ──

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    dtfCache.set(timeZone, f);
  }
  return f;
}

function parts(ms: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, min: out.minute, s: out.second };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar day ("YYYY-MM-DD") of an instant in a time zone. */
export function localDay(ms: number, timeZone: string): string {
  const p = parts(ms, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Local time minus UTC, in ms, at an instant. */
function offsetAt(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** UTC instant (ms) of local midnight at the start of `day` in `timeZone`. */
export function dayStartMs(day: string, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let result = guess - offsetAt(guess, timeZone);
  // Second pass for days where the offset changes (DST) between the guess and the result.
  result = guess - offsetAt(result, timeZone);
  return result;
}

/** UTC ISO bounds [start, end) of a local day. */
export function dayBoundsIso(day: string, timeZone: string): { start: string; end: string } {
  return { start: new Date(dayStartMs(day, timeZone)).toISOString(), end: new Date(dayStartMs(addDays(day, 1), timeZone)).toISOString() };
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday for a "YYYY-MM-DD" day. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

/** First day of the month before/after: monthStart("2026-10-17", -1) → "2026-09-01". */
export function monthStart(day: string, offsetMonths = 0): string {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offsetMonths, 1)).toISOString().slice(0, 10);
}

// ── throttle ──

async function readKey(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst())?.value ?? null;
}

export async function writeKey(key: string, value: string): Promise<void> {
  const db = await getDb();
  const updated = await db.updateTable("settings").set({ value }).where("key", "=", key).executeTakeFirst();
  if (Number(updated.numUpdatedRows) > 0) return;
  const exists = await db.selectFrom("settings").select("key").where("key", "=", key).executeTakeFirst();
  if (exists) return; // MySQL reports 0 changed rows when the value is unchanged.
  try {
    await db.insertInto("settings").values({ key, value }).execute();
  } catch {
    await db.updateTable("settings").set({ value }).where("key", "=", key).execute();
  }
}

/** True when the job `name` is due (its throttle expired, or the run is manual). */
export async function isDue(name: string, ctx: JobContext): Promise<boolean> {
  if (ctx.source === "manual") return true;
  const next = await readKey(`job_next:${name}`);
  return !next || next <= new Date().toISOString();
}

/** Run `name` again in `ms` (0 = on the next tick, e.g. when work is left). */
export async function scheduleNext(name: string, ms: number): Promise<void> {
  await writeKey(`job_next:${name}`, new Date(Date.now() + ms).toISOString());
}

/** Split a list into chunks (keeps IN (...) lists and multi-row inserts small). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
