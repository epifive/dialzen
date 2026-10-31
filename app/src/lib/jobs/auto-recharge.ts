import "server-only";
import { auditSafe } from "@/lib/audit";
import { getDb, now } from "@/lib/db";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "@/lib/notify";
import { enabledGateways } from "@/lib/payments";
import { chargeSavedCard } from "@/lib/payments/credits";
import { getSettings } from "@/lib/settings";
import { toWalletRecord } from "@/lib/wallet";
import { formatMicros } from "@/voice/format";
import type { Job } from "./index";
import { isDue, scheduleNext } from "./shared";

/**
 * auto-recharge (every 5 minutes): wallets with automatic recharge on whose balance fell below
 * the threshold. With Stripe enabled and a card saved by an earlier card purchase, the card is
 * charged off-session and the credits are added; otherwise (or when the charge fails) the
 * workspace gets a reminder to buy credits. One attempt per wallet every few hours.
 */
const INTERVAL_MS = 5 * 60_000;
/** Minimum time between two attempts for the same wallet. */
export const RECHARGE_RETRY_MS = 6 * 3600_000;

export const autoRechargeJob: Job = {
  name: "auto-recharge",
  async run(ctx) {
    if (!(await isDue("auto-recharge", ctx))) return 0;
    const db = await getDb();
    const settings = await getSettings();
    const stripe = enabledGateways(settings).includes("stripe");
    const since = new Date(Date.now() - RECHARGE_RETRY_MS).toISOString();
    const rows = await db
      .selectFrom("wallets")
      .innerJoin("workspaces", "workspaces.id", "wallets.workspace_id")
      .innerJoin("users", "users.id", "workspaces.owner_id")
      .selectAll("wallets")
      .select("workspaces.name")
      // Banned owners' cards are never charged.
      .where("users.status", "=", "active")
      .where("wallets.auto_recharge", "like", '%"enabled":true%')
      .where((eb) => eb.or([eb("wallets.auto_recharge_at", "is", null), eb("wallets.auto_recharge_at", "<", since)]))
      .limit(200)
      .execute();
    let handled = 0;
    for (const row of rows) {
      if (Date.now() >= ctx.deadline) break;
      const wallet = toWalletRecord(row);
      const ar = wallet.autoRecharge;
      if (!ar.enabled || ar.amountMicros <= 0 || wallet.balanceMicros >= ar.thresholdMicros) continue;
      // Claim the attempt (concurrent ticks: one wins).
      let claim = db.updateTable("wallets").set({ auto_recharge_at: now() }).where("workspace_id", "=", wallet.workspaceId);
      claim = row.auto_recharge_at === null ? claim.where("auto_recharge_at", "is", null) : claim.where("auto_recharge_at", "=", row.auto_recharge_at);
      if (Number((await claim.executeTakeFirst()).numUpdatedRows) !== 1) continue;
      handled += 1;
      const ws = { id: wallet.workspaceId, name: row.name };
      const amount = formatMicros(ar.amountMicros, settings.currency);
      if (stripe) {
        const res = await chargeSavedCard({ workspaceId: wallet.workspaceId, amountCents: Math.round(ar.amountMicros / 10_000), currency: settings.currency, description: `${settings.site_name} call credits (automatic recharge)` });
        await auditSafe({ workspaceId: wallet.workspaceId, actor: { type: "system", id: null }, action: res.ok ? "credits.auto_recharged" : "credits.auto_recharge_failed", entityType: "wallet", entityId: wallet.workspaceId, data: res.ok ? { micros: ar.amountMicros, payment: res.paymentId, status: res.status } : { reason: res.reason, message: res.message } });
        if (res.ok) continue;
        const payload = await buildNotifyPayload(
          ws,
          "low_balance",
          `Automatic recharge of ${amount} for ${row.name} didn't go through (${res.message}). Buy call credits to keep your agents calling.`,
          { balance: formatMicros(wallet.balanceMicros, settings.currency), recharge: amount, reason: res.reason },
          workspaceDashboardPath(wallet.workspaceId, "billing"),
        );
        await notifyWorkspace(wallet.workspaceId, payload, { ownerFallback: true });
        continue;
      }
      await auditSafe({ workspaceId: wallet.workspaceId, actor: { type: "system", id: null }, action: "credits.recharge_reminder", entityType: "wallet", entityId: wallet.workspaceId, data: { balance: wallet.balanceMicros, threshold: ar.thresholdMicros } });
      const payload = await buildNotifyPayload(
        ws,
        "low_balance",
        `The call credits of ${row.name} fell below ${formatMicros(ar.thresholdMicros, settings.currency)} (now ${formatMicros(wallet.balanceMicros, settings.currency)}). Buy a ${amount} credit pack to recharge.`,
        { balance: formatMicros(wallet.balanceMicros, settings.currency), recharge: amount, reason: "reminder" },
        workspaceDashboardPath(wallet.workspaceId, "billing"),
      );
      await notifyWorkspace(wallet.workspaceId, payload, { ownerFallback: true });
    }
    await scheduleNext("auto-recharge", INTERVAL_MS);
    return handled;
  },
};
