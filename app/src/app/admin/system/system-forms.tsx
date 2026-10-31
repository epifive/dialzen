"use client";

import { useActionState } from "react";
import { initialFormState, type FormState } from "@/app/actions/types";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { clearCaches, pruneSessions, sendTestEmail } from "../actions/system";

function OneClick({ action, label, pendingText }: { action: () => Promise<FormState>; label: string; pendingText: string }) {
  const [state, run] = useActionState(async () => action(), initialFormState);
  return (
    <form action={run} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="outline" size="sm" pendingText={pendingText}>
        {label}
      </SubmitButton>
    </form>
  );
}

export function ClearCacheForm() {
  return <OneClick action={clearCaches} label="Clear caches" pendingText="Clearing…" />;
}

export function PruneSessionsForm() {
  return <OneClick action={pruneSessions} label="Remove expired sessions" pendingText="Cleaning…" />;
}

export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const [state, action] = useActionState(sendTestEmail, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Send a test email to" htmlFor="to" className="min-w-64 flex-1">
          <Input id="to" name="to" type="email" defaultValue={defaultTo} required />
        </Field>
        <SubmitButton variant="outline" pendingText="Sending…">
          Send test
        </SubmitButton>
      </div>
    </form>
  );
}
