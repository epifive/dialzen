import "server-only";
import type Stripe from "stripe";
import { createCreditPayment } from "../billing";
import { getDb, now } from "../db";
import { completePayment, findPaymentByRef } from "./index";
import { stripeClient } from "./stripe";

/**
 * Stripe for credit packs: a one-time Checkout payment (the card is saved for automatic
 * recharges), its confirmation from the return page or the webhook, and off-session charges of
 * the saved card when a wallet's auto-recharge fires. PayPal, Razorpay and bank transfers reuse
 * the plan checkout helpers with payments.purpose = "credits".
 */

/** Hosted Checkout page for a credit pack. Records the pending payment (provider_ref "stripe:<session id>"). */
export async function createStripeCreditCheckout(input: {
  user: { id: number; email: string; stripe_customer_id: string | null };
  workspace: { id: number; name: string };
  amountCents: number;
  currency: string;
  baseUrl: string;
  productName: string;
}): Promise<string> {
  const stripe = await stripeClient();
  const back = `${input.baseUrl}/dashboard/w/${input.workspace.id}/billing`;
  const metadata = { purpose: "credits", workspace_id: String(input.workspace.id), user_id: String(input.user.id) };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: input.user.stripe_customer_id ?? undefined,
    customer_email: input.user.stripe_customer_id ? undefined : input.user.email,
    customer_creation: input.user.stripe_customer_id ? undefined : "always",
    client_reference_id: String(input.user.id),
    line_items: [{ quantity: 1, price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountCents, product_data: { name: input.productName } } }],
    // Keeps the card for automatic recharges (off-session payments).
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    metadata,
    success_url: `${back}?paid=stripe&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  await createCreditPayment({ userId: input.user.id, workspaceId: input.workspace.id, amountCents: input.amountCents, currency: input.currency, provider: "stripe", providerRef: `stripe:${session.id}` });
  return session.url;
}

async function rememberCustomer(userId: number, customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): Promise<void> {
  const id = typeof customer === "string" ? customer : customer?.id;
  if (!id) return;
  const db = await getDb();
  await db.updateTable("users").set({ stripe_customer_id: id, updated_at: now() }).where("id", "=", userId).where("stripe_customer_id", "is", null).execute();
}

/** Completes a paid credit-pack Checkout session (return page and webhook). Idempotent. */
export async function handleCreditSession(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.metadata?.purpose !== "credits" || session.payment_status !== "paid") return false;
  const payment = await findPaymentByRef(`stripe:${session.id}`);
  if (!payment || payment.purpose !== "credits") return false;
  if (session.amount_total !== null && session.amount_total !== payment.amount) return false;
  await rememberCustomer(payment.user_id, session.customer);
  if (payment.status === "paid") return true;
  return completePayment(payment.id);
}

/** The billing page's return from Stripe: confirm right away instead of waiting for the webhook. */
export async function confirmCreditSession(sessionId: string, userId: number): Promise<boolean> {
  const stripe = await stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== String(userId)) return false;
  return handleCreditSession(session);
}

/** payment_intent.succeeded of an automatic recharge (webhook). */
export async function handleCreditIntent(intent: Stripe.PaymentIntent): Promise<boolean> {
  if (intent.metadata?.purpose !== "credits" || intent.status !== "succeeded") return false;
  const payment = await findPaymentByRef(`stripe:${intent.id}`);
  if (!payment || payment.status !== "pending") return false;
  return completePayment(payment.id);
}

export type AutoChargeResult = { ok: true; paymentId: number; status: "paid" | "pending" } | { ok: false; reason: "no_card" | "declined" | "error"; message: string };

/**
 * Charges the card saved with the workspace's last Stripe credit pack, off-session, and adds the
 * credits once Stripe confirms it (right away, or via the webhook for delayed methods).
 */
export async function chargeSavedCard(input: { workspaceId: number; amountCents: number; currency: string; description: string }): Promise<AutoChargeResult> {
  const db = await getDb();
  const last = await db
    .selectFrom("payments")
    .innerJoin("users", "users.id", "payments.user_id")
    .select(["users.id as user_id", "users.stripe_customer_id"])
    .where("payments.workspace_id", "=", input.workspaceId)
    .where("payments.purpose", "=", "credits")
    .where("payments.provider", "=", "stripe")
    .where("payments.status", "=", "paid")
    .where("users.stripe_customer_id", "is not", null)
    .orderBy("payments.id", "desc")
    .executeTakeFirst();
  if (!last?.stripe_customer_id) return { ok: false, reason: "no_card", message: "No card saved: buy a credit pack by card once." };
  try {
    const stripe = await stripeClient();
    const customer = await stripe.customers.retrieve(last.stripe_customer_id);
    let method: string | null = null;
    if (!customer.deleted) {
      const def = customer.invoice_settings?.default_payment_method;
      method = typeof def === "string" ? def : (def?.id ?? null);
    }
    if (!method) method = (await stripe.paymentMethods.list({ customer: last.stripe_customer_id, type: "card", limit: 1 })).data[0]?.id ?? null;
    if (!method) return { ok: false, reason: "no_card", message: "No card saved: buy a credit pack by card once." };
    const intent = await stripe.paymentIntents.create({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      customer: last.stripe_customer_id,
      payment_method: method,
      off_session: true,
      confirm: true,
      description: input.description,
      metadata: { purpose: "credits", workspace_id: String(input.workspaceId), user_id: String(last.user_id), auto: "1" },
    });
    const paymentId = await createCreditPayment({ userId: last.user_id, workspaceId: input.workspaceId, amountCents: input.amountCents, currency: input.currency, provider: "stripe", providerRef: `stripe:${intent.id}`, note: "Automatic recharge" });
    if (intent.status === "succeeded") {
      await completePayment(paymentId);
      return { ok: true, paymentId, status: "paid" };
    }
    return { ok: true, paymentId, status: "pending" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe error";
    const declined = (error as { type?: string }).type === "StripeCardError";
    return { ok: false, reason: declined ? "declined" : "error", message };
  }
}
