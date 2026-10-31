import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { HeroMockup } from "./hero-mockup";

export function Hero({ t, title, subtitle, signedIn, locale }: { t: Translator; title: string; subtitle: string; signedIn: boolean; locale: string }) {
  const trust = [t("home.trustVoices"), t("home.trustConsent"), t("home.trustVercel")];
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden border-b border-line">
      <div aria-hidden className="mat-grid mat-grid-fade absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-64 mx-auto h-[560px] max-w-5xl rounded-full bg-primary/20 blur-[120px] dark:bg-primary/30" />
      <div aria-hidden className="pointer-events-none absolute -end-40 top-72 size-[420px] rounded-full bg-violet-300/30 blur-[120px] dark:bg-violet-500/10" />
      <div aria-hidden className="pointer-events-none absolute -start-40 bottom-0 size-[360px] rounded-full bg-rose-200/40 blur-[120px] dark:bg-rose-500/5" />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-4 pt-14 pb-16 sm:gap-20 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12 lg:pt-28 lg:pb-48">
        <div className="text-center lg:text-start">
          <Link
            href="#use-cases"
            className="group inline-flex max-w-full animate-tz-rise items-center gap-2 rounded-full border border-primary-line bg-surface/80 py-1 ps-1.5 pe-3 text-sm font-medium shadow-sm backdrop-blur transition-colors hover:border-primary motion-reduce:animate-none"
          >
            <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">{t("home.eyebrowBadge")}</span>
            <span className="truncate">{t("home.eyebrow")}</span>
            <ArrowRight
              className="size-3.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary-text rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
              aria-hidden
            />
          </Link>

          <h1
            id="hero-title"
            className="mx-auto mt-7 max-w-[17ch] animate-tz-rise bg-gradient-to-b from-ink from-45% to-ink/70 bg-clip-text text-[2.55rem] leading-[1.04] font-bold tracking-[-0.035em] text-balance text-transparent [animation-delay:80ms] tall-script:leading-[1.32] tall-script:tracking-normal motion-reduce:animate-none sm:text-6xl lg:mx-0 lg:text-[3.5rem] xl:text-[4rem]"
          >
            {title}
          </h1>
          <p className="mx-auto mt-6 max-w-[56ch] animate-tz-rise text-lg leading-relaxed text-muted [animation-delay:160ms] motion-reduce:animate-none lg:mx-0">{subtitle}</p>

          <div className="mt-9 flex animate-tz-rise flex-wrap justify-center gap-3 [animation-delay:240ms] motion-reduce:animate-none lg:justify-start">
            <Link href={signedIn ? "/dashboard" : "/register"} className={buttonClass("primary", "lg", "group shadow-lg shadow-primary/30")}>
              {signedIn ? t("nav.dashboard") : t("home.ctaStart")}
              <ArrowRight aria-hidden className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </Link>
            <Link href="/pricing" className={buttonClass("outline", "lg")}>
              {t("home.ctaPricing")}
            </Link>
          </div>

          <ul className="mt-7 flex animate-tz-rise flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted [animation-delay:320ms] motion-reduce:animate-none lg:justify-start">
            {trust.map((text) => (
              <li key={text} className="flex items-center gap-1.5">
                <span className="grid size-4 place-items-center rounded-full bg-emerald-500/15">
                  <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden strokeWidth={3} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:ps-4">
          <HeroMockup t={t} locale={locale} />
        </div>
      </div>
    </section>
  );
}

/** The benefits strip under the hero (Admin → Settings → Appearance → "Show the stats strip"). */
export function ProofStrip({ t }: { t: Translator }) {
  const stats: Array<[string, string]> = [
    [t("home.stat1Value"), t("home.stat1Label")],
    [t("home.stat2Value"), t("home.stat2Label")],
    [t("home.stat3Value"), t("home.stat3Label")],
    [t("home.stat4Value"), t("home.stat4Label")],
  ];
  return (
    <section aria-label={t("home.statsLabel")} className="border-b border-line bg-surface">
      <dl className="mx-auto grid max-w-7xl grid-cols-2 px-4 sm:px-6 md:grid-cols-4">
        {stats.map(([value, label], i) => (
          <div
            key={label}
            className={cn(
              "flex flex-col-reverse justify-end gap-1 px-2 py-7 text-center sm:py-9",
              i % 2 === 1 && "border-s border-line",
              i >= 2 && "border-t border-line md:border-t-0",
              i === 2 && "md:border-s",
            )}
          >
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
