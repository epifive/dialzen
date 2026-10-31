import "server-only";
import { getSettings } from "../settings";

/** Minimal PayPal Orders v2 client using fetch (no SDK required). */

async function apiBase(): Promise<string> {
  const settings = await getSettings();
  return settings.paypal_mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function accessToken(): Promise<string> {
  const settings = await getSettings();
  const credentials = Buffer.from(`${settings.paypal_client_id}:${settings.paypal_secret}`).toString("base64");
  const res = await fetch(`${await apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("PayPal rejected the API credentials. Check the client ID and secret.");
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Create an order and return its id and the URL where the buyer approves it. */
export async function createPaypalOrder(input: {
  amount: number;
  currency: string;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; approveUrl: string }> {
  const res = await fetch(`${await apiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: input.customId,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency.toUpperCase(), value: formatAmount(input.amount) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { id?: string; links?: Array<{ rel: string; href: string }>; message?: string };
  const approve = data.links?.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!res.ok || !data.id || !approve) throw new Error(data.message ?? "PayPal could not create the order.");
  return { id: data.id, approveUrl: approve.href };
}

/** Capture an approved order. Returns the captured amount in cents when completed. */
export async function capturePaypalOrder(
  orderId: string,
): Promise<{ completed: boolean; amount: number; currency: string; customId: string | null }> {
  const res = await fetch(`${await apiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const data = (await res.json()) as {
    status?: string;
    purchase_units?: Array<{
      payments?: { captures?: Array<{ status: string; amount: { value: string; currency_code: string }; custom_id?: string }> };
    }>;
  };
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    completed: data.status === "COMPLETED" && capture?.status === "COMPLETED",
    amount: capture ? Math.round(Number(capture.amount.value) * 100) : 0,
    currency: capture?.amount.currency_code ?? "",
    customId: capture?.custom_id ?? null,
  };
}
