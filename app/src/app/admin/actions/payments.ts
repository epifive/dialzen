"use server";

import { guardAdmin } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { completePayment } from "@/lib/payments";
import type { FormState } from "@/app/actions/types";

export async function approvePayment(paymentId: number): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const ok = await completePayment(paymentId);
  return ok ? { success: "Payment approved: the plan or the call credits are active." } : { error: "This payment is no longer pending." };
}

export async function rejectPayment(paymentId: number): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const db = await getDb();
  const result = await db
    .updateTable("payments")
    .set({ status: "rejected" })
    .where("id", "=", paymentId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  return Number(result.numUpdatedRows) ? { success: "Payment rejected." } : { error: "This payment is no longer pending." };
}
