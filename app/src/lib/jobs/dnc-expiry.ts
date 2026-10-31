import "server-only";
import { expireDncEntries } from "@/lib/dnc";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * dnc-expiry (hourly): deletes do-not-call entries whose end date passed (uploaded national-list
 * copies, temporary blocks). The dial-time check already ignores them; this keeps the lists tidy
 * and records the expiry in the audit log. Opt-outs and internal entries have no end date.
 */
const INTERVAL_MS = 60 * 60_000;

export const dncExpiryJob: Job = {
  name: "dnc-expiry",
  async run(ctx) {
    if (!(await isDue("dnc-expiry", ctx))) return 0;
    const expired = await expireDncEntries();
    const total = [...expired.values()].reduce((a, b) => a + b, 0);
    await scheduleNext("dnc-expiry", total >= 2000 ? 0 : INTERVAL_MS);
    return total;
  },
};
