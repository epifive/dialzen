import "server-only";
import { autoRechargeJob } from "./auto-recharge";
import { campaignsJob } from "./campaigns";
import { dncExpiryJob } from "./dnc-expiry";
import { housekeepingJob } from "./housekeeping";
import { lowBalanceJob } from "./low-balance";
import { reconcileJob } from "./reconcile";
import { recordingsJob } from "./recordings";
import { retentionJob } from "./retention";
import { voiceSyncJob } from "./voice-sync";

/**
 * Background jobs run by the scheduler (src/lib/scheduler.ts) on every tick, in order,
 * while time is left in the tick's budget. A job does a small, idempotent slice of work
 * and returns how many items it handled; anything it can't finish is picked up next tick.
 * Jobs throttle themselves (settings rows "job_next:<name>", see ./shared.ts).
 */
export interface JobContext {
  /** Epoch ms after which a job should stop starting new work. */
  deadline: number;
  /** Who started the tick. */
  source: "cron" | "worker" | "lazy" | "manual";
}

export interface Job {
  /** Short id shown in Admin → System (e.g. "campaigns"). */
  name: string;
  run(ctx: JobContext): Promise<number>;
}

/**
 * Registered jobs, in the order they run. The voice jobs (campaign dialer, stale-call
 * reconciliation, recording copies and retention, wallet auto-recharge) are added here as they
 * are built; housekeeping stays last.
 */
export const JOBS: Job[] = [voiceSyncJob, campaignsJob, autoRechargeJob, lowBalanceJob, dncExpiryJob, retentionJob, recordingsJob, reconcileJob, housekeepingJob];
