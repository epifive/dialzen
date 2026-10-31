import { NextResponse } from "next/server";
import { completePayment, findPaymentByRef } from "@/lib/payments";
import { verifyRazorpayCallback } from "@/lib/payments/razorpay";
import { baseUrl } from "@/lib/request";

export const dynamic = "force-dynamic";

/** Razorpay redirects here after a payment link is paid. The signature proves the request is genuine. */
export async function GET(request: Request) {
  const base = await baseUrl();
  const q = new URL(request.url).searchParams;
  const params = {
    paymentId: q.get("razorpay_payment_id") ?? "",
    paymentLinkId: q.get("razorpay_payment_link_id") ?? "",
    referenceId: q.get("razorpay_payment_link_reference_id") ?? "",
    status: q.get("razorpay_payment_link_status") ?? "",
    signature: q.get("razorpay_signature") ?? "",
  };
  if (!params.paymentLinkId || !params.signature || !(await verifyRazorpayCallback(params))) {
    return NextResponse.redirect(`${base}/pricing?checkout=failed`);
  }
  if (params.status !== "paid") return NextResponse.redirect(`${base}/pricing?checkout=cancelled`);

  const payment = await findPaymentByRef(`razorpay:${params.paymentLinkId}`);
  if (!payment) return NextResponse.redirect(`${base}/pricing?checkout=failed`);
  await completePayment(payment.id);
  if (payment.purpose === "credits" && payment.workspace_id) return NextResponse.redirect(`${base}/dashboard/w/${payment.workspace_id}/billing?paid=razorpay`);
  return NextResponse.redirect(`${base}/checkout/success?provider=razorpay`);
}
