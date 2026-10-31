"use client";

import { useActionState } from "react";
import { changePassword, updateProfile } from "@/app/actions/auth";
import { cancelSubscription } from "@/app/actions/billing";
import { initialFormState } from "@/app/actions/types";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const t = useT();
  const [state, action] = useActionState(updateProfile, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("auth.name")} htmlFor="name">
          <Input id="name" name="name" defaultValue={name} required maxLength={120} autoComplete="name" />
        </Field>
        <Field label={t("auth.email")} htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={email} required autoComplete="email" />
        </Field>
      </div>
      <SubmitButton>{t("account.saveProfile")}</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const t = useT();
  const [state, action] = useActionState(changePassword, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("account.currentPassword")} htmlFor="current_password">
          <Input id="current_password" name="current_password" type="password" required autoComplete="current-password" />
        </Field>
        <Field label={t("auth.newPassword")} htmlFor="new_password" hint={t("auth.passwordHint")}>
          <Input id="new_password" name="new_password" type="password" required minLength={8} autoComplete="new-password" />
        </Field>
      </div>
      <SubmitButton>{t("account.changePassword")}</SubmitButton>
    </form>
  );
}

export function CancelRenewalForm() {
  const t = useT();
  const [state, action] = useActionState(async () => cancelSubscription(), initialFormState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t("account.cancelConfirm"))) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormMessage state={state} />
      {!state.success ? (
        <SubmitButton variant="outline" size="sm" pendingText={t("account.cancelling")}>
          {t("account.cancelRenewal")}
        </SubmitButton>
      ) : null}
    </form>
  );
}
