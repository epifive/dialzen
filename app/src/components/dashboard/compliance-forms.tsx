"use client";

import { useId, useState } from "react";
import { requestOutboundAction, saveCallingRulesAction, saveCountryRulesAction, saveRecordingAction } from "@/app/actions/dashboard/compliance";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { ComplianceSettings } from "@/voice/types";

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Calling hours, US state rules, holidays, frequency caps and the business identity said on calls. */
export function CallingRulesForm({ workspaceId, settings, weekStart, disabled }: { workspaceId: number; settings: ComplianceSettings; weekStart: 1 | 7; disabled?: boolean }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, action] = useRefreshingAction(saveCallingRulesAction);
  const days = weekStart === 7 ? [7, ...DAYS.slice(0, 6)] : DAYS;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.compliance.businessName")} htmlFor={id("biz")} hint={t("dash.compliance.businessNameHint")}>
            <Input id={id("biz")} name="business_name" defaultValue={settings.businessName} maxLength={120} autoComplete="organization" />
          </Field>
          <Field label={t("dash.compliance.callback")} htmlFor={id("cb")} hint={t("dash.compliance.callbackHint")}>
            <Input id={id("cb")} name="callback_number" defaultValue={settings.callbackNumber} dir="ltr" inputMode="tel" placeholder="+1 415 555 0100" />
          </Field>
          <Field label={t("dash.compliance.hoursFrom")} htmlFor={id("hs")}>
            <Input id={id("hs")} name="hours_start" type="time" defaultValue={settings.callingHours.start} required dir="ltr" />
          </Field>
          <Field label={t("dash.compliance.hoursUntil")} htmlFor={id("he")}>
            <Input id={id("he")} name="hours_end" type="time" defaultValue={settings.callingHours.end} required dir="ltr" />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("dash.compliance.days")}</p>
          <div className="flex flex-wrap gap-3">
            {days.map((d) => (
              <Checkbox key={d} name="days" value={d} defaultChecked={settings.callingHours.days.includes(d)} label={t(`dash.campaigns.day.${d}` as MessageKey)} />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">{t("dash.compliance.hoursHint")}</p>
        </div>
        <Switch name="us_state_presets" defaultChecked={settings.usStatePresets} label={t("dash.compliance.statePresets")} description={t("dash.compliance.statePresetsHint")} />
        <Field label={t("dash.compliance.holidays")} htmlFor={id("hol")} hint={t("dash.compliance.holidaysHint")}>
          <Textarea id={id("hol")} name="holidays" defaultValue={settings.holidays.join("\n")} className="min-h-20 font-mono text-[13px]" dir="ltr" placeholder={"2026-12-25\n2027-01-01"} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.compliance.max24h")} htmlFor={id("m24")} hint={t("dash.compliance.max24hHint")}>
            <Input id={id("m24")} name="max_24h" type="number" min={0} max={50} defaultValue={settings.maxCallsPer24h} dir="ltr" />
          </Field>
          <Field label={t("dash.compliance.max30d")} htmlFor={id("m30")} hint={t("dash.compliance.max30dHint")}>
            <Input id={id("m30")} name="max_30d" type="number" min={0} max={500} defaultValue={settings.maxCallsPer30d} dir="ltr" />
          </Field>
        </div>
        <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.compliance.save")}</SubmitButton>
      </fieldset>
    </form>
  );
}

/** Country pack: India DLT route, EU/UK consent, blocked / allowed countries, extra opt-out phrases. */
export function CountryRulesForm({ workspaceId, settings, disabled }: { workspaceId: number; settings: ComplianceSettings; disabled?: boolean }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, action] = useRefreshingAction(saveCountryRulesAction);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="space-y-5">
        <Field label={t("dash.compliance.dlt")} htmlFor={id("dlt")} hint={t("dash.compliance.dltHint")}>
          <Select id={id("dlt")} name="india_dlt_route" defaultValue={settings.indiaDltRoute}>
            <option value="">{t("dash.compliance.dltNone")}</option>
            <option value="140">{t("dash.compliance.dlt140")}</option>
            <option value="1600">{t("dash.compliance.dlt1600")}</option>
          </Select>
        </Field>
        <Switch name="eu_require_consent" defaultChecked={settings.euRequireConsent} label={t("dash.compliance.eu")} description={t("dash.compliance.euHint")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.compliance.blocked")} htmlFor={id("bl")} hint={t("dash.compliance.countriesHint")}>
            <Input id={id("bl")} name="blocked_countries" defaultValue={settings.blockedCountries.join(", ")} dir="ltr" placeholder="CN, RU" />
          </Field>
          <Field label={t("dash.compliance.allowed")} htmlFor={id("al")} hint={t("dash.compliance.allowedHint")}>
            <Input id={id("al")} name="allowed_countries" defaultValue={settings.allowedCountries.join(", ")} dir="ltr" placeholder="US, CA" />
          </Field>
        </div>
        <Field label={t("dash.compliance.phrases")} htmlFor={id("ph")} hint={t("dash.compliance.phrasesHint")}>
          <Textarea id={id("ph")} name="opt_out_phrases" defaultValue={settings.optOutPhrases.join("\n")} className="min-h-20" dir="auto" />
        </Field>
        <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.compliance.save")}</SubmitButton>
      </fieldset>
    </form>
  );
}

export function RecordingForm({ workspaceId, settings, disabled }: { workspaceId: number; settings: ComplianceSettings; disabled?: boolean }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, action] = useRefreshingAction(saveRecordingAction);
  const [on, setOn] = useState(settings.recordingDisclosure);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="space-y-5">
        <Switch name="recording_disclosure" checked={on} onChange={(e) => setOn(e.target.checked)} label={t("dash.compliance.notice")} description={t("dash.compliance.noticeHint")} />
        <Field label={t("dash.compliance.noticeText")} htmlFor={id("txt")}>
          <Textarea id={id("txt")} name="recording_text" defaultValue={settings.recordingDisclosureText} maxLength={300} className="min-h-20" dir="auto" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.compliance.recordingDays")} htmlFor={id("rd")} hint={t("dash.compliance.keepHint")}>
            <Input id={id("rd")} name="recording_days" type="number" min={0} max={3650} defaultValue={settings.recordingRetentionDays} dir="ltr" />
          </Field>
          <Field label={t("dash.compliance.transcriptDays")} htmlFor={id("td")} hint={t("dash.compliance.keepHint")}>
            <Input id={id("td")} name="transcript_days" type="number" min={0} max={3650} defaultValue={settings.transcriptRetentionDays} dir="ltr" />
          </Field>
        </div>
        <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.compliance.save")}</SubmitButton>
      </fieldset>
    </form>
  );
}

/** Acceptable-use acceptance + the business and use-case (KYC) form the admin reviews. */
export function OutboundRequestForm({ workspaceId, aupAccepted, defaults, countries }: { workspaceId: number; aupAccepted: boolean; defaults: { businessName: string; country: string }; countries: Array<{ iso: string; name: string }> }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, action] = useRefreshingAction(requestOutboundAction);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.kyc.business")} htmlFor={id("b")}>
          <Input id={id("b")} name="business_name" defaultValue={defaults.businessName} required maxLength={190} autoComplete="organization" />
        </Field>
        <Field label={t("dash.kyc.website")} htmlFor={id("w")}>
          <Input id={id("w")} name="website" type="url" dir="ltr" placeholder="https://example.com" />
        </Field>
        <Field label={t("dash.kyc.address")} htmlFor={id("a")} className="sm:col-span-2">
          <Input id={id("a")} name="address" required maxLength={500} autoComplete="street-address" />
        </Field>
        <Field label={t("dash.kyc.country")} htmlFor={id("c")}>
          <Select id={id("c")} name="country" defaultValue={defaults.country}>
            {countries.map((c) => (
              <option key={c.iso} value={c.iso}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.kyc.volume")} htmlFor={id("v")}>
          <Input id={id("v")} name="expected_volume" maxLength={120} placeholder={t("dash.kyc.volumeHint")} />
        </Field>
      </div>
      <Field label={t("dash.kyc.useCase")} htmlFor={id("u")} hint={t("dash.kyc.useCaseHint")}>
        <Textarea id={id("u")} name="use_case" required minLength={20} maxLength={5000} className="min-h-24" />
      </Field>
      <Field label={t("dash.kyc.consent")} htmlFor={id("cm")} hint={t("dash.kyc.consentHint")}>
        <Textarea id={id("cm")} name="consent_method" required minLength={20} maxLength={5000} className="min-h-24" />
      </Field>
      <Field label={t("dash.kyc.script")} htmlFor={id("s")} hint={t("dash.kyc.scriptHint")}>
        <Textarea id={id("s")} name="sample_script" maxLength={5000} className="min-h-24" />
      </Field>
      {!aupAccepted ? (
        <div className="rounded-lg border border-line bg-paper p-4">
          <p className="text-sm font-medium">{t("dash.kyc.aupTitle")}</p>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-muted">
            <li>{t("dash.kyc.aup1")}</li>
            <li>{t("dash.kyc.aup2")}</li>
            <li>{t("dash.kyc.aup3")}</li>
            <li>{t("dash.kyc.aup4")}</li>
            <li>{t("dash.kyc.aup5")}</li>
          </ul>
          <Checkbox name="aup" required className="mt-3" label={t("dash.kyc.aupAccept")} />
        </div>
      ) : null}
      <SubmitButton pendingText={t("dash.kyc.sending")}>{t("dash.kyc.send")}</SubmitButton>
    </form>
  );
}
