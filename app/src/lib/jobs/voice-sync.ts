import "server-only";
import { pruneSimulatedEvents, pumpSimulatedCalls } from "@/lib/voice/sim-store";
import { agentsInOtherAccount, agentsNeedingSync, syncAgentNow } from "@/lib/voice/sync";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * voice-sync (every tick): delivers due simulated call events through the webhook ingest, then
 * (at most once a minute) moves agents whose copy is in another provider account than their
 * workspace uses now (plan changed, own keys removed…), retries agents whose provider sync is
 * pending or failed, and prunes old simulated events hourly.
 */

export const voiceSyncJob: Job = {
  name: "voice-sync",
  async run(ctx) {
    let n = await pumpSimulatedCalls({ deadline: ctx.deadline });
    if (await isDue("voice-sync", ctx)) {
      const moved = await agentsInOtherAccount(10);
      for (const id of [...moved, ...(await agentsNeedingSync(10)).filter((x) => !moved.includes(x))]) {
        if (Date.now() > ctx.deadline) break;
        await syncAgentNow(id, { notifyOnError: true });
        n++;
      }
      await scheduleNext("voice-sync", 60_000);
    }
    if (await isDue("voice-sim-prune", ctx)) {
      n += await pruneSimulatedEvents();
      await scheduleNext("voice-sim-prune", 3600_000);
    }
    return n;
  },
};
