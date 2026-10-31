import { Ban, CircleCheck, Clock, Download, Gauge, PhoneIncoming, Play, Webhook } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { clock, dateLabel, duration, EXAMPLE_PHONE, num, weekdayName } from "./format";
import { ToolEvent, Turn } from "./hero-mockup";
import { FLOAT_SHADOW, MockLabel, Pill, Waveform, WindowFrame } from "./mock-kit";
import { Showcase } from "./showcase";

/** A finished call (dashboard → Calls → a call): recording, transcript, summary, extracted data and compliance facts. */
function CallMockup({ t, locale }: { t: Translator; locale: string }) {
  const thursday = `${weekdayName(4, locale, "long")} ${clock(10, 30, locale)}`;
  const fields: Array<[string, string]> = [
    [t("home.call.fieldBooked"), t("home.mock.yes")],
    [t("home.call.fieldTime"), `${dateLabel(4, locale, { day: "numeric", month: "short" })} ${clock(10, 30, locale)}`],
    [t("home.call.fieldService"), t("home.mock.service")],
    [t("home.call.fieldName"), t("home.call.callerName")],
  ];
  return (
    <div role="img" aria-label={t("home.call.mockLabel")} className="relative mx-auto w-full max-w-[620px] select-none">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-primary/25 via-rose-300/20 to-transparent blur-3xl" />
      <WindowFrame
        title={<bdi>{t("home.call.callerName")}</bdi>}
        extra={
          <>
            <Pill tone="good">{t("home.call.completed")}</Pill>
            <Pill tone="good" className="max-[420px]:hidden">
              {t("home.mock.positive")}
            </Pill>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1">
            <PhoneIncoming className="size-3.5" />
            {t("home.call.inbound")}
          </span>
          <bdi dir="ltr" className="tabular-nums">
            {EXAMPLE_PHONE.caller}
          </bdi>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            <bdi className="tabular-nums">{duration(134, locale)}</bdi>
          </span>
          <span className="inline-flex items-center gap-1 max-sm:hidden">
            <Gauge className="size-3.5" />
            {t("home.call.latency", { ms: num(640, locale) })}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="min-w-0 space-y-3 p-3 sm:p-4">
            {/* Recording player */}
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-paper/60 px-3 py-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-white shadow-sm shadow-primary/30">
                <Play className="size-3.5 fill-current rtl:-scale-x-100" />
              </span>
              <Waveform bars={44} seed={7} progress={0.36} className="h-8 flex-1" />
              <bdi className="shrink-0 text-[10px] text-muted tabular-nums">
                {duration(48, locale)} / {duration(134, locale)}
              </bdi>
              <Download className="size-3.5 shrink-0 text-muted max-sm:hidden" />
            </div>
            {/* Transcript */}
            <ol className="space-y-2.5">
              <Turn who="agent" label={t("home.mock.agent")} at={duration(0, locale)}>
                {t("home.call.turn1")}
              </Turn>
              <Turn who="caller" label={t("home.mock.caller")} at={duration(5, locale)}>
                {t("home.call.turn2")}
              </Turn>
              <Turn who="agent" label={t("home.mock.agent")} at={duration(12, locale)}>
                {t("home.call.turn3")}
              </Turn>
              <ToolEvent name="book_appointment" detail={t("home.mock.toolDetail", { ms: num(236, locale) })} />
              <Turn who="agent" label={t("home.mock.agent")} at={duration(41, locale)} className="max-sm:hidden">
                {t("home.call.turn4", { slot: thursday })}
              </Turn>
            </ol>
          </div>

          <div className="min-w-0 space-y-3 border-t border-line bg-paper/60 p-3 sm:border-t-0 sm:border-s">
            <div className="rounded-xl border border-line bg-surface p-2.5">
              <MockLabel>{t("home.call.summary")}</MockLabel>
              <p dir="auto" className="mt-1 text-[11px] leading-snug">
                {t("home.call.summaryText", { slot: thursday })}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface">
              <MockLabel className="px-2.5 pt-2.5">{t("home.call.extracted")}</MockLabel>
              <dl className="mt-1 divide-y divide-line">
                {fields.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5 text-[11px]">
                    <dt className="min-w-0 truncate text-muted">{label}</dt>
                    <dd className="shrink-0 font-semibold">
                      <bdi>{value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="space-y-1 rounded-xl border border-line bg-surface p-2.5 text-[11px] max-sm:hidden">
              <MockLabel>{t("home.call.compliance")}</MockLabel>
              {[t("home.call.disclosure"), t("home.call.recordingNotice")].map((label) => (
                <span key={label} className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <CircleCheck className="size-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
              ))}
              <span className="flex items-center gap-1.5 text-muted">
                <Ban className="size-3.5 shrink-0" />
                <span className="truncate">{t("home.call.noOptOut")}</span>
              </span>
            </div>
          </div>
        </div>
      </WindowFrame>

      {/* Webhook delivery */}
      <div
        aria-hidden
        className={cn(
          "absolute -end-4 -bottom-16 z-10 hidden w-[250px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.6s_both] items-start gap-2.5 rounded-xl border border-line bg-surface/95 p-3 backdrop-blur motion-reduce:animate-none sm:flex xl:-end-12",
          FLOAT_SHADOW,
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-white">
          <Webhook className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <code dir="ltr" className="block font-mono text-[11.5px] font-semibold">
            call_completed
          </code>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t("home.call.webhookText")}</span>
        </span>
      </div>
    </div>
  );
}

export function CallShowcase({ t, locale }: { t: Translator; locale: string }) {
  return (
    <Showcase
      id="calls"
      reverse
      tinted
      eyebrow={t("home.call.eyebrow")}
      title={t("home.call.title")}
      text={t("home.call.text")}
      points={[t("home.call.point1"), t("home.call.point2"), t("home.call.point3"), t("home.call.point4")]}
      visual={<CallMockup t={t} locale={locale} />}
    />
  );
}
