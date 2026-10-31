import "server-only";
import Stripe from "stripe";
import { getDb, now } from "../db";
import type { Plan } from "../db/schema";
import { getSettings } from "../settings";
import { planPrice, recordPaidPayment, type BillingCycle } from "./index";

export async function stripeClient(): Promise<Stripe> {
  const settings = await getSettings();
  if (!settings.stripe_secret_key) throw new Error("Stripe is not configured.");
  return new Stripe(settings.stripe_secret_key);
}

/** Start a Stripe Checkout subscription and return the hosted payment page URL. */
export async function createStripeCheckout(input: {
  user: { id: number; email: string; stripe_customer_id: string | null };
  plan: Plan;
  cycle: BillingCycle;
  currency: string;
  baseUrl: string;
}): Promise<string> {
  const stripe = await stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: input.user.stripe_customer_id ?? undefined,
    customer_email: input.user.stripe_customer_id ? undefined : input.user.email,
    client_reference_id: String(input.user.id),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: planPrice(input.plan, input.cycle),
          recurring: { interval: input.cycle === "yearly" ? "year" : "month" },
          product_data: { name: `${input.plan.name} (${input.cycle})` },
        },
      },
    ],
    metadata: { user_id: String(input.user.id), plan_id: String(input.plan.id), cycle: input.cycle },
    subscription_data: {
      metadata: { user_id: String(input.user.id), plan_id: String(input.plan.id), cycle: input.cycle },
    },
    success_url: `${input.baseUrl}/checkout/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.baseUrl}/pricing?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

function invoicePeriodEnd(invoice: Stripe.Invoice): string | undefined {
  const ends = invoice.lines.data.map((l) => l.period?.end ?? 0).filter(Boolean);
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : undefined;
}

/**
 * Record a paid subscription invoice and extend the user's plan to the end of
 * the billed period. Idempotent per invoice.
 */
export async function handlePaidInvoice(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId || !invoice.id) return;
  const stripe = await stripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = Number(subscription.metadata.user_id);
  const planId = Number(subscription.metadata.plan_id);
  const cycle = (subscription.metadata.cycle === "yearly" ? "yearly" : "monthly") as BillingCycle;
  if (!userId || !planId) return;

  const db = await getDb();
  await db
    .updateTable("users")
    .set({
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      stripe_subscription_id: subscription.id,
      updated_at: now(),
    })
    .where("id", "=", userId)
    .execute();

  await recordPaidPayment({
    userId,
    planId,
    cycle,
    amount: invoice.amount_paid,
    currency: invoice.currency,
    provider: "stripe",
    providerRef: `stripe:${invoice.id}`,
    until: invoicePeriodEnd(invoice),
  });
}

/** Called from the success page so access is granted even before the webhook arrives. */
export async function confirmCheckoutSession(sessionId: string, userId: number): Promise<boolean> {
  const stripe = await stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["invoice"] });
  if (session.client_reference_id !== String(userId) || session.payment_status !== "paid") return false;
  const invoice = session.invoice;
  if (invoice && typeof invoice !== "string") await handlePaidInvoice(invoice);
  return true;
}

export async function cancelStripeSubscription(subscriptionId: string): Promise<void> {
  const stripe = await stripeClient();
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

export async function stripeSubscriptionStatus(
  subscriptionId: string,
): Promise<{ status: string; cancelAtPeriodEnd: boolean } | null> {
  try {
    const stripe = await stripeClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return { status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end };
  } catch {
    return null;
  }
}
