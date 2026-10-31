import "server-only";
import { after } from "next/server";
import { isInstalled } from "@/lib/config";
import { getSettings } from "@/lib/settings";

/**
 * "Lazy" scheduler for hosts without cron: when the app serves a page and no tick ran for a
 * minute, run one scheduler tick (campaigns, call reconciliation, retention, housekeeping)
 * after the response is sent.
 * Call `maybeLazyTick()` from layouts / route handlers. It never throws and
 * never delays the response.
 */

const THROTTLE_MS = 15_000;
const STALE_MS = 60_000;
const BUDGET_MS = 8_000;

const globalForLazy = globalThis as unknown as { __dialzenLazy?: { lastAttempt: number; running: boolean } };

export function maybeLazyTick(): void {
  try {
    const state = (globalForLazy.__dialzenLazy ??= { lastAttempt: 0, running: false });
    if (state.running || Date.now() - state.lastAttempt < THROTTLE_MS) return;
    if (!isInstalled()) return;
    state.lastAttempt = Date.now();
    after(async () => {
      if (state.running) return;
      state.running = true;
      try {
        const settings = await getSettings();
        if (!settings.lazy_scheduler) return;
        const { getLastTickAt, runTick } = await import("@/lib/scheduler");
        const last = await getLastTickAt();
        if (last && Date.now() - Date.parse(last) < STALE_MS) return;
        await runTick({ budgetMs: BUDGET_MS, source: "lazy" });
      } catch (error) {
        console.error("[dialzen] lazy scheduler tick failed:", error);
      } finally {
        state.running = false;
      }
    });
  } catch {
    // after() is unavailable outside a request (e.g. during a static build): skip.
  }
}
