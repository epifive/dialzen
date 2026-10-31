import type Stripe from "stripe";
import { getDb, now } from "@/lib/db";
import { handleCreditIntent, handleCreditSession } from "@/lib/payments/credits";
import { handlePaidInvoice, stripeClient } from "@/lib/payments/stripe";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Stripe webhook endpoint. Configure it in Stripe → Developers → Webhooks. */
export async function POST(request: Request) {
  const settings = await getSettings();
  if (!settings.stripe_enabled || !settings.stripe_webhook_secret) {
    return Response.json({ error: "Stripe webhooks are not configured." }, { status: 400 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature." }, { status: 400 });

  const stripe = await stripeClient();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, settings.stripe_webhook_secret);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "invoice.paid":
        await handlePaidInvoice(event.data.object);
        break;
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.metadata?.purpose === "credits") {
          await handleCreditSession(session);
          break;
        }
        const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
        if (invoiceId) {
          const invoice = await stripe.invoices.retrieve(invoiceId);
          if (invoice.status === "paid") await handlePaidInvoice(invoice);
        }
        break;
      }
      case "payment_intent.succeeded":
        // Automatic call-credit recharges (off-session card payments).
        await handleCreditIntent(event.data.object);
        break;
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const db = await getDb();
        await db
          .updateTable("users")
          .set({ stripe_subscription_id: null, updated_at: now() })
          .where("stripe_subscription_id", "=", subscription.id)
          .execute();
        break;
      }
      default:
        break;
    }
  } catch {
    // A 500 makes Stripe retry the event later.
    return Response.json({ error: "Webhook handler failed." }, { status: 500 });
  }
  return Response.json({ received: true });
}
