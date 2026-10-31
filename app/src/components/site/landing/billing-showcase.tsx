import { ArrowUpRight, CreditCard, Receipt, Wallet } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { exampleSeries, monthLabel, num, pct, usd } from "./format";
import { FLOAT_SHADOW, MockLabel, Sparkline, WindowFrame } from "./mock-kit";
import { Showcase } from "./showcase";

/** Example tenants of the P&L (fictional businesses): billed minutes, revenue and provider cost in dollars. */
const TENANTS: Array<{ name: string; initial: string; tone: string; minutes: number; revenue: number; cost: number }> = [
  { name: "Brightline Dental", initial: "B", tone: "from-fuchsia-400 to-violet-600", minutes: 6120, revenue: 918.0, cost: 532.4 },
  { name: "Harbor Auto Care", initial: "H", tone: "from-sky-400 to-indigo-600", minutes: 4870, revenue: 730.5, cost: 418.8 },
  { name: "Northside Realty", initial: "N", tone: "from-emerald-400 to-teal-600", minutes: 3940, revenue: 571.3, cost: 331.0 },
  { name: "Pine & Pour Café", initial: "P", tone: "from-amber-400 to-orange-600", minutes: 1210, revenue: 175.45, cost: 104.1 },
];

/** The operator's view (Admin → Voice → Tenant P&L) and the per-minute price settings. */
function BillingMockup({ t, locale }: { t: Translator; locale: string }) {
  const revenue = 3_962.4;
  const cost = 2_284.7;
  const margin = revenue - cost;
  const stats: Array<[string, string, string]> = [
    [t("home.bill.revenue"), usd(revenue, locale), t("home.bill.revenueHint")],
    [t("home.bill.cost"), usd(cost, locale), t("home.bill.costHint")],
    [t("home.bill.margin"), usd(margin, locale), t("home.bill.marginHint", { pct: pct((margin / revenue) * 100, locale) })],
  ];
  return (
    <div role="img" aria-label={t("home.bill.mockLabel")} className="relative mx-auto w-full max-w-[620px] select-none">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-amber-200/25 via-primary/20 to-transparent blur-3xl" />
      <WindowFrame
        title={t("home.bill.title")}
        extra={<span className="rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] font-semibold text-muted">{monthLabel(locale)}</span>}
      >
        <div className="space-y-3 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-3">
            {stats.map(([label, value, hint], i) => (
              <span key={label} className={cn("min-w-0 rounded-xl px-2.5 py-2 ring-1 ring-inset", i === 2 ? "bg-primary-soft ring-primary-line" : "bg-paper ring-line")}>
                <MockLabel className="truncate">{label}</MockLabel>
                <bdi className={cn("block font-display text-lg font-bold tracking-tight tabular-nums", i === 2 && "text-primary-text")}>{value}</bdi>
                <span className="block truncate text-[10px] text-muted">{hint}</span>
              </span>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-line">
            <div className="grid grid-cols-[minmax(0,1fr)_4.2rem_4.6rem_4.6rem] gap-2 bg-paper/70 px-2.5 py-1.5 text-[10px] font-semibold text-muted max-sm:grid-cols-[minmax(0,1fr)_4.6rem_4.6rem]">
              <span>{t("home.bill.workspace")}</span>
              <span className="text-end max-sm:hidden">{t("home.bill.minutes")}</span>
              <span className="text-end">{t("home.bill.paid")}</span>
              <span className="text-end">{t("home.bill.marginCol")}</span>
            </div>
            <ul className="divide-y divide-line">
              {TENANTS.map((w) => (
                <li key={w.name} className="grid grid-cols-[minmax(0,1fr)_4.2rem_4.6rem_4.6rem] items-center gap-2 px-2.5 py-1.5 text-[11px] max-sm:grid-cols-[minmax(0,1fr)_4.6rem_4.6rem]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-md bg-gradient-to-br text-[9px] font-bold text-white", w.tone)}>{w.initial}</span>
                    <bdi className="truncate font-medium">{w.name}</bdi>
                  </span>
                  <bdi className="text-end text-muted tabular-nums max-sm:hidden">{num(w.minutes, locale)}</bdi>
                  <bdi className="text-end tabular-nums">{usd(w.revenue, locale)}</bdi>
                  <bdi className="text-end font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">{usd(w.revenue - w.cost, locale)}</bdi>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-2.5">
              <MockLabel>{t("home.bill.prices")}</MockLabel>
              <span className="mt-1 block space-y-0.5 text-[11px]">
                {(
                  [
                    ["ElevenLabs", usd(0.15, locale)],
                    ["Retell AI", usd(0.14, locale)],
                    [t("home.bill.ownKeys"), usd(0.02, locale)],
                  ] as const
                ).map(([label, price]) => (
                  <span key={label} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-muted">{label}</span>
                    <bdi className="shrink-0 font-semibold tabular-nums">{t("home.bill.perMin", { price })}</bdi>
                  </span>
                ))}
              </span>
            </div>
            <div className="rounded-xl border border-line p-2.5 max-sm:hidden">
              <MockLabel>{t("home.bill.packs")}</MockLabel>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {[10, 25, 50, 100].map((v, i) => (
                  <span key={v} className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset", i === 1 ? "bg-primary text-white ring-primary" : "bg-paper ring-line")}>
                    <bdi>{usd(v, locale, 0)}</bdi>
                  </span>
                ))}
              </span>
              <span className="mt-1.5 block text-[10px] text-muted">{t("home.bill.rounding")}</span>
            </div>
          </div>
        </div>
      </WindowFrame>

      {/* A customer's wallet */}
      <div
        aria-hidden
        className={cn(
          "absolute -start-6 -bottom-32 z-10 hidden w-[240px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.6s_both] rounded-2xl border border-line bg-surface/95 p-3.5 backdrop-blur motion-reduce:animate-none sm:block xl:-start-14",
          FLOAT_SHADOW,
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
            <Wallet className="size-3.5" />
            {t("home.mock.credits")}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <ArrowUpRight className="size-3 rtl:-scale-x-100" />
            <bdi>{usd(25, locale, 0)}</bdi>
          </span>
        </span>
        <bdi className="mt-1 block font-display text-2xl font-bold tracking-tight">{usd(73.2, locale)}</bdi>
        <Sparkline id="dz-wallet-spark" values={exampleSeries(20, 60, 3)} width={200} height={36} className="mt-1.5 h-9 w-full" />
        <span className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted">
          <CreditCard className="size-3" />
          {t("home.bill.topUp")}
        </span>
      </div>

      {/* Payment received */}
      <div
        aria-hidden
        className={cn(
          "absolute -end-4 -top-9 z-10 hidden animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.9s_both] items-center gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 text-[11px] backdrop-blur motion-reduce:animate-none md:flex xl:-end-10",
          FLOAT_SHADOW,
        )}
      >
        <span className="grid size-6 place-items-center rounded-md bg-emerald-500 text-white">
          <Receipt className="size-3.5" />
        </span>
        <span className="font-semibold">{t("home.bill.paidToast", { amount: usd(99, locale, 0) })}</span>
      </div>
    </div>
  );
}

export function BillingShowcase({ t, locale }: { t: Translator; locale: string }) {
  return (
    <Showcase
      id="billing"
      reverse
      eyebrow={t("home.bill.eyebrow")}
      title={t("home.bill.titleSection")}
      text={t("home.bill.text")}
      points={[t("home.bill.point1"), t("home.bill.point2"), t("home.bill.point3"), t("home.bill.point4")]}
      visual={<BillingMockup t={t} locale={locale} />}
    />
  );
}
