import "server-only";
import crypto from "node:crypto";
import { getSettings } from "../settings";

/** Razorpay Payment Links (redirect flow, no client-side SDK needed). */

async function authHeader(): Promise<string> {
  const settings = await getSettings();
  return `Basic ${Buffer.from(`${settings.razorpay_key_id}:${settings.razorpay_key_secret}`).toString("base64")}`;
}

export async function createRazorpayLink(input: {
  amount: number;
  currency: string;
  description: string;
  referenceId: string;
  customer: { name: string; email: string };
  callbackUrl: string;
}): Promise<{ id: string; url: string }> {
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      description: input.description.slice(0, 2048),
      reference_id: input.referenceId,
      customer: input.customer,
      notify: { email: false, sms: false },
      callback_url: input.callbackUrl,
      callback_method: "get",
    }),
    cache: "no-store",
  });
  const data = (await res.json()) as { id?: string; short_url?: string; error?: { description?: string } };
  if (!res.ok || !data.id || !data.short_url) {
    throw new Error(data.error?.description ?? "Razorpay could not create the payment link.");
  }
  return { id: data.id, url: data.short_url };
}

/** Verify the signature Razorpay appends to the callback URL. */
export async function verifyRazorpayCallback(params: {
  paymentLinkId: string;
  referenceId: string;
  status: string;
  paymentId: string;
  signature: string;
}): Promise<boolean> {
  const settings = await getSettings();
  const payload = `${params.paymentLinkId}|${params.referenceId}|${params.status}|${params.paymentId}`;
  const expected = crypto.createHmac("sha256", settings.razorpay_key_secret).update(payload).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
