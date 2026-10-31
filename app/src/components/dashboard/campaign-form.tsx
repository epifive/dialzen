"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { saveCampaignAction } from "@/app/actions/dashboard/campaigns";
import { initialFormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { RETRYABLE_OUTCOMES, type RetryableOutcome } from "@/voice/types";

export interface CampaignFormValues {
  id?: number;
  name: string;
  agentId: number | null;
  numberIds: number[];
  listIds: number[];
  purpose: "informational" | "telemarketing";
  /** "YYYY-MM-DDTHH:MM" in the workspace's zone ("" = none). */
  startsAt: string;
  endsAt: string;
  window: { start: string; end: string; days: number[] };
  timezoneMode: "contact" | "campaign";
  timezone: string;
  maxAttempts: number;
  retryOn: RetryableOutcome[];
  retryDelays: Record<RetryableOutcome, number>;
  concurrency: number;
  dailyCap: number;
  variables: Record<string, string>;
  abandonMaxPct: number;
}

export interface CampaignFormOptions {
  agents: Array<{ id: number; name: string; provider: string; status: string }>;
  numbers: Array<{ id: number; e164: string; label: string; provider: string; outboundEnabled: boolean; active: boolean; dailyDialCap: number }>;
  lists: Array<{ id: number; name: string; members: number }>;
  /** The plan's concurrent calls (-1 = unlimited). */
  maxConcurrency: number;
  timezones: string[];
  workspaceTimezone: string;
  weekStart: 1 | 7;
}

const DAY_KEYS: Record<number, MessageKey> = {
  1: "dash.campaigns.day.1",
  2: "dash.campaigns.day.2",
  3: "dash.campaigns.day.3",
  4: "dash.campaigns.day.4",
  5: "dash.campaigns.day.5",
  6: "dash.campaigns.day.6",
  7: "dash.campaigns.day.7",
};

function Section({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {text ? <p className="-mt-2 text-xs text-muted">{text}</p> : null}
      {children}
    </fieldset>
  );
}

/** Create or edit a campaign (draft, scheduled or paused). */
export function CampaignForm({ workspaceId, values, options }: { workspaceId: number; values: CampaignFormValues; options: CampaignFormOptions }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, action] = useActionState(saveCampaignAction, initialFormState);
  const [agentId, setAgentId] = useState(values.agentId ? String(values.agentId) : "");
  const [purpose, setPurpose] = useState(values.purpose);
  const [mode, setMode] = useState(values.timezoneMode);
  const agent = options.agents.find((a) => String(a.id) === agentId);
  const cap = options.maxConcurrency < 0 ? 50 : Math.max(1, Math.min(50, options.maxConcurrency));
  const days = options.weekStart === 7 ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="wid" value={workspaceId} />
      {values.id ? <input type="hidden" name="campaign_id" value={values.id} /> : null}
      <FormMessage state={state} />

      <Section title={t("dash.campaigns.f.basics")}>
        <Field label={t("dash.campaigns.f.name")} htmlFor={id("name")}>
          <Input id={id("name")} name="name" defaultValue={values.name} required maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t("dash.campaigns.f.agent")} htmlFor={id("agent")} hint={t("dash.campaigns.f.agentHint")}>
          <Select id={id("agent")} name="agent_id" value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
            <option value="" disabled>
              {t("dash.campaigns.f.chooseAgent")}
            </option>
            {options.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("dash.campaigns.f.purpose")}</p>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t("dash.campaigns.f.purpose")}>
            {(["informational", "telemarketing"] as const).map((p) => (
              <label key={p} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3 text-sm", purpose === p ? "border-primary bg-primary-soft" : "border-line")}>
                <input type="radio" name="purpose" value={p} checked={purpose === p} onChange={() => setPurpose(p)} className="mt-0.5 accent-[var(--primary)]" />
                <span>
                  <span className="block font-medium">{t(`dash.campaigns.purpose.${p}`)}</span>
                  <span className="mt-0.5 block text-xs text-muted">{t(`dash.campaigns.purposeText.${p}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("dash.campaigns.f.who")} text={t("dash.campaigns.f.whoText")}>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("dash.campaigns.f.lists")}</p>
          {options.lists.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {options.lists.map((l) => (
                <Checkbox key={l.id} name="list_ids" value={l.id} defaultChecked={values.listIds.includes(l.id)} label={`${l.name} (${l.members.toLocaleString()})`} />
              ))}
            </div>
          ) : (
            <Alert tone="warning">{t("dash.campaigns.f.noLists")}</Alert>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("dash.campaigns.f.numbers")}</p>
          <p className="mb-2 text-xs text-muted">{t("dash.campaigns.f.numbersHint")}</p>
          {options.numbers.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {options.numbers.map((n) => {
                const mismatch = Boolean(agent && agent.provider !== n.provider);
                const off = !n.outboundEnabled || !n.active;
                return (
                  <label key={n.id} className={cn("flex items-start gap-2 text-sm", (mismatch || off) && "opacity-70")}>
                    <input type="checkbox" name="number_ids" value={n.id} defaultChecked={values.numberIds.includes(n.id)} className="mt-0.5 size-4 rounded border-line accent-[var(--primary)]" />
                    <span>
                      <bdi dir="ltr" className="font-mono text-[13px]">
                        {n.e164}
                      </bdi>
                      {n.label ? <span className="text-muted"> · {n.label}</span> : null}
                      <span className="block text-xs text-muted">
                        {mismatch ? t("dash.campaigns.f.numberMismatch") : off ? t("dash.campaigns.f.numberOff") : t("dash.campaigns.f.numberCap", { n: n.dailyDialCap })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <Alert tone="warning">{t("dash.campaigns.f.noNumbers")}</Alert>
          )}
        </div>
      </Section>

      <Section title={t("dash.campaigns.f.when")} text={t("dash.campaigns.f.whenText")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.campaigns.f.startsAt")} htmlFor={id("start")} hint={t("dash.campaigns.f.startsAtHint", { tz: options.workspaceTimezone.replaceAll("_", " ") })}>
            <Input id={id("start")} name="starts_at" type="datetime-local" defaultValue={values.startsAt} dir="ltr" />
          </Field>
          <Field label={t("dash.campaigns.f.endsAt")} htmlFor={id("end")} hint={t("dash.campaigns.f.endsAtHint")}>
            <Input id={id("end")} name="ends_at" type="datetime-local" defaultValue={values.endsAt} dir="ltr" />
          </Field>
          <Field label={t("dash.campaigns.f.windowStart")} htmlFor={id("ws")}>
            <Input id={id("ws")} name="window_start" type="time" defaultValue={values.window.start} required dir="ltr" />
          </Field>
          <Field label={t("dash.campaigns.f.windowEnd")} htmlFor={id("we")}>
            <Input id={id("we")} name="window_end" type="time" defaultValue={values.window.end} required dir="ltr" />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("dash.campaigns.f.days")}</p>
          <div className="flex flex-wrap gap-3">
            {days.map((d) => (
              <Checkbox key={d} name="days" value={d} defaultChecked={values.window.days.includes(d)} label={t(DAY_KEYS[d])} />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.campaigns.f.tzMode")} htmlFor={id("mode")}>
            <Select id={id("mode")} name="timezone_mode" value={mode} onChange={(e) => setMode(e.target.value === "campaign" ? "campaign" : "contact")}>
              <option value="contact">{t("dash.campaigns.f.tzContact")}</option>
              <option value="campaign">{t("dash.campaigns.f.tzCampaign")}</option>
            </Select>
          </Field>
          {mode === "campaign" ? (
            <Field label={t("dash.campaigns.f.timezone")} htmlFor={id("tz")}>
              <Select id={id("tz")} name="timezone" defaultValue={values.timezone || options.workspaceTimezone}>
                {options.timezones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="timezone" value={values.timezone || options.workspaceTimezone} />
          )}
        </div>
        <p className="text-xs text-muted">{t("dash.campaigns.f.windowNote")}</p>
      </Section>

      <Section title={t("dash.campaigns.f.retries")} text={t("dash.campaigns.f.retriesText")}>
        <Field label={t("dash.campaigns.f.maxAttempts")} htmlFor={id("att")} className="max-w-xs">
          <Input id={id("att")} name="max_attempts" type="number" min={1} max={10} defaultValue={values.maxAttempts} dir="ltr" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {RETRYABLE_OUTCOMES.map((o) => (
            <div key={o} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
              <Checkbox name="retry_on" value={o} defaultChecked={values.retryOn.includes(o)} label={t(`dash.campaigns.outcome.${o}`)} className="min-w-28 flex-1" />
              <label className="flex items-center gap-2 text-xs text-muted">
                {t("dash.campaigns.f.after")}
                <Input name={`delay_${o}`} type="number" min={5} max={10080} defaultValue={values.retryDelays[o]} className="h-8 w-24" dir="ltr" aria-label={t("dash.campaigns.f.delayOf", { outcome: t(`dash.campaigns.outcome.${o}`) })} />
                {t("dash.campaigns.f.minutes")}
              </label>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("dash.campaigns.f.pacing")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("dash.campaigns.f.concurrency")} htmlFor={id("conc")} hint={t("dash.campaigns.f.concurrencyHint", { n: cap })}>
            <Input id={id("conc")} name="concurrency" type="number" min={1} max={cap} defaultValue={Math.min(values.concurrency, cap)} dir="ltr" />
          </Field>
          <Field label={t("dash.campaigns.f.dailyCap")} htmlFor={id("cap")} hint={t("dash.campaigns.f.dailyCapHint")}>
            <Input id={id("cap")} name="daily_cap" type="number" min={0} max={10000} defaultValue={values.dailyCap} dir="ltr" />
          </Field>
          <Field label={t("dash.campaigns.f.abandon")} htmlFor={id("ab")} hint={t("dash.campaigns.f.abandonHint")}>
            <Input id={id("ab")} name="abandon_max_pct" type="number" min={0} max={20} defaultValue={values.abandonMaxPct} dir="ltr" />
          </Field>
        </div>
      </Section>

      <Section title={t("dash.campaigns.f.variables")} text={t("dash.campaigns.f.variablesText")}>
        <Textarea
          name="variables"
          defaultValue={Object.entries(values.variables)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")}
          className="min-h-20 font-mono text-[13px]"
          dir="ltr"
          placeholder={"offer=20% off\nappointment_day=Friday"}
          aria-label={t("dash.campaigns.f.variables")}
        />
      </Section>

      <Alert tone="warning">{t("dash.campaigns.f.responsibility")}</Alert>
      <SubmitButton pendingText={t("dash.settings.saving")}>{values.id ? t("dash.campaigns.f.save") : t("dash.campaigns.f.create")}</SubmitButton>
    </form>
  );
}
