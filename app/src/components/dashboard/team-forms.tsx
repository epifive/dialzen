"use client";

import { useId, useRef } from "react";
import { transferOwnershipAction } from "@/app/actions/dashboard/team";
import { changeMemberRoleAction } from "@/app/actions/dashboard/workspace";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { AssignableRole } from "@/voice/types";
import { HiddenFields, useRefreshingAction } from "./client-kit";

/** Role select of a member row: saves as soon as another role is picked. */
export function RoleForm({ workspaceId, userId, role, roles, label }: { workspaceId: number; userId: number; role: AssignableRole; roles: readonly AssignableRole[]; label: string }) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useRefreshingAction(changeMemberRoleAction);
  return (
    <form ref={form} action={action} className="inline-flex flex-col items-start gap-1">
      <HiddenFields fields={{ wid: workspaceId, user_id: userId }} />
      <Select
        name="role"
        defaultValue={role}
        aria-label={label}
        disabled={pending}
        onChange={() => form.current?.requestSubmit()}
        className="h-8 w-auto min-w-32 py-0 text-sm"
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {t(`dash.role.${r}` as MessageKey)}
          </option>
        ))}
      </Select>
      {state.error ? (
        <span role="alert" className="max-w-56 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : (
        <span role="status" className="sr-only">
          {state.success ?? ""}
        </span>
      )}
    </form>
  );
}

/** Owner only: hand the workspace to another member (password confirmation). */
export function TransferOwnershipForm({ workspaceId, members }: { workspaceId: number; members: Array<{ userId: number; name: string; email: string }> }) {
  const t = useT();
  const uid = useId();
  const [state, action] = useRefreshingAction(transferOwnershipAction);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(t("dash.team.transferConfirm"))) e.preventDefault();
      }}
      className="space-y-4"
    >
      <HiddenFields fields={{ wid: workspaceId }} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.team.transferTo")} htmlFor={`${uid}-user`}>
          <Select id={`${uid}-user`} name="user_id" required defaultValue="">
            <option value="" disabled>
              {t("dash.team.transferPick")}
            </option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} ({m.email})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.team.transferPassword")} htmlFor={`${uid}-pw`}>
          <Input id={`${uid}-pw`} name="password" type="password" required autoComplete="current-password" dir="ltr" />
        </Field>
      </div>
      <SubmitButton variant="danger" pendingText={t("dash.team.transferring")}>
        {t("dash.team.transfer")}
      </SubmitButton>
    </form>
  );
}
