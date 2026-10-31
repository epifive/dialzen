"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { initialFormState } from "@/app/actions/types";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { adjustWalletAction } from "./actions";

/** Credit / debit a workspace's call credits with a reason. */
export function WalletAdjustForm({ workspaces, currency }: { workspaces: Array<{ id: number; name: string; email: string }>; currency: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(adjustWalletAction, initialFormState);
  useEffect(() => {
    if (state.success) {
      ref.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form
      ref={ref}
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        if (!window.confirm(`Adjust the wallet of workspace #${fd.get("workspace_id")} by ${fd.get("amount")} ${currency}?`)) e.preventDefault();
      }}
    >
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <Field label="Workspace" htmlFor="adj-ws">
          <Select id="adj-ws" name="workspace_id" required defaultValue="">
            <option value="" disabled>
              Choose a workspace
            </option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                #{w.id} {w.name} ({w.email})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="adj-amount" hint="Negative = debit.">
          <Input id="adj-amount" name="amount" required inputMode="decimal" placeholder="25.00" />
        </Field>
        <Field label="Reason" htmlFor="adj-reason" hint="Shown in the workspace's ledger.">
          <Input id="adj-reason" name="reason" required minLength={3} maxLength={200} placeholder="Goodwill credit for the outage on Oct 20" />
        </Field>
      </div>
      <div>
        <Checkbox name="allow_negative" label="Allow a negative balance" />
      </div>
      <SubmitButton pendingText="Saving…">Adjust wallet</SubmitButton>
    </form>
  );
}
