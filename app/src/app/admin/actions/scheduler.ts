"use server";

import { revalidatePath } from "next/cache";
import { guardAdmin } from "@/lib/admin";
import { cronSecretFromEnv, regenerateCronSecret, runTick } from "@/lib/scheduler";
import type { FormState } from "@/app/actions/types";

export async function runChecksNow(): Promise<FormState> {
  const guard = await guardAdmin({ allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const s = await runTick({ budgetMs: 25_000, source: "manual" });
  revalidatePath("/admin/system");
  if (s.skippedLocked) return { error: "Another run is in progress. Try again in a minute." };
  return {
    success: `Ran ${Object.keys(s.jobs).length} job${Object.keys(s.jobs).length === 1 ? "" : "s"} in ${(s.durationMs / 1000).toFixed(1)} s${s.failed.length ? ` (failed: ${s.failed.join(", ")})` : ""}${s.skipped.length ? ` (left for the next run: ${s.skipped.join(", ")})` : ""}.`,
  };
}

export async function regenerateCronKey(): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  // Same rule as the page: short or example CRON_SECRET values are ignored, so the stored secret is in use.
  if (cronSecretFromEnv()) return { error: "The secret comes from the CRON_SECRET environment variable. Change it there." };
  await regenerateCronSecret();
  revalidatePath("/admin/system");
  return { success: "New secret created. Update your cron job and worker with the new URL." };
}
