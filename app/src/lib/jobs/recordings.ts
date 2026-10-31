import "server-only";
import { copyPendingRecordings } from "@/lib/voice/recordings";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/** recordings (every minute): copies finished calls' recordings from the provider into media storage (recordings/ prefix). */

export const recordingsJob: Job = {
  name: "recordings",
  async run(ctx) {
    if (!(await isDue("recordings", ctx))) return 0;
    const copied = await copyPendingRecordings({ limit: 10, deadline: ctx.deadline });
    // More may be waiting: come back on the next tick when this run was busy.
    await scheduleNext("recordings", copied >= 10 ? 0 : 60_000);
    return copied;
  },
};
