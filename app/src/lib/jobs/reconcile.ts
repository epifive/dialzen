import "server-only";
import { writeRaw } from "@/lib/scheduler";
import { getSettings } from "@/lib/settings";
import { chargeMonthlyRentals } from "@/lib/voice/numbers";
import { reconcileLiveCalls, reconcileRecentCalls } from "@/lib/voice/reconcile";
import { expireIdleWebCalls } from "@/lib/voice/web-call";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * reconcile:
 * - nightly (every 24 h, setting voice_reconcile): compares the last 48 hours of calls with the
 *   providers' records (missed webhooks, duration and cost drift, stuck calls); the summary is kept
 *   in the settings row "voice_reconcile_last" for Admin → Voice providers
 * - hourly: charges the month's rental of bought phone numbers once per number and month
 * - every minute: ends browser calls without activity for 5 minutes (expireIdleWebCalls)
 * - every 10 minutes: asks the providers about phone calls still live without news for 10
 *   minutes (reconcileLiveCalls: missed final webhooks are completed and billed)
 */

export const reconcileJob: Job = {
  name: "reconcile",
  async run(ctx) {
    let n = 0;
    if (await isDue("number-rentals", ctx)) {
      n += await chargeMonthlyRentals();
      await scheduleNext("number-rentals", 3600_000);
    }
    // Browser calls left without activity, and phone calls whose final webhook is late.
    if (await isDue("web-idle", ctx)) {
      const idle = await expireIdleWebCalls({ deadline: ctx.deadline });
      n += idle.ended + idle.canceled;
      await scheduleNext("web-idle", 60_000);
    }
    if (await isDue("live-calls", ctx)) {
      const live = await reconcileLiveCalls({ deadline: ctx.deadline });
      n += live.completed + live.failed;
      await scheduleNext("live-calls", 10 * 60_000);
    }
    if (await isDue("reconcile", ctx)) {
      const settings = await getSettings();
      if (settings.voice_reconcile) {
        const summary = await reconcileRecentCalls({ hours: 48, deadline: ctx.deadline });
        await writeRaw("voice_reconcile_last", JSON.stringify({ at: new Date().toISOString(), ...summary }));
        n += summary.completed + summary.drift + summary.failed;
      }
      await scheduleNext("reconcile", 24 * 3600_000);
    }
    return n;
  },
};
