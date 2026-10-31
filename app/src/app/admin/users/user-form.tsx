"use client";

import { useActionState, useState, useTransition } from "react";
import { initialFormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { deleteUser, saveUser } from "../actions/users";

export interface EditableUser {
  id: number | null;
  name: string;
  email: string;
  role: "user" | "admin";
  status: "active" | "banned";
  planId: number;
  planExpires: string;
}

export function UserForm({ user, plans, isSelf }: { user: EditableUser; plans: Array<{ id: number; name: string }>; isSelf: boolean }) {
  const [state, action] = useActionState(saveUser, initialFormState);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState("");
  return (
    <div className="max-w-3xl space-y-6">
      <form action={action} className="space-y-6 rounded-xl border border-line bg-surface p-6">
        <FormMessage state={state} />
        <input type="hidden" name="user_id" value={user.id ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" defaultValue={user.name} required maxLength={120} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={user.email} required />
          </Field>
          <Field label="Role" htmlFor="role">
            <Select id="role" name="role" defaultValue={user.role} disabled={isSelf}>
              <option value="user">User</option>
              <option value="admin">Administrator</option>
            </Select>
            {isSelf ? <input type="hidden" name="role" value="admin" /> : null}
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={user.status} disabled={isSelf}>
              <option value="active">Active</option>
              <option value="banned">Banned</option>
            </Select>
            {isSelf ? <input type="hidden" name="status" value="active" /> : null}
          </Field>
        </div>
        <fieldset className="grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
          <legend className="mb-3 text-sm font-semibold">Plan</legend>
          <Field label="Paid plan" htmlFor="plan_id" hint="Give a plan manually, e.g. after a bank transfer.">
            <Select id="plan_id" name="plan_id" defaultValue={user.planId}>
              <option value={0}>Free (no paid plan)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Plan ends on" htmlFor="plan_expires_at">
            <Input id="plan_expires_at" name="plan_expires_at" type="date" defaultValue={user.planExpires} />
          </Field>
        </fieldset>
        <div className="border-t border-line pt-6">
          <Field label={user.id ? "New password" : "Password"} htmlFor="password" hint={user.id ? "Leave empty to keep the current password." : "At least 8 characters."}>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required={!user.id} className="max-w-sm" />
          </Field>
        </div>
        <div className="flex justify-end">
          <SubmitButton>{user.id ? "Save user" : "Create user"}</SubmitButton>
        </div>
      </form>

      {user.id && !isSelf ? (
        <section className="rounded-xl border border-red-200 bg-surface p-6 dark:border-red-900">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Delete user</h2>
          <p className="mt-1 text-sm text-muted">Permanently removes the account with the workspaces it owns (agents, phone numbers, contacts, campaigns, calls, recordings, uploaded files, notification channels and API keys) and its memberships in other workspaces. Its numbers are released and its agents deleted at the voice providers first. Payment records, the do-not-call lists and the audit log are kept.</p>
          {deleteError ? <Alert tone="error" className="mt-3">{deleteError}</Alert> : null}
          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            disabled={deleting}
            onClick={() => {
              if (!confirm(`Delete ${user.email} with all their workspaces, agents, phone numbers, contacts, calls and recordings? This can't be undone.`)) return;
              startDelete(async () => {
                const result = await deleteUser(user.id!);
                if (result?.error) setDeleteError(result.error);
              });
            }}
          >
            {deleting ? "Deleting…" : "Delete user"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
