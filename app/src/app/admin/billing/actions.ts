"use server";

import { adjustWallet } from "@/lib/billing";
import { guardAdmin } from "@/lib/admin";
import { getSettings } from "@/lib/settings";
import { formatMicros } from "@/voice/format";
import { toMicros } from "@/voice/normalize";
import type { FormState } from "@/app/actions/types";

/** Admin → Billing: credit or debit a workspace's wallet with a reason (ledger "adjustment" + audit log). */
export async function adjustWalletAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const workspaceId = Number(fd.get("workspace_id"));
  const raw = String(fd.get("amount") ?? "").replace(",", ".").trim();
  const amount = Number(raw);
  if (!/^-?\d+(\.\d{1,6})?$/.test(raw) || !Number.isFinite(amount) || amount === 0) return { error: "Enter an amount like 25 or -10.50 (negative = debit)." };
  const res = await adjustWallet(workspaceId, toMicros(amount), String(fd.get("reason") ?? ""), guard.user.id, fd.get("allow_negative") === "on");
  if (!res.ok) {
    const messages = { workspace: "Workspace not found.", amount: "Enter a valid amount.", reason: "Give a reason (at least 3 characters): it is saved in the ledger and the audit log.", insufficient: "The balance is too low for this debit. Tick “Allow a negative balance” to debit anyway." } as const;
    return { error: messages[res.error] };
  }
  const settings = await getSettings();
  return { success: `Done. New balance: ${formatMicros(res.balanceAfter, settings.currency)}.` };
}
