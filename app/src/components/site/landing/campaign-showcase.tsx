import { Ban, CircleCheck, Clock3, Hourglass, Pause, PhoneCall, ShieldCheck, Square } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { clock, num, pct } from "./format";
import { FLOAT_SHADOW, LiveDot, MockLabel, Pill, TONE, WindowFrame } from "./mock-kit";
import { Showcase } from "./showcase";

/** A running reminder campaign (dashboard → Campaigns → a campaign) and the checks made before every call. */
function CampaignMockup({ t, locale }: { t: Translator; locale: string }) {
  const total = 248;
  const parts: Array<[number, string, string]> = [
    [131, "bg-emerald-500", t("home.camp.reached")],
    [22, "bg-amber-400", t("home.camp.notReached")],
    [14, "bg-slate-400 dark:bg-slate-500", t("home.camp.skipped")],
    [5, "bg-primary", t("home.camp.live")],
  ];
  const kpis: Array<[string, number]> = [
    [t("home.camp.contacts"), total],
    [t("home.camp.reached"), 131],
    [t("home.camp.queued"), 76],
    [t("home.camp.skipped"), 14],
  ];
  const rows: Array<{ name: string; state: string; tone: keyof typeof TONE; detail: string }> = [
    { name: "Daniel Okafor", state: t("home.camp.rowInCall"), tone: "info", detail: t("home.camp.attempt", { n: num(1, locale) }) },
    { name: "Priya Raman", state: t("home.camp.rowReached"), tone: "good", detail: t("home.camp.confirmed") },
    { name: "Lucas Moreau", state: t("home.camp.rowRetry"), tone: "warn", detail: t("home.camp.nextTry", { time: clock(16, 30, locale) }) },
    { name: "Hannah Weiss", state: t("home.camp.rowSkipped"), tone: "neutral", detail: t("home.camp.onDnc") },
  ];
  return (
    <div role="img" aria-label={t("home.camp.mockLabel")} className="relative mx-auto w-full max-w-[620px] select-none">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-emerald-300/20 via-primary/20 to-transparent blur-3xl" />
      <WindowFrame
        title={<span dir="auto">{t("home.camp.name")}</span>}
        extra={
          <>
            <Pill tone="info">
              <LiveDot className="bg-primary" />
              {t("home.camp.running")}
            </Pill>
            <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] font-semibold max-[420px]:hidden">
              <Pause className="size-3" />
              {t("home.camp.pause")}
            </span>
          </>
        }
      >
        <div className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <Pill>{t("home.camp.purpose")}</Pill>
            <span className="inline-flex items-center gap-1 text-muted">
              <Clock3 className="size-3.5" />
              {t("home.camp.window", { start: clock(9, 0, locale), end: clock(19, 0, locale) })}
            </span>
            <span className="text-muted max-sm:hidden">· {t("home.camp.retries", { n: num(3, locale) })}</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {kpis.map(([label, value]) => (
              <span key={label} className="min-w-0 rounded-lg bg-paper px-2 py-1.5 ring-1 ring-line ring-inset">
                <MockLabel className="truncate">{label}</MockLabel>
                <bdi className="block font-display text-base font-bold tabular-nums sm:text-lg">{num(value, locale)}</bdi>
              </span>
            ))}
          </div>

          <div>
            <span className="flex items-center justify-between text-[10.5px] text-muted">
              <span>{t("home.camp.progress")}</span>
              <bdi>{t("home.camp.done", { done: num(167, locale), total: num(total, locale) })}</bdi>
            </span>
            <span className="mt-1 flex h-2 overflow-hidden rounded-full bg-line/70">
              {parts.map(([n, color]) => (
                <span key={color} className={cn("h-full origin-left animate-[dz-fill_1.2s_ease-out_0.3s_both] motion-reduce:animate-none rtl:origin-right", color)} style={{ width: `${(n / total) * 100}%` }} />
              ))}
            </span>
            <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted">
              {parts.map(([, color, label]) => (
                <span key={label} className="inline-flex items-center gap-1">
                  <span className={cn("size-1.5 rounded-full", color)} />
                  {label}
                </span>
              ))}
            </span>
          </div>

          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => (
              <li key={r.name} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-paper text-[10px] font-bold ring-1 ring-line ring-inset">{r.name[0]}</span>
                <bdi className="min-w-0 flex-1 truncate font-medium">{r.name}</bdi>
                <span className="truncate text-muted max-[420px]:hidden">{r.detail}</span>
                <Pill tone={r.tone}>{r.state}</Pill>
              </li>
            ))}
          </ul>

          <p className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {t("home.camp.abandon", { pct: pct(0.8, locale), max: pct(3, locale, 0) })}
          </p>
        </div>
      </WindowFrame>

      {/* Checks before the next call */}
      <div
        aria-hidden
        className={cn(
          "relative z-10 mx-auto mt-5 w-full max-w-[330px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.6s_both] rounded-2xl border border-line bg-surface/95 p-3.5 backdrop-blur motion-reduce:animate-none lg:absolute lg:-end-8 lg:-bottom-28 lg:mt-0 lg:w-[290px] xl:-end-16",
          FLOAT_SHADOW,
        )}
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <PhoneCall className="size-4 text-primary-text" />
          {t("home.camp.checksTitle")}
        </span>
        <span className="mt-2 block space-y-1.5 text-[11px]">
          {[t("home.camp.checkConsent"), t("home.camp.checkDnc"), t("home.camp.checkHours"), t("home.camp.checkCaps")].map((label) => (
            <span key={label} className="flex items-start gap-1.5">
              <CircleCheck className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="min-w-0">{label}</span>
            </span>
          ))}
          <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
            <Hourglass className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0">{t("home.camp.checkWait", { time: clock(9, 0, locale) })}</span>
          </span>
        </span>
      </div>

      {/* Kill switch */}
      <div
        aria-hidden
        className={cn(
          "absolute -start-6 -top-8 z-10 hidden animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.9s_both] items-center gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 text-[11px] font-semibold backdrop-blur motion-reduce:animate-none md:flex xl:-start-12",
          FLOAT_SHADOW,
        )}
      >
        <span className="grid size-6 place-items-center rounded-md bg-red-500/12 text-red-600 dark:text-red-400">
          <Square className="size-3 fill-current" />
        </span>
        {t("home.camp.killSwitch")}
        <Ban className="size-3.5 text-muted" />
      </div>
    </div>
  );
}

export function CampaignShowcase({ t, locale }: { t: Translator; locale: string }) {
  return (
    <Showcase
      id="campaigns"
      eyebrow={t("home.camp.eyebrow")}
      title={t("home.camp.title")}
      text={t("home.camp.text")}
      points={[t("home.camp.point1"), t("home.camp.point2"), t("home.camp.point3"), t("home.camp.point4")]}
      visual={<CampaignMockup t={t} locale={locale} />}
    />
  );
}
