"use client";

import { useActionState } from "react";
import { sendContactMessage } from "@/app/actions/contact";
import { initialFormState } from "@/app/actions/types";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

export function ContactForm({ defaultName, defaultEmail }: { defaultName?: string; defaultEmail?: string }) {
  const t = useT();
  const [state, action] = useActionState(sendContactMessage, initialFormState);
  if (state.success) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("contact.name")} htmlFor="name">
          <Input id="name" name="name" required maxLength={120} defaultValue={defaultName} autoComplete="name" />
        </Field>
        <Field label={t("contact.email")} htmlFor="email">
          <Input id="email" name="email" type="email" required defaultValue={defaultEmail} autoComplete="email" />
        </Field>
      </div>
      <Field label={t("contact.subject")} htmlFor="subject">
        <Input id="subject" name="subject" required maxLength={255} />
      </Field>
      <Field label={t("contact.message")} htmlFor="message">
        <Textarea id="message" name="message" required minLength={10} maxLength={5000} rows={6} />
      </Field>
      <div aria-hidden className="absolute -left-[9999px]">
        <label htmlFor="website">Leave this field empty</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <SubmitButton pendingText={t("contact.sending")}>{t("contact.send")}</SubmitButton>
    </form>
  );
}
