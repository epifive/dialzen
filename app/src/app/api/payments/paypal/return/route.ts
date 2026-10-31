import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { completePayment, findPaymentByRef } from "@/lib/payments";
import { capturePaypalOrder } from "@/lib/payments/paypal";
import { baseUrl } from "@/lib/request";

export const dynamic = "force-dynamic";

/** PayPal sends the buyer back here (?token=<order id>) after approving the payment. */
export async function GET(request: Request) {
  const base = await baseUrl();
  const orderId = new URL(request.url).searchParams.get("token");
  const user = await getCurrentUser();
  if (!orderId || !user) return NextResponse.redirect(`${base}/pricing?checkout=failed`);

  const payment = await findPaymentByRef(`paypal:${orderId}`);
  if (!payment || payment.user_id !== user.id) return NextResponse.redirect(`${base}/pricing?checkout=failed`);
  // Credit packs go back to the workspace's billing page.
  const done = payment.purpose === "credits" && payment.workspace_id ? `${base}/dashboard/w/${payment.workspace_id}/billing?paid=paypal` : `${base}/checkout/success?provider=paypal`;
  const failed = payment.purpose === "credits" && payment.workspace_id ? `${base}/dashboard/w/${payment.workspace_id}/billing?checkout=failed` : `${base}/pricing?checkout=failed`;
  if (payment.status === "paid") return NextResponse.redirect(done);

  try {
    const capture = await capturePaypalOrder(orderId);
    const matches =
      capture.completed &&
      capture.amount === payment.amount &&
      capture.currency.toUpperCase() === payment.currency.toUpperCase();
    if (!matches) return NextResponse.redirect(failed);
    await completePayment(payment.id);
  } catch {
    return NextResponse.redirect(failed);
  }
  return NextResponse.redirect(done);
}
