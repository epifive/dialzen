import "server-only";
import { sql } from "kysely";
import { getDb } from "@/lib/db";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { claimLowBalanceAlert, getWallet } from "@/lib/wallet";
import { formatMicros } from "@/voice/format";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * low-balance (every 10 minutes): wallets below their alert level that weren't told yet (a
 * number rental or an admin adjustment can lower a balance without a call). Each wallet is
 * notified once until it is topped up above the level again (claimLowBalanceAlert); the call
 * ingest sends the same alert right after a charged call.
 */
const INTERVAL_MS = 10 * 60_000;

export const lowBalanceJob: Job = {
  name: "low-balance",
  async run(ctx) {
    if (!(await isDue("low-balance", ctx))) return 0;
    const db = await getDb();
    const rows = await db
      .selectFrom("wallets")
      .innerJoin("workspaces", "workspaces.id", "wallets.workspace_id")
      .innerJoin("users", "users.id", "workspaces.owner_id")
      .select(["wallets.workspace_id", "workspaces.name"])
      .where("users.status", "=", "active")
      .where("wallets.low_balance_micros", ">", 0)
      .where("wallets.balance_micros", "<", sql<number>`wallets.low_balance_micros`)
      .where("wallets.low_balance_notified_at", "is", null)
      .limit(100)
      .execute();
    const settings = await getSettings();
    let sent = 0;
    for (const r of rows) {
      if (Date.now() >= ctx.deadline) break;
      if (!(await claimLowBalanceAlert(r.workspace_id))) continue;
      const wallet = await getWallet(r.workspace_id);
      const ws = { id: r.workspace_id, name: r.name };
      const payload = await buildNotifyPayload(
        ws,
        "low_balance",
        `The call credit balance of ${r.name} is low: ${formatMicros(wallet.balanceMicros, settings.currency)}.`,
        { balance: formatMicros(wallet.balanceMicros, settings.currency), alert_level: formatMicros(wallet.lowBalanceMicros, settings.currency) },
        workspaceDashboardPath(r.workspace_id, "billing"),
      );
      await notifyWorkspace(r.workspace_id, payload, { ownerFallback: true });
      sent += 1;
    }
    await scheduleNext("low-balance", rows.length >= 100 ? 0 : INTERVAL_MS);
    return sent;
  },
};
