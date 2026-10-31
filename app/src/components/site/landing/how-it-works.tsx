import { ArrowRight, Bot, CalendarCheck, Check, Globe, Headset, MessageCircle, Phone, PhoneOutgoing, Play, Sparkles } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { clock, duration, EXAMPLE_PHONE, num, weekdayName } from "./format";
import { Pill, Waveform } from "./mock-kit";
import { SectionHeading } from "./section-heading";

/** Four steps from building an agent to reviewing its calls, each with a small illustration. */
export function HowItWorks({ t, locale }: { t: Translator; locale: string }) {
  const steps = [
    {
      title: t("home.step1Title"),
      text: t("home.step1Text"),
      visual: (
        <div aria-hidden className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <span className="flex items-center gap-2 rounded-lg bg-primary-soft px-2.5 py-2 text-xs font-semibold ring-1 ring-primary-line ring-inset">
            <Headset className="size-4 shrink-0 text-primary-text" />
            <span className="min-w-0 flex-1 truncate">{t("home.tpl.receptionist")}</span>
            <Check className="size-3.5 shrink-0 text-primary-text" strokeWidth={3} />
          </span>
          <span className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-muted ring-1 ring-line ring-inset">
            <CalendarCheck className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("home.tpl.appointment_booking")}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-primary to-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white rtl:bg-gradient-to-l">
            <Sparkles className="size-3" />
            {t("home.step1Ai")}
          </span>
        </div>
      ),
    },
    {
      title: t("home.step2Title"),
      text: t("home.step2Text"),
      visual: (
        <div aria-hidden className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <span className="flex items-center gap-2 text-xs">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text">
              <Phone className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <bdi dir="ltr" className="block truncate font-semibold tabular-nums">
                {EXAMPLE_PHONE.line}
              </bdi>
              <span className="block truncate text-[10px] text-muted">{t("home.step2Routed")}</span>
            </span>
          </span>
          <span className="flex items-center gap-2 border-t border-line pt-2 text-xs">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text">
              <Globe className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{t("home.step2Widget")}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-white shadow-sm shadow-primary/30">
              <MessageCircle className="size-3" />
              {t("home.step2Talk")}
            </span>
          </span>
        </div>
      ),
    },
    {
      title: t("home.step3Title"),
      text: t("home.step3Text"),
      visual: (
        <div aria-hidden className="space-y-1.5 rounded-xl border border-line bg-surface p-3 text-[11px]">
          {(
            [
              [Phone, t("home.step3Answered"), "good"],
              [CalendarCheck, t("home.step3Booked", { when: `${weekdayName(4, locale)} ${clock(10, 30, locale)}` }), "good"],
              [PhoneOutgoing, t("home.step3Reminder"), "info"],
            ] as const
          ).map(([Icon, label, tone], i) => (
            <span key={i} className="flex items-center gap-2">
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", tone === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-primary-soft text-primary-text")}>
                <Icon className="size-3" />
              </span>
              <span className="min-w-0 truncate">{label}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      title: t("home.step4Title"),
      text: t("home.step4Text"),
      visual: (
        <div aria-hidden className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <span className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-white">
              <Play className="size-3 fill-current rtl:-scale-x-100" />
            </span>
            <Waveform bars={30} seed={5} progress={0.42} className="h-6 flex-1" />
            <bdi className="text-[10px] text-muted tabular-nums">{duration(134, locale)}</bdi>
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <Pill tone="good">{t("home.mock.positive")}</Pill>
            <Pill tone="info">
              <Bot className="size-3" />
              {t("home.step4Summary")}
            </Pill>
            <Pill>{t("home.step4Fields", { n: num(4, locale) })}</Pill>
          </span>
        </div>
      ),
    },
  ];

  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 border-b border-line bg-surface py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading id="how-title" align="center" eyebrow={t("home.howEyebrow")} title={t("home.howTitle")} text={t("home.howText")} />
        <ol className="relative mt-16 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <span aria-hidden className="absolute inset-x-[12%] top-14 hidden border-t-2 border-dashed border-primary-line xl:block" />
          {steps.map((step, i) => (
            <li key={step.title} className="relative flex flex-col rounded-2xl border border-line bg-paper p-6">
              <span className="flex items-center justify-between gap-3">
                <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl bg-primary font-display text-2xl font-bold text-white shadow-lg shadow-primary/30">
                  <span className="sr-only">{t("home.howStep", { n: i + 1 })}</span>
                  <span aria-hidden>{num(i + 1, locale)}</span>
                </span>
                {i < steps.length - 1 ? <ArrowRight aria-hidden className="size-4 text-primary-text/60 xl:hidden rtl:rotate-180" /> : null}
              </span>
              <h3 className="mt-6 text-xl font-bold tall-script:leading-snug">{step.title}</h3>
              <p className="mt-2 flex-1 leading-relaxed text-muted">{step.text}</p>
              <div className="mt-6">{step.visual}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
