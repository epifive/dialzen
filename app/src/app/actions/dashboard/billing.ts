"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { auditSafe } from "@/lib/audit";
import { createCreditPayment, creditPacks, offlineRef, pendingOfflineCreditPayment } from "@/lib/billing";
import { guardWorkspace } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { enabledGateways, type Gateway } from "@/lib/payments";
import { createStripeCreditCheckout } from "@/lib/payments/credits";
import { createPaypalOrder } from "@/lib/payments/paypal";
import { createRazorpayLink } from "@/lib/payments/razorpay";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { baseUrl } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import { saveWalletOptions } from "@/lib/wallet";
import { toMicros } from "@/voice/normalize";
import type { FormState } from "../types";
import { decimalOf, str } from "./helpers";

/**
 * Call credits (Workspace → Billing): buy a credit pack through the site's payment gateways
 * (payments.purpose = "credits"), automatic recharge and the low-balance alert. Needs
 * billing.manage (admins).
 */

export async function buyCreditsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "billing.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ws = guard.workspace;
  if (!rateLimit(`dz-credits:${guard.user.id}:${await clientIp()}`, 10, 10 * 60_000)) return { error: t("dash.billing.err.rate") };
  const settings = await getSettings();
  const amount = decimalOf(fd.get("amount"));
  if (!creditPacks(settings).includes(amount)) return { error: t("dash.billing.err.pack") };
  const gateway = str(fd.get("gateway")) as Gateway;
  if (!enabledGateways(settings).includes(gateway)) return { error: t("dash.billing.err.gateway") };
  const cents = Math.round(amount * 100);
  const currency = settings.currency;
  const base = await baseUrl();
  const billing = `${base}/dashboard/w/${ws.id}/billing`;
  const product = t("dash.billing.productName", { site: settings.site_name, workspace: ws.name });
  let destination: string;
  try {
    if (gateway === "stripe") {
      const db = await getDb();
      const user = await db.selectFrom("users").select(["id", "email", "stripe_customer_id"]).where("id", "=", guard.user.id).executeTakeFirstOrThrow();
      destination = await createStripeCreditCheckout({ user, workspace: ws, amountCents: cents, currency, baseUrl: base, productName: product });
    } else if (gateway === "paypal") {
      const order = await createPaypalOrder({ amount: cents, currency, description: product, customId: crypto.randomUUID(), returnUrl: `${base}/api/payments/paypal/return`, cancelUrl: `${billing}?checkout=cancelled` });
      await createCreditPayment({ userId: guard.user.id, workspaceId: ws.id, amountCents: cents, currency, provider: "paypal", providerRef: `paypal:${order.id}` });
      destination = order.approveUrl;
    } else if (gateway === "razorpay") {
      const link = await createRazorpayLink({ amount: cents, currency, description: product, referenceId: crypto.randomBytes(12).toString("hex"), customer: { name: guard.user.name, email: guard.user.email }, callbackUrl: `${base}/api/payments/razorpay/callback` });
      await createCreditPayment({ userId: guard.user.id, workspaceId: ws.id, amountCents: cents, currency, provider: "razorpay", providerRef: `razorpay:${link.id}` });
      destination = link.url;
    } else {
      const reference = str(fd.get("reference")).trim();
      if (reference.length < 3 || reference.length > 190) return { error: t("dash.billing.err.reference") };
      if (await pendingOfflineCreditPayment(ws.id)) return { error: t("dash.billing.err.pendingTransfer") };
      await createCreditPayment({ userId: guard.user.id, workspaceId: ws.id, amountCents: cents, currency, provider: "offline", providerRef: offlineRef(), note: reference });
      await auditSafe({ workspaceId: ws.id, actor: { type: "user", id: guard.user.id }, action: "credits.transfer_submitted", entityType: "wallet", entityId: ws.id, data: { cents, currency } });
      return { success: t("dash.billing.transferSubmitted") };
    }
  } catch (error) {
    return { error: t("dash.billing.err.gatewayFailed", { message: error instanceof Error ? error.message : "" }) };
  }
  redirect(destination);
}

export async function saveWalletOptionsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "billing.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const settings = await getSettings();
  const enabled = fd.get("auto_enabled") === "on";
  const threshold = decimalOf(fd.get("threshold"));
  const amount = decimalOf(fd.get("auto_amount"));
  const low = decimalOf(fd.get("low_balance"));
  if (!Number.isFinite(low) || low < 0 || low > 100_000) return { error: t("dash.billing.err.amount") };
  if (enabled) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100_000) return { error: t("dash.billing.err.amount") };
    if (!creditPacks(settings).includes(amount)) return { error: t("dash.billing.err.pack") };
  }
  await saveWalletOptions(guard.workspace.id, {
    autoRecharge: { enabled, thresholdMicros: Number.isFinite(threshold) ? toMicros(threshold) : 0, amountMicros: Number.isFinite(amount) ? toMicros(amount) : 0 },
    lowBalanceMicros: toMicros(low),
  });
  // A new setting deserves a fresh attempt.
  const db = await getDb();
  await db.updateTable("wallets").set({ auto_recharge_at: null }).where("workspace_id", "=", guard.workspace.id).execute();
  await auditSafe({ workspaceId: guard.workspace.id, actor: { type: "user", id: guard.user.id }, action: "credits.options_saved", entityType: "wallet", entityId: guard.workspace.id, data: { autoRecharge: enabled, threshold, amount, lowBalance: low } });
  return { success: t("dash.billing.optionsSaved") };
}
