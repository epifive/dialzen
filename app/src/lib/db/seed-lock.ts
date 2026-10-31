import "server-only";
import type { Kysely } from "kysely";
import type { Database } from "./schema";

/**
 * A settings row used as a once-per-database lock for the demo seeders.
 *
 *   pending:<iso>  an instance is seeding right now (started at <iso>)
 *   <iso>          seeding finished at <iso>; nothing more to do
 *
 * A process can be killed mid-seed (a serverless timeout, a crashed build
 * worker) and leave "pending:" behind. Once that is older than STALE_MS another
 * instance takes it over; the swap is conditional on the old value, so only one
 * of several instances racing for a stale lock wins.
 */
const PENDING = "pending:";
const STALE_MS = 10 * 60_000;

export type SeedLock = { key: string; token: string };

export async function acquireSeedLock(db: Kysely<Database>, key: string): Promise<SeedLock | null> {
  const token = `${PENDING}${new Date().toISOString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.insertInto("settings").values({ key, value: token }).execute();
      return { key, token };
    } catch {
      // The row exists: seeded already, being seeded, or abandoned.
    }
    const row = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
    if (!row) continue; // released between our insert and select; try once more
    const value = row.value ?? "";
    if (!value.startsWith(PENDING)) return null;
    const started = Date.parse(value.slice(PENDING.length));
    if (Number.isFinite(started) && Date.now() - started < STALE_MS) return null;
    const res = await db.updateTable("settings").set({ value: token }).where("key", "=", key).where("value", "=", value).executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) return null;
    console.warn(`[dialzen] took over a stale ${key} lock (${value})`);
    return { key, token };
  }
  return null;
}

/** Mark seeding as finished. */
export async function finishSeedLock(db: Kysely<Database>, lock: SeedLock): Promise<void> {
  await db.updateTable("settings").set({ value: new Date().toISOString() }).where("key", "=", lock.key).where("value", "=", lock.token).execute();
}

/** Give the lock up after a failure, so the next request tries again. */
export async function releaseSeedLock(db: Kysely<Database>, lock: SeedLock): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", lock.key).where("value", "=", lock.token).execute().catch(() => undefined);
}
