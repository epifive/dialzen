import { BadgeCheck, Ban, CircleCheck, CircleX, Clock3, FileCheck2, Fingerprint, Gauge, Info, Mic, ScrollText, ShieldCheck, UserCheck } from "lucide-react";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { clock, dateLabel, EXAMPLE_PHONE, num } from "./format";
import { MockLabel, Pill } from "./mock-kit";
import { SectionHeading } from "./section-heading";

const ITEMS: Array<{ icon: typeof ShieldCheck; key: string }> = [
  { icon: BadgeCheck, key: "disclosure" },
  { icon: FileCheck2, key: "consent" },
  { icon: Ban, key: "dnc" },
  { icon: Clock3, key: "hours" },
  { icon: Mic, key: "recording" },
  { icon: UserCheck, key: "kyc" },
  { icon: Gauge, key: "caps" },
  { icon: ScrollText, key: "audit" },
];

/** The checks made right before one outbound call, as the audit log records them. */
function PreDialMockup({ t, locale }: { t: Translator; locale: string }) {
  const checks: Array<[boolean, string, string]> = [
    [true, t("home.comp.chkConsent"), t("home.comp.chkConsentValue", { date: dateLabel(-36, locale, { day: "numeric", month: "short" }) })],
    [true, t("home.comp.chkDnc"), t("home.comp.chkDncValue")],
    [true, t("home.comp.chkHours"), t("home.comp.chkHoursValue", { time: clock(10, 12, locale) })],
    [true, t("home.comp.chkCaps"), t("home.comp.chkCapsValue", { n: num(1, locale), max: num(3, locale) })],
  ];
  return (
    <div role="img" aria-label={t("home.comp.mockLabel")} className="relative mx-auto w-full max-w-[520px] select-none">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-emerald-300/20 via-primary/15 to-transparent blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(112,26,117,0.5)] dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <ShieldCheck className="size-4 text-primary-text" />
          <span className="text-[13px] font-semibold">{t("home.comp.mockTitle")}</span>
          <bdi dir="ltr" className="ms-auto text-[11px] text-muted tabular-nums">
            {EXAMPLE_PHONE.contact}
          </bdi>
        </div>
        <ul className="divide-y divide-line">
          {checks.map(([ok, label, value]) => (
            <li key={label} className="flex items-start gap-2.5 px-4 py-2.5">
              {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-red-600" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold">{label}</span>
                <span className="block text-[11px] text-muted">{value}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-line bg-emerald-500/8 px-4 py-2.5 text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="size-4" />
          {t("home.comp.dialing")}
        </div>
      </div>

      {/* A blocked contact, and what the audit log keeps. */}
      <div className="relative z-10 mx-4 mt-3 space-y-2 rounded-2xl border border-line bg-surface/95 p-3.5 shadow-[0_24px_50px_-18px_rgba(74,4,78,0.42)] backdrop-blur sm:mx-10 dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.85)]">
        <span className="flex items-center gap-2">
          <Pill tone="bad">
            <Ban className="size-3" />
            {t("home.comp.blocked")}
          </Pill>
          <span className="min-w-0 truncate text-[11px] text-muted">{t("home.comp.blockedText")}</span>
        </span>
        <MockLabel>{t("home.comp.auditTitle")}</MockLabel>
        <ul className="space-y-1 font-mono text-[10.5px] text-muted">
          {(["call.blocked", "dnc.added", "opt_out.recorded"] as const).map((event, i) => (
            <li key={event} className="flex items-center gap-2">
              <bdi className="shrink-0 tabular-nums">{clock(10, 12 - i * 3, locale)}</bdi>
              <code dir="ltr" className={cn("truncate", i === 0 && "text-ink")}>
                {event}
              </code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Compliance({ t, locale }: { t: Translator; locale: string }) {
  return (
    <section id="compliance" aria-labelledby="comp-title" className="scroll-mt-16 overflow-x-clip border-y border-line bg-surface py-24 sm:py-28">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
        <div>
          <SectionHeading id="comp-title" eyebrow={t("home.comp.eyebrow")} title={t("home.comp.title")} text={t("home.comp.text")} />
          <ul className="mt-10 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            {ITEMS.map(({ icon: Icon, key }) => (
              <li key={key} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-text">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <h3 className="font-semibold tall-script:leading-snug">{t(`home.comp.${key}Title` as MessageKey)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{t(`home.comp.${key}Text` as MessageKey)}</p>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-10 flex items-start gap-2.5 rounded-xl border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
            <span>{t("home.comp.disclaimer")}</span>
          </p>
        </div>
        <div className="min-w-0">
          <PreDialMockup t={t} locale={locale} />
          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <Fingerprint className="size-3.5 shrink-0" aria-hidden />
            {t("home.comp.mockNote")}
          </p>
        </div>
      </div>
    </section>
  );
}
