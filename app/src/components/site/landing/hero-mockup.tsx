import type { ReactNode } from "react";
import { AudioLines, Bot, CalendarCheck, CircleCheck, FileText, Mic, PhoneIncoming, ShieldCheck, User, Wallet, Wrench } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { clock, duration, EXAMPLE_BUSINESS, EXAMPLE_PHONE, num, usd, weekdayName } from "./format";
import { FLOAT_SHADOW, LiveDot, Pill, TypingDots, Waveform } from "./mock-kit";

/** One transcript turn, laid out like the call page of the dashboard (agent on the start side). */
export function Turn({ who, label, at, children, className }: { who: "agent" | "caller"; label: string; at?: string; children: ReactNode; className?: string }) {
  const agent = who === "agent";
  return (
    <li className={cn("flex items-start gap-2", !agent && "flex-row-reverse", className)}>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", agent ? "bg-primary-soft text-primary-text" : "bg-line text-ink")}>
        {agent ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
      </span>
      <span className={cn("max-w-[84%] min-w-0", !agent && "text-end")}>
        <span className={cn("mb-0.5 flex items-center gap-1.5 text-[10px] text-muted", !agent && "flex-row-reverse")}>
          <span className="font-medium">{label}</span>
          {at ? <bdi className="tabular-nums">{at}</bdi> : null}
        </span>
        <span
          dir="auto"
          className={cn(
            "inline-block rounded-2xl px-3 py-1.5 text-start text-[12px] leading-snug",
            agent ? "rounded-ss-md bg-paper ring-1 ring-line ring-inset" : "rounded-se-md bg-primary text-white shadow-sm shadow-primary/25",
          )}
        >
          {children}
        </span>
      </span>
    </li>
  );
}

/** A tool call between two turns ("check_availability · Cal.com · 182 ms"). */
export function ToolEvent({ name, detail }: { name: string; detail: string }) {
  return (
    <li className="flex items-center justify-center gap-1.5 text-[10px] text-muted">
      <span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white">
        <Wrench className="size-2.5" />
      </span>
      <code dir="ltr" className="font-mono font-semibold text-ink">
        {name}
      </code>
      <bdi>{detail}</bdi>
    </li>
  );
}

/**
 * The hero illustration: a live inbound call at a dental clinic (voice waveform, transcript with
 * a calendar lookup), an "Appointment booked" notification, the post-call summary and the
 * workspace's call credits. Plain HTML/SVG.
 */
export function HeroMockup({ t, locale }: { t: Translator; locale: string }) {
  const thursday = `${weekdayName(4, locale, "long")} ${clock(10, 30, locale)}`;
  const friday = `${weekdayName(5, locale, "long")} ${clock(14, 15, locale)}`;
  const shortSlot = `${weekdayName(4, locale, "short")} ${clock(10, 30, locale)}`;
  const agentLabel = t("home.mock.agent");
  const callerLabel = t("home.mock.caller");

  return (
    <div role="img" aria-label={t("home.mock.label")} className="relative mx-auto w-full max-w-[600px] select-none">
      <div aria-hidden className="absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-primary/30 via-violet-400/15 to-transparent blur-3xl" />

      <div className="animate-tz-pop overflow-hidden rounded-[1.4rem] border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(112,26,117,0.6)] motion-reduce:animate-none dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
        {/* Call header */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 font-display text-sm font-bold text-white shadow-sm shadow-primary/30">
            {EXAMPLE_BUSINESS.initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">
              <bdi>{EXAMPLE_BUSINESS.name}</bdi> · {t("home.mock.agentName")}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted">
              <PhoneIncoming className="size-3 shrink-0" />
              <span className="truncate">{t("home.mock.inbound")}</span>
              <bdi dir="ltr" className="truncate tabular-nums max-[380px]:hidden">
                {EXAMPLE_PHONE.caller}
              </bdi>
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
            <LiveDot className="bg-red-500" />
            {t("home.mock.live")}
            <bdi className="tabular-nums">{duration(102, locale)}</bdi>
          </span>
        </div>

        {/* Voice panel */}
        <div className="relative overflow-hidden bg-[#1c0a22] px-4 py-3.5 text-white">
          <div aria-hidden className="absolute -end-10 -top-16 size-48 rounded-full bg-fuchsia-500/35 blur-3xl" />
          <div aria-hidden className="absolute -start-10 -bottom-20 size-44 rounded-full bg-violet-500/25 blur-3xl" />
          <div className="relative flex items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <LiveDot className="bg-fuchsia-300" />
              {t("home.mock.speaking")}
            </span>
            <span className="ms-auto flex min-w-0 items-center gap-1.5">
              <span className="inline-flex min-w-0 items-center gap-1 truncate rounded-full bg-white/10 px-2 py-0.5 ring-1 ring-white/15 ring-inset">
                <AudioLines className="size-3 shrink-0" />
                <bdi className="truncate">{t("home.mock.voice")}</bdi>
              </span>
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 ring-1 ring-white/15 ring-inset max-sm:hidden">{t("home.mock.language")}</span>
            </span>
          </div>
          <Waveform live bars={56} seed={3} className="relative mt-2.5 h-10" barClass="bg-gradient-to-t from-fuchsia-500 to-pink-300" />
        </div>

        {/* Transcript */}
        <ol className="space-y-2 px-4 pt-3.5 pb-3">
          <Turn who="agent" label={agentLabel} at={duration(0, locale)}>
            {t("home.mock.turn1", { business: EXAMPLE_BUSINESS.name })}
          </Turn>
          <Turn who="caller" label={callerLabel} at={duration(6, locale)}>
            {t("home.mock.turn2")}
          </Turn>
          <ToolEvent name="check_availability" detail={t("home.mock.toolDetail", { ms: num(182, locale) })} />
          <Turn who="agent" label={agentLabel} at={duration(11, locale)} className="max-sm:hidden">
            {t("home.mock.turn3", { slot1: thursday, slot2: friday })}
          </Turn>
          <Turn who="caller" label={callerLabel} at={duration(17, locale)}>
            {t("home.mock.turn4", { slot: thursday })}
          </Turn>
          <Turn who="agent" label={agentLabel}>
            {t("home.mock.turn5", { slot: thursday })}
            <TypingDots className="ms-1.5 text-muted" />
          </Turn>
        </ol>

        {/* Compliance facts of the call */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-paper/60 px-4 py-2.5 lg:justify-end">
          <Pill tone="good">
            <ShieldCheck className="size-3" />
            {t("home.mock.disclosure")}
          </Pill>
          <Pill tone="info">
            <Mic className="size-3" />
            {t("home.mock.recording")}
          </Pill>
          <Pill className="max-[420px]:hidden">
            <User className="size-3" />
            {t("home.mock.transfer")}
          </Pill>
        </div>
      </div>

      {/* "Appointment booked" notification. Anchored by its bottom edge: a wrapped translation grows upwards. */}
      <div
        aria-hidden
        className={cn(
          "absolute -end-4 bottom-[calc(100%+0.75rem)] z-10 hidden w-[310px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_1.2s_both] items-start gap-3 rounded-xl border border-line bg-surface/95 p-3 backdrop-blur motion-reduce:animate-none lg:flex xl:-end-10",
          FLOAT_SHADOW,
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500 text-white">
          <CalendarCheck className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-start text-[13px] leading-snug font-semibold">{t("home.mock.toastTitle", { when: shortSlot })}</span>
            <span className="shrink-0 pt-0.5 text-[10px] text-muted">{t("home.mock.now")}</span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">{t("home.mock.toastText")}</span>
        </span>
      </div>

      {/* Post-call summary: beside the call on wide screens, under it on small ones. */}
      <div
        aria-hidden
        className={cn(
          "relative z-10 mx-auto mt-5 w-full max-w-[380px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.9s_both] rounded-2xl border border-line bg-surface/95 p-3.5 backdrop-blur motion-reduce:animate-none lg:absolute lg:-start-14 lg:-bottom-36 lg:mt-0 lg:w-[270px] xl:-start-20",
          FLOAT_SHADOW,
        )}
      >
        <span className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-text">
            <FileText className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{t("home.mock.summaryTitle")}</span>
          <Pill tone="good">{t("home.mock.positive")}</Pill>
        </span>
        <span dir="auto" className="mt-2 block text-[11.5px] leading-snug text-muted">
          {t("home.mock.summaryText", { slot: thursday })}
        </span>
        <dl className="mt-2.5 divide-y divide-line rounded-lg bg-paper ring-1 ring-line ring-inset">
          {(
            [
              [t("home.mock.fieldBooked"), t("home.mock.yes")],
              [t("home.mock.fieldService"), t("home.mock.service")],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px]">
              <dt className="min-w-0 truncate text-muted">{label}</dt>
              <dd className="flex shrink-0 items-center gap-1 font-semibold">
                <CircleCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Call credits of the workspace. */}
      <div
        aria-hidden
        className={cn(
          "absolute -end-6 -bottom-[6.75rem] z-10 hidden w-[230px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_1.5s_both] rounded-2xl border border-line bg-surface/95 p-3.5 backdrop-blur motion-reduce:animate-none lg:block xl:-end-12",
          FLOAT_SHADOW,
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
            <Wallet className="size-3.5" />
            {t("home.mock.credits")}
          </span>
          <span className="text-[10px] text-muted">{t("home.mock.perMin", { price: usd(0.15, locale) })}</span>
        </span>
        <bdi className="mt-1 block font-display text-2xl font-bold tracking-tight">{usd(48.2, locale)}</bdi>
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-line/70">
          <span className="block h-full w-[62%] origin-left animate-[dz-fill_1.4s_ease-out_1.6s_both] rounded-full bg-gradient-to-r from-primary to-violet-500 motion-reduce:animate-none rtl:origin-right rtl:bg-gradient-to-l" />
        </span>
        <span className="mt-1.5 block text-[10.5px] text-muted">{t("home.mock.included", { n: num(312, locale), total: num(500, locale) })}</span>
      </div>
    </div>
  );
}
