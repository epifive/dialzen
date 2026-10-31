import "server-only";
import { getDb, now } from "../db";
import type { Payment, Plan } from "../db/schema";
import type { Settings } from "../settings";

export type Gateway = "stripe" | "paypal" | "razorpay" | "offline";
export type BillingCycle = "monthly" | "yearly";

export const GATEWAY_LABELS: Record<Gateway, string> = {
  stripe: "Credit or debit card",
  paypal: "PayPal",
  razorpay: "Razorpay (UPI, cards, netbanking)",
  offline: "Bank transfer",
};

export function enabledGateways(settings: Settings): Gateway[] {
  const list: Gateway[] = [];
  if (settings.stripe_enabled && settings.stripe_secret_key) list.push("stripe");
  if (settings.paypal_enabled && settings.paypal_client_id && settings.paypal_secret) list.push("paypal");
  if (settings.razorpay_enabled && settings.razorpay_key_id && settings.razorpay_key_secret) list.push("razorpay");
  if (settings.offline_enabled) list.push("offline");
  return list;
}

export function planPrice(plan: Plan, cycle: BillingCycle): number {
  return cycle === "yearly" ? plan.price_yearly : plan.price_monthly;
}

/** Add one billing period to a date. */
export function addPeriod(fromIso: string, cycle: BillingCycle): string {
  const d = new Date(fromIso);
  if (cycle === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

export async function createPendingPayment(input: {
  userId: number;
  plan: Plan;
  cycle: BillingCycle;
  currency: string;
  provider: Gateway;
  providerRef: string;
  note?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db
    .insertInto("payments")
    .values({
      user_id: input.userId,
      plan_id: input.plan.id,
      amount: planPrice(input.plan, input.cycle),
      currency: input.currency,
      billing_cycle: input.cycle,
      provider: input.provider,
      provider_ref: input.providerRef,
      status: "pending",
      note: input.note ?? null,
      created_at: now(),
    })
    .executeTakeFirstOrThrow();
  return Number(result.insertId);
}

export async function findPaymentByRef(ref: string): Promise<Payment | undefined> {
  const db = await getDb();
  return db.selectFrom("payments").selectAll().where("provider_ref", "=", ref).executeTakeFirst();
}

/**
 * Give the user access to a plan. Extends from the current expiry when the user
 * renews the same plan early, otherwise starts from now. `until` overrides the
 * computed date (Stripe tells us the exact period end).
 */
export async function activatePlan(userId: number, planId: number, cycle: BillingCycle, until?: string): Promise<void> {
  const db = await getDb();
  const user = await db.selectFrom("users").select(["plan_id", "plan_expires_at"]).where("id", "=", userId).executeTakeFirst();
  if (!user) return;
  const ts = now();
  let expires = until;
  if (!expires) {
    const base = user.plan_id === planId && user.plan_expires_at && user.plan_expires_at > ts ? user.plan_expires_at : ts;
    expires = addPeriod(base, cycle);
  }
  await db.updateTable("users").set({ plan_id: planId, plan_expires_at: expires, updated_at: ts }).where("id", "=", userId).execute();
}

/**
 * Mark a pending payment as paid and activate its plan (or add its credit pack to the workspace's
 * call credits). Safe to call more than once for the same payment (webhooks and return pages may
 * both fire).
 */
export async function completePayment(paymentId: number, until?: string): Promise<boolean> {
  const db = await getDb();
  const updated = await db
    .updateTable("payments")
    .set({ status: "paid" })
    .where("id", "=", paymentId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) return false;
  const payment = await db.selectFrom("payments").selectAll().where("id", "=", paymentId).executeTakeFirstOrThrow();
  if (payment.purpose === "credits") {
    // A credit pack: top up the workspace's call credits instead of activating a plan.
    const { applyCreditPayment } = await import("../billing");
    await applyCreditPayment(payment);
    return true;
  }
  await activatePlan(payment.user_id, payment.plan_id, payment.billing_cycle, until);
  return true;
}

/** Record a payment that is already settled (e.g. a Stripe renewal) and activate the plan. */
export async function recordPaidPayment(input: {
  userId: number;
  planId: number;
  cycle: BillingCycle;
  amount: number;
  currency: string;
  provider: Gateway;
  providerRef: string;
  until?: string;
}): Promise<boolean> {
  if (await findPaymentByRef(input.providerRef)) return false;
  const db = await getDb();
  try {
    await db
      .insertInto("payments")
      .values({
        user_id: input.userId,
        plan_id: input.planId,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        billing_cycle: input.cycle,
        provider: input.provider,
        provider_ref: input.providerRef,
        status: "paid",
        note: null,
        created_at: now(),
      })
      .execute();
  } catch {
    // Unique provider_ref: a concurrent request already recorded this payment.
    return false;
  }
  await activatePlan(input.userId, input.planId, input.cycle, input.until);
  return true;
}
