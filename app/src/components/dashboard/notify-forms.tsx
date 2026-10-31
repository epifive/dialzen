"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Gamepad2, Hash, KeyRound, Mail, Send, Users, Webhook, type LucideIcon } from "lucide-react";
import { saveNotifyChannelAction } from "@/app/actions/dashboard/notifications";
import { initialFormState } from "@/app/actions/types";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { NOTIFY_EVENTS, type NotifyChannelType, type NotifyEvent } from "@/voice/types";

export interface NotifyFormValues {
  id?: number;
  type: NotifyChannelType;
  name: string;
  config: Record<string, string>;
  events: NotifyEvent[];
  isActive: boolean;
}

const ICONS: Record<NotifyChannelType, LucideIcon> = {
  email: Mail,
  webhook: Webhook,
  slack: Hash,
  discord: Gamepad2,
  telegram: Send,
  teams: Users,
};

/** Icon of a notification channel type (usable from Server Components). */
export function NotifyIcon({ type, className }: { type: NotifyChannelType; className?: string }) {
  const Icon = ICONS[type] ?? Webhook;
  return <Icon className={className} aria-hidden />;
}

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Text input for secrets with a show/hide toggle. */
function SecretInput({ id, name, value, onChange, placeholder }: { id: string; name: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pe-10 font-mono text-[13px]"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        aria-label={shown ? t("dash.notify.hide") : t("dash.notify.show")}
        className="absolute end-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink"
      >
        {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

const HOW_TO: Partial<Record<NotifyChannelType, MessageKey[]>> = {
  slack: ["dash.notify.how.slack1", "dash.notify.how.slack2", "dash.notify.how.slack3"],
  discord: ["dash.notify.how.discord1", "dash.notify.how.discord2", "dash.notify.how.discord3"],
  teams: ["dash.notify.how.teams1", "dash.notify.how.teams2", "dash.notify.how.teams3"],
  telegram: ["dash.notify.how.telegram1", "dash.notify.how.telegram2", "dash.notify.how.telegram3", "dash.notify.how.telegram4"],
  webhook: ["dash.notify.how.webhook1", "dash.notify.how.webhook2"],
};

export function NotifyChannelForm({ workspaceId, values }: { workspaceId: number; values: NotifyFormValues }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, action] = useActionState(saveNotifyChannelAction, initialFormState);
  const [config, setConfig] = useState(values.config);
  const set = (key: string) => (v: string) => setConfig((c) => ({ ...c, [key]: v }));
  const type = values.type;
  const steps = HOW_TO[type];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
      <form action={action} className="min-w-0 space-y-5">
        <input type="hidden" name="wid" value={workspaceId} />
        {values.id ? <input type="hidden" name="channel_id" value={values.id} /> : null}
        <input type="hidden" name="type" value={type} />
        <FormMessage state={state} />
        <Field label={t("dash.notify.name")} htmlFor={id("name")} hint={t("dash.notify.nameHint")}>
          <Input id={id("name")} name="name" defaultValue={values.name} maxLength={120} placeholder={t(`dash.notify.type.${type}` as MessageKey)} autoComplete="off" />
        </Field>

        {type === "email" ? (
          <Field label={t("dash.notify.emails")} htmlFor={id("to")} hint={t("dash.notify.emailsHint")}>
            <Textarea id={id("to")} name="to" value={config.to ?? ""} onChange={(e) => set("to")(e.target.value)} required className="min-h-20" dir="ltr" placeholder="team@example.com, me@example.com" />
          </Field>
        ) : null}

        {type === "webhook" ? (
          <>
            <Field label={t("dash.notify.webhookUrl")} htmlFor={id("url")}>
              <Input id={id("url")} name="url" type="url" value={config.url ?? ""} onChange={(e) => set("url")(e.target.value)} required placeholder="https://example.com/hooks/dialzen" dir="ltr" spellCheck={false} />
            </Field>
            <Field label={t("dash.notify.secret")} htmlFor={id("secret")} hint={t("dash.notify.secretHint")}>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <SecretInput id={id("secret")} name="secret" value={config.secret ?? ""} onChange={set("secret")} />
                </div>
                <Button variant="outline" onClick={() => set("secret")(randomSecret())}>
                  <KeyRound aria-hidden />
                  {t("dash.notify.generate")}
                </Button>
              </div>
            </Field>
          </>
        ) : null}

        {type === "slack" || type === "discord" || type === "teams" ? (
          <Field label={t("dash.notify.incomingUrl")} htmlFor={id("hook")}>
            <Input
              id={id("hook")}
              name="webhookUrl"
              type="url"
              value={config.webhookUrl ?? ""}
              onChange={(e) => set("webhookUrl")(e.target.value)}
              required
              placeholder={type === "slack" ? "https://hooks.slack.com/services/…" : type === "discord" ? "https://discord.com/api/webhooks/…" : "https://….webhook.office.com/…"}
              dir="ltr"
              spellCheck={false}
            />
          </Field>
        ) : null}

        {type === "telegram" ? (
          <>
            <Field label={t("dash.notify.botToken")} htmlFor={id("bot")}>
              <SecretInput id={id("bot")} name="botToken" value={config.botToken ?? ""} onChange={set("botToken")} placeholder="123456789:AA…" />
            </Field>
            <Field label={t("dash.notify.chatId")} htmlFor={id("chat")} hint={t("dash.notify.chatIdHint")}>
              <Input id={id("chat")} name="chatId" value={config.chatId ?? ""} onChange={(e) => set("chatId")(e.target.value)} required placeholder="-1001234567890" dir="ltr" spellCheck={false} className="max-w-72" />
            </Field>
          </>
        ) : null}

        <fieldset>
          <legend className="text-sm font-medium">{t("dash.notify.events")}</legend>
          <p className="mt-0.5 text-xs text-muted">{t("dash.notify.eventsHint")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {NOTIFY_EVENTS.filter((e) => e !== "test").map((event) => (
              <Checkbox key={event} name="events" value={event} defaultChecked={values.events.includes(event)} label={t(`dash.notify.event.${event}` as MessageKey)} />
            ))}
          </div>
        </fieldset>

        {values.id ? <Switch name="active" label={t("dash.notify.active")} description={t("dash.notify.activeHint")} defaultChecked={values.isActive} /> : <input type="hidden" name="active" value="on" />}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <SubmitButton pendingText={t("dash.notify.saving")}>{values.id ? t("dash.notify.save") : t("dash.notify.create")}</SubmitButton>
          <Link href={`/dashboard/w/${workspaceId}/notifications`} className="text-sm font-medium text-muted hover:text-ink">
            {t("dash.notify.cancel")}
          </Link>
        </div>
      </form>

      {steps ? (
        <aside className="h-fit rounded-xl border border-line bg-paper p-5">
          <p className="text-sm font-semibold">{t("dash.notify.howTitle")}</p>
          <ol className="mt-3 space-y-2.5 text-sm text-muted">
            {steps.map((key, i) => (
              <li key={key} className="flex gap-2.5">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">{i + 1}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">{t(key)}</span>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}
    </div>
  );
}
