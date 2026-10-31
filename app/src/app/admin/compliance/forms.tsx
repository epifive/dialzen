"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { initialFormState, type FormState } from "@/app/actions/types";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { removeGlobalDncAction, reviewKycAction, setGlobalKillAction, setOutboundStateAction, setWorkspaceKillAction, uploadGlobalDncAction } from "./actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** A small admin form that refreshes the page after a successful action. */
function AdminForm({ action, children, confirm, className, resetOnSuccess = false }: { action: Action; children: ReactNode; confirm?: string; className?: string; resetOnSuccess?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(action, initialFormState);
  useEffect(() => {
    if (state.success) {
      if (resetOnSuccess) ref.current?.reset();
      router.refresh();
    }
  }, [state, router, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={cn("space-y-3", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FormMessage state={state} />
      {children}
    </form>
  );
}

export function KycReviewForm({ requestId }: { requestId: number }) {
  return (
    <AdminForm action={reviewKycAction}>
      <input type="hidden" name="request_id" value={requestId} />
      <Field label="Note to the workspace" htmlFor={`note-${requestId}`} hint="Required when declining. Shown on their compliance page.">
        <Textarea id={`note-${requestId}`} name="note" className="min-h-16" maxLength={1000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approved" className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong">
          Approve outbound calls
        </button>
        <button type="submit" name="decision" value="rejected" className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium hover:border-red-400 hover:text-red-600">
          Decline
        </button>
      </div>
    </AdminForm>
  );
}

export function GlobalKillForm({ on }: { on: boolean }) {
  return (
    <AdminForm action={setGlobalKillAction} confirm={on ? "Allow outbound calls again on the whole platform?" : "Stop ALL outbound calls of every workspace now? Inbound calls keep working."}>
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      <SubmitButton variant={on ? "primary" : "danger"} pendingText="Saving…">
        {on ? "Allow outbound calls again" : "Stop all outbound calls"}
      </SubmitButton>
    </AdminForm>
  );
}

export function WorkspaceKillForm({ workspaceId, on }: { workspaceId: number; on: boolean }) {
  return (
    <AdminForm action={setWorkspaceKillAction} confirm={on ? undefined : "Stop every outbound call of this workspace?"} className="space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="on" value={on ? "0" : "1"} />
      {!on ? <Input name="reason" placeholder="Reason" aria-label="Reason" className="h-8 text-xs" maxLength={500} /> : null}
      <SubmitButton size="sm" variant={on ? "outline" : "danger"} pendingText="…">
        {on ? "Kill switch off" : "Kill switch on"}
      </SubmitButton>
    </AdminForm>
  );
}

export function OutboundStateForm({ workspaceId, state }: { workspaceId: number; state: string }) {
  const suspend = state !== "suspended";
  return (
    <AdminForm action={setOutboundStateAction} confirm={suspend ? "Suspend outbound calling of this workspace? They have to be re-approved by you." : "Allow this workspace to place outbound calls again?"}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="state" value={suspend ? "suspended" : "approved"} />
      <SubmitButton size="sm" variant="outline" pendingText="…">
        {suspend ? "Suspend" : "Re-approve"}
      </SubmitButton>
    </AdminForm>
  );
}

export function GlobalDncUploadForm() {
  return (
    <AdminForm action={uploadGlobalDncAction} resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reference" htmlFor="g-ref" hint="Where the list comes from (complaints, regulator, litigators…).">
          <Input id="g-ref" name="list_ref" maxLength={120} />
        </Field>
        <Field label="Country for numbers without +" htmlFor="g-cc">
          <Input id="g-cc" name="country" defaultValue="US" maxLength={2} dir="ltr" />
        </Field>
        <Field label="CSV or TXT file" htmlFor="g-file">
          <Input id="g-file" name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="py-1.5" />
        </Field>
        <Field label="Note" htmlFor="g-note">
          <Input id="g-note" name="note" maxLength={500} />
        </Field>
      </div>
      <Field label="…or paste numbers" htmlFor="g-nums">
        <Textarea id="g-nums" name="numbers" className="min-h-24 font-mono text-[13px]" dir="ltr" />
      </Field>
      <SubmitButton pendingText="Uploading…">Add to the global list</SubmitButton>
    </AdminForm>
  );
}

export function RemoveGlobalDncForm({ phone }: { phone: string }) {
  return (
    <AdminForm action={removeGlobalDncAction} confirm={`Remove ${phone} from the global do-not-call list?`}>
      <input type="hidden" name="phone" value={phone} />
      <SubmitButton size="sm" variant="outline" pendingText="…">
        Remove
      </SubmitButton>
    </AdminForm>
  );
}
