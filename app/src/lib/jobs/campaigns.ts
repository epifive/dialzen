import "server-only";
import { runCampaignEngine } from "@/lib/campaigns/engine";
import type { Job } from "./index";

/**
 * campaigns (every tick): the outbound dialer (src/lib/campaigns/engine.ts). It is lease-based,
 * so it may also run at the same time from /api/cron/campaigns (a faster dialer cron) or the
 * dashboard's Start button. Returns the calls placed.
 */
export const campaignsJob: Job = {
  name: "campaigns",
  async run(ctx) {
    // Leave a little of the tick for the jobs after this one.
    const deadline = Math.max(Date.now() + 1000, ctx.deadline - 2000);
    const res = await runCampaignEngine({ deadline });
    return res.dialed + res.skipped + res.ended;
  },
};
