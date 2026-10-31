"use client";

import { useId, useRef, type ReactNode } from "react";
import { addConsentAction, addDncAction, createContactAction, createListAction, updateContactAction, uploadDncAction } from "@/app/actions/dashboard/contacts";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { CONSENT_SOURCES, CONSENT_TYPES } from "@/voice/types";

export interface ContactFormValues {
  id?: number;
  phone: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  timezone: string;
  state: string;
  language: string;
  tags: string[];
}

/** Create (with an optional list) or edit a contact. */
export function ContactForm({ workspaceId, values, lists = [], timezones }: { workspaceId: number; values: ContactFormValues; lists?: Array<{ id: number; name: string }>; timezones: string[] }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const editing = Boolean(values.id);
  const [state, action] = useRefreshingAction(editing ? updateContactAction : createContactAction);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="wid" value={workspaceId} />
      {values.id ? <input type="hidden" name="contact_id" value={values.id} /> : null}
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.contacts.phone")} htmlFor={id("phone")} hint={editing ? t("dash.contacts.phoneFixed") : t("dash.contacts.phoneHint")}>
          <Input id={id("phone")} name="phone" defaultValue={values.phone} required={!editing} readOnly={editing} dir="ltr" inputMode="tel" autoComplete="off" placeholder="+1 415 555 0123" />
        </Field>
        <Field label={t("dash.contacts.email")} htmlFor={id("email")}>
          <Input id={id("email")} name="email" type="email" defaultValue={values.email} dir="ltr" autoComplete="off" />
        </Field>
        <Field label={t("dash.contacts.firstName")} htmlFor={id("first")}>
          <Input id={id("first")} name="first_name" defaultValue={values.firstName} maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t("dash.contacts.lastName")} htmlFor={id("last")}>
          <Input id={id("last")} name="last_name" defaultValue={values.lastName} maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t("dash.contacts.company")} htmlFor={id("company")}>
          <Input id={id("company")} name="company" defaultValue={values.company} maxLength={190} autoComplete="off" />
        </Field>
        <Field label={t("dash.contacts.timezone")} htmlFor={id("tz")} hint={t("dash.contacts.timezoneHint")}>
          <Select id={id("tz")} name="timezone" defaultValue={values.timezone}>
            <option value="">{t("dash.contacts.timezoneAuto")}</option>
            {timezones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.contacts.state")} htmlFor={id("state")} hint={t("dash.contacts.stateHint")}>
          <Input id={id("state")} name="state" defaultValue={values.state} maxLength={8} dir="ltr" autoComplete="off" placeholder="FL" />
        </Field>
        <Field label={t("dash.contacts.tags")} htmlFor={id("tags")} hint={t("dash.contacts.tagsHint")}>
          <Input id={id("tags")} name="tags" defaultValue={values.tags.join(", ")} autoComplete="off" />
        </Field>
        {!editing && lists.length ? (
          <Field label={t("dash.contacts.addToList")} htmlFor={id("list")}>
            <Select id={id("list")} name="list_id" defaultValue="">
              <option value="">{t("dash.contacts.noList")}</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <input type="hidden" name="language" value={values.language} />
      <SubmitButton pendingText={t("dash.settings.saving")}>{editing ? t("dash.contacts.save") : t("dash.contacts.create")}</SubmitButton>
    </form>
  );
}

export function CreateListForm({ workspaceId }: { workspaceId: number }) {
  const t = useT();
  const uid = useId();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useRefreshingAction(async (prev, fd) => {
    const res = await createListAction(prev, fd);
    if (!res.error) ref.current?.reset();
    return res;
  });
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <Field label={t("dash.contacts.listName")} htmlFor={`${uid}-n`}>
          <Input id={`${uid}-n`} name="name" required maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t("dash.contacts.listDescription")} htmlFor={`${uid}-d`}>
          <Input id={`${uid}-d`} name="description" maxLength={500} autoComplete="off" />
        </Field>
        <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.contacts.createList")}</SubmitButton>
      </div>
    </form>
  );
}

/** Adds a consent record (evidence) to a contact. */
export function ConsentForm({ workspaceId, contactId }: { workspaceId: number; contactId: number }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useRefreshingAction(async (prev, fd) => {
    const res = await addConsentAction(prev, fd);
    if (!res.error) ref.current?.reset();
    return res;
  });
  return (
    <form ref={ref} action={action} className="space-y-4">
      <input type="hidden" name="wid" value={workspaceId} />
      <input type="hidden" name="contact_id" value={contactId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.consent.type")} htmlFor={id("type")}>
          <Select id={id("type")} name="type" defaultValue="pewc">
            {CONSENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`dash.consent.type.${c}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.consent.purpose")} htmlFor={id("purpose")}>
          <Select id={id("purpose")} name="purpose" defaultValue="any">
            <option value="any">{t("dash.consent.purpose.any")}</option>
            <option value="informational">{t("dash.consent.purpose.informational")}</option>
            <option value="telemarketing">{t("dash.consent.purpose.telemarketing")}</option>
          </Select>
        </Field>
        <Field label={t("dash.consent.source")} htmlFor={id("source")}>
          <Select id={id("source")} name="source" defaultValue="web_form">
            {CONSENT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`dash.consent.source.${s}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.consent.capturedAt")} htmlFor={id("at")} hint={t("dash.consent.capturedAtHint")}>
          <Input id={id("at")} name="captured_at" type="datetime-local" dir="ltr" />
        </Field>
        <Field label={t("dash.consent.sourceUrl")} htmlFor={id("url")}>
          <Input id={id("url")} name="source_url" type="url" dir="ltr" placeholder="https://example.com/form" />
        </Field>
        <Field label={t("dash.consent.ip")} htmlFor={id("ip")}>
          <Input id={id("ip")} name="ip" dir="ltr" maxLength={64} autoComplete="off" />
        </Field>
      </div>
      <Field label={t("dash.consent.text")} htmlFor={id("text")} hint={t("dash.consent.textHint")}>
        <Textarea id={id("text")} name="text" required minLength={10} maxLength={5000} className="min-h-24" />
      </Field>
      <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.consent.add")}</SubmitButton>
    </form>
  );
}

const DNC_REASON_OPTIONS = ["manual", "national_dnc", "tps", "complaint", "opt_out"] as const;

/** One number onto the workspace's do-not-call list. */
export function DncAddForm({ workspaceId }: { workspaceId: number }) {
  const t = useT();
  const uid = useId();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useRefreshingAction(async (prev, fd) => {
    const res = await addDncAction(prev, fd);
    if (!res.error) ref.current?.reset();
    return res;
  });
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("dash.contacts.phone")} htmlFor={`${uid}-p`}>
          <Input id={`${uid}-p`} name="phone" required dir="ltr" inputMode="tel" autoComplete="off" placeholder="+1 415 555 0123" />
        </Field>
        <Field label={t("dash.dnc.reason")} htmlFor={`${uid}-r`}>
          <Select id={`${uid}-r`} name="reason" defaultValue="manual">
            {DNC_REASON_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {t(`dash.dnc.reason.${r}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.dnc.note")} htmlFor={`${uid}-n`}>
          <Input id={`${uid}-n`} name="note" maxLength={500} autoComplete="off" />
        </Field>
        <Field label={t("dash.dnc.expiresDays")} htmlFor={`${uid}-e`} hint={t("dash.dnc.expiresNever")}>
          <Input id={`${uid}-e`} name="expires_days" type="number" min={0} max={3650} dir="ltr" placeholder="0" />
        </Field>
      </div>
      <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.dnc.add")}</SubmitButton>
    </form>
  );
}

/** Upload of a national DNC / TPS extract or an internal list (file and/or pasted numbers). */
export function DncUploadForm({ workspaceId }: { workspaceId: number }) {
  const t = useT();
  const uid = useId();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action] = useRefreshingAction(async (prev, fd) => {
    const res = await uploadDncAction(prev, fd);
    if (!res.error) ref.current?.reset();
    return res;
  });
  return (
    <form ref={ref} action={action} className="space-y-3">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("dash.dnc.listType")} htmlFor={`${uid}-r`}>
          <Select id={`${uid}-r`} name="reason" defaultValue="national_dnc">
            {(["national_dnc", "tps", "manual", "complaint"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`dash.dnc.reason.${r}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.dnc.listRef")} htmlFor={`${uid}-l`} hint={t("dash.dnc.listRefHint")}>
          <Input id={`${uid}-l`} name="list_ref" maxLength={120} autoComplete="off" placeholder="SAN 1234567 · 2026-10-20" />
        </Field>
        <Field label={t("dash.dnc.file")} htmlFor={`${uid}-f`} hint={t("dash.dnc.fileHint")}>
          <Input id={`${uid}-f`} name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="py-1.5" />
        </Field>
        <Field label={t("dash.dnc.expiresDays")} htmlFor={`${uid}-e`} hint={t("dash.dnc.expiresUploadHint")}>
          <Input id={`${uid}-e`} name="expires_days" type="number" min={0} max={3650} dir="ltr" placeholder="31" />
        </Field>
      </div>
      <Field label={t("dash.dnc.paste")} htmlFor={`${uid}-t`}>
        <Textarea id={`${uid}-t`} name="numbers" className="min-h-24 font-mono text-[13px]" dir="ltr" placeholder={"+14155550123\n+14155550124"} />
      </Field>
      <SubmitButton pendingText={t("dash.dnc.uploading")}>{t("dash.dnc.upload")}</SubmitButton>
    </form>
  );
}

/** A submit button that asks first (bulk delete…). Its name/value tell the action what to do. */
export function ConfirmSubmit({ name, value, confirmText, className, children }: { name: string; value: string; confirmText: string; className?: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
