"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, now } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { createPendingPayment, enabledGateways, planPrice, type Gateway } from "@/lib/payments";
import { createPaypalOrder } from "@/lib/payments/paypal";
import { createRazorpayLink } from "@/lib/payments/razorpay";
import { cancelStripeSubscription, createStripeCheckout } from "@/lib/payments/stripe";
import { getPlan } from "@/lib/plans";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { baseUrl } from "@/lib/request";
import { getSettings } from "@/lib/settings";
import type { FormState } from "./types";

const checkoutSchema = z.object({
  plan_id: z.coerce.number().int().positive(),
  cycle: z.enum(["monthly", "yearly"]),
  gateway: z.enum(["stripe", "paypal", "razorpay", "offline"]),
});

/** Start a purchase with the chosen gateway and redirect the buyer to pay. */
export async function startCheckout(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const parsed = checkoutSchema.safeParse({
    plan_id: formData.get("plan_id"),
    cycle: formData.get("cycle"),
    gateway: formData.get("gateway"),
  });
  if (!parsed.success) return { error: t("checkout.err.choose") };
  const { plan_id, cycle, gateway } = parsed.data;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/checkout?plan=${plan_id}&cycle=${cycle}`)}`);

  const ip = await clientIp();
  if (!rateLimit(`checkout:${user.id}:${ip}`, 10, 10 * 60_000)) {
    return { error: t("checkout.err.tooMany") };
  }

  const settings = await getSettings();
  if (!enabledGateways(settings).includes(gateway as Gateway)) return { error: t("checkout.err.methodUnavailable") };
  const plan = await getPlan(plan_id);
  if (!plan || !plan.is_active || plan.is_free) return { error: t("checkout.err.planUnavailable") };
  if (planPrice(plan, cycle) <= 0) return { error: t("checkout.err.periodUnavailable") };

  const base = await baseUrl();
  let destination: string;
  try {
    if (gateway === "stripe") {
      destination = await createStripeCheckout({ user, plan, cycle, currency: settings.currency, baseUrl: base });
    } else if (gateway === "paypal") {
      const reference = crypto.randomUUID();
      const order = await createPaypalOrder({
        amount: planPrice(plan, cycle),
        currency: settings.currency,
        description: `${settings.site_name} ${plan.name} (${cycle})`,
        customId: reference,
        returnUrl: `${base}/api/payments/paypal/return`,
        cancelUrl: `${base}/pricing?checkout=cancelled`,
      });
      await createPendingPayment({ userId: user.id, plan, cycle, currency: settings.currency, provider: "paypal", providerRef: `paypal:${order.id}` });
      destination = order.approveUrl;
    } else if (gateway === "razorpay") {
      const reference = crypto.randomBytes(12).toString("hex");
      const link = await createRazorpayLink({
        amount: planPrice(plan, cycle),
        currency: settings.currency,
        description: `${settings.site_name} ${plan.name} (${cycle})`,
        referenceId: reference,
        customer: { name: user.name, email: user.email },
        callbackUrl: `${base}/api/payments/razorpay/callback`,
      });
      await createPendingPayment({ userId: user.id, plan, cycle, currency: settings.currency, provider: "razorpay", providerRef: `razorpay:${link.id}` });
      destination = link.url;
    } else {
      destination = `/checkout/offline?plan=${plan.id}&cycle=${cycle}`;
    }
  } catch (e) {
    return {
      error: e instanceof Error ? t("checkout.err.startFailedDetail", { message: e.message }) : t("checkout.err.startFailed"),
    };
  }
  redirect(destination);
}

export async function submitOfflinePayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const [user, t] = await Promise.all([getCurrentUser(), getT()]);
  if (!user) return { error: t("auth.err.sessionExpired") };
  const settings = await getSettings();
  if (!settings.offline_enabled) return { error: t("checkout.err.offlineUnavailable") };

  const parsed = z
    .object({
      plan_id: z.coerce.number().int().positive(),
      cycle: z.enum(["monthly", "yearly"]),
      reference: z.string().trim().min(3, t("checkout.err.reference")).max(190),
    })
    .safeParse({ plan_id: formData.get("plan_id"), cycle: formData.get("cycle"), reference: formData.get("reference") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const plan = await getPlan(parsed.data.plan_id);
  if (!plan || !plan.is_active || plan.is_free) return { error: t("checkout.err.planUnavailable") };

  const db = await getDb();
  const pending = await db
    .selectFrom("payments")
    .select("id")
    .where("user_id", "=", user.id)
    .where("provider", "=", "offline")
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (pending) return { error: t("checkout.err.transferPending") };

  await createPendingPayment({
    userId: user.id,
    plan,
    cycle: parsed.data.cycle,
    currency: settings.currency,
    provider: "offline",
    providerRef: `offline:${crypto.randomUUID()}`,
    note: parsed.data.reference,
  });
  redirect("/account?payment=submitted");
}

export async function cancelSubscription(): Promise<FormState> {
  const [user, t] = await Promise.all([getCurrentUser(), getT()]);
  if (!user) return { error: t("auth.err.sessionExpired") };
  if (!user.stripe_subscription_id) return { error: t("account.err.noRenewal") };
  try {
    await cancelStripeSubscription(user.stripe_subscription_id);
  } catch {
    return { error: t("account.err.providerUnreachable") };
  }
  const db = await getDb();
  await db.updateTable("users").set({ updated_at: now() }).where("id", "=", user.id).execute();
  return { success: t("account.cancelled") };
}
