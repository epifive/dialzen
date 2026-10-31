"use client";

import { useActionState } from "react";
import { initialFormState } from "@/app/actions/types";
import { Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { listVoicesAction, reconcileNowAction, retryCleanupAction, testProviderAction } from "./actions";

export function TestProviderForm({ provider, disabled }: { provider: string; disabled?: boolean }) {
  const [state, action] = useActionState(testProviderAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton size="sm" pendingText="Testing…" className={disabled ? "pointer-events-none opacity-50" : undefined}>
        Test connection
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function ListVoicesForm({ provider }: { provider: string }) {
  const [state, action] = useActionState(listVoicesAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="provider" value={provider} />
      <div className="flex flex-wrap items-center gap-2">
        <Input name="lang" aria-label="Language filter" placeholder="Language, e.g. hi" className="h-8 w-40" dir="ltr" maxLength={10} />
        <SubmitButton size="sm" variant="outline" pendingText="Loading…">
          List voices
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function ReconcileNowForm() {
  const [state, action] = useActionState(reconcileNowAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <SubmitButton size="sm" variant="outline" pendingText="Reconciling…">
        Reconcile now
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function RetryCleanupForm({ byo }: { byo: number }) {
  const [state, action] = useActionState(retryCleanupAction, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" variant="outline" pendingText="Retrying…">
          Retry
        </SubmitButton>
        {byo ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="drop_byo" value="1" /> Forget the ones in workspaces&apos; own accounts whose keys are gone ({byo} in own accounts)
          </label>
        ) : null}
      </div>
      <FormMessage state={state} />
    </form>
  );
}
