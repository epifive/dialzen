"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, register, requestPasswordReset, resetPassword } from "@/app/actions/auth";
import { initialFormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

export function LoginForm({ next, demo }: { next?: string; demo?: { email: string; password: string } }) {
  const t = useT();
  const [state, action] = useActionState(login, initialFormState);
  return (
    <form action={action} className="space-y-4">
      {demo ? (
        <Alert tone="info" title={t("auth.demoTitle")}>
          {t("auth.demoText")}
        </Alert>
      ) : null}
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={demo?.email} />
      </Field>
      <Field
        label={
          <span className="flex items-center justify-between">
            {t("auth.password")}
            <Link href="/forgot-password" className="text-xs font-normal text-primary hover:underline">
              {t("auth.forgot")}
            </Link>
          </span>
        }
        htmlFor="password"
      >
        <Input id="password" name="password" type="password" autoComplete="current-password" required defaultValue={demo?.password} />
      </Field>
      <SubmitButton className="w-full" pendingText={t("auth.signingIn")}>
        {t("auth.signIn")}
      </SubmitButton>
    </form>
  );
}

export function RegisterForm({ next, termsHref }: { next?: string; termsHref: string }) {
  const t = useT();
  const [state, action] = useActionState(register, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      {/* The browser's time zone becomes the personal workspace's time zone (set after hydration). */}
      <input
        type="hidden"
        name="timezone"
        ref={(el) => {
          if (el && !el.value) el.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        }}
      />
      <Field label={t("auth.name")} htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required maxLength={120} />
      </Field>
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={t("auth.password")} htmlFor="password" hint={t("auth.passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-muted">
        <input type="checkbox" name="terms" required className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          {t("auth.agree")}{" "}
          <Link href={termsHref} className="text-primary underline underline-offset-2" target="_blank">
            {t("auth.terms")}
          </Link>
          .
        </span>
      </label>
      <SubmitButton className="w-full" pendingText={t("auth.creating")}>
        {t("auth.createAccount")}
      </SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useT();
  const [state, action] = useActionState(requestPasswordReset, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label={t("auth.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <SubmitButton className="w-full" pendingText={t("auth.sending")}>
        {t("auth.sendLink")}
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useT();
  const [state, action] = useActionState(resetPassword, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <Field label={t("auth.newPassword")} htmlFor="password" hint={t("auth.passwordHint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <SubmitButton className="w-full" pendingText={t("auth.saving")}>
        {t("auth.setPassword")}
      </SubmitButton>
    </form>
  );
}
