import Link from "next/link";
import { ArrowRight, PhoneCall } from "lucide-react";
import type { Translator } from "@/lib/i18n/messages";
import { waveform } from "./format";

/** A faint voice waveform behind the call to action: the product's visual signature. */
const BARS = waveform(72, 9);

export function FinalCta({ t, signedIn }: { t: Translator; signedIn: boolean }) {
  return (
    <section aria-labelledby="cta-title" className="px-4 pt-4 sm:px-6">
      <div className="relative mx-auto max-w-[calc(80rem-3rem)] overflow-hidden rounded-[2rem] bg-primary px-6 pt-16 pb-24 text-center text-white shadow-[0_40px_80px_-40px_var(--primary)] sm:px-12 sm:pt-20 sm:pb-28">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        />
        <div aria-hidden className="absolute inset-x-0 -top-40 mx-auto h-72 max-w-2xl rounded-full bg-white/25 blur-[100px]" />
        <div aria-hidden className="absolute -end-16 -bottom-24 size-72 rounded-full bg-violet-400/45 blur-[100px]" />
        <div aria-hidden className="absolute -start-20 -bottom-28 size-72 rounded-full bg-rose-300/30 blur-[100px]" />

        {/* Voice waveform along the bottom edge. */}
        <div aria-hidden className="absolute inset-x-0 bottom-0 flex h-24 items-end gap-[3px] px-6 opacity-50 [mask-image:linear-gradient(to_top,black,transparent)] sm:px-10">
          {BARS.map((h, i) => (
            <span
              key={i}
              className="block flex-1 origin-bottom animate-[dz-wave_1.6s_ease-in-out_infinite] rounded-t-full bg-white/40 motion-reduce:animate-none max-sm:[&:nth-child(2n)]:hidden"
              style={{ height: `${Math.round(h * 100)}%`, animationDelay: `${-((i * 173) % 1600)}ms` }}
            />
          ))}
        </div>

        <div className="relative">
          <span aria-hidden className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1.5 text-sm font-semibold ring-1 ring-white/25 ring-inset">
            <PhoneCall className="size-4" />
            {t("home.ctaBadge")}
          </span>
          <h2 id="cta-title" className="mx-auto mt-7 max-w-[22ch] text-3xl leading-[1.08] font-bold tracking-tight tall-script:leading-[1.35] tall-script:tracking-normal sm:text-5xl">
            {t("home.ctaTitle")}
          </h2>
          <p className="mx-auto mt-5 max-w-[52ch] text-lg text-white/85">{t("home.ctaText")}</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/register"}
              className="group inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 font-semibold text-primary shadow-lg shadow-black/10 transition-colors hover:bg-white/90"
            >
              {signedIn ? t("nav.dashboard") : t("home.ctaStart")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
            <Link href="/pricing" className="inline-flex h-12 items-center rounded-lg px-6 font-semibold text-white ring-1 ring-white/50 transition-colors ring-inset hover:bg-white/10">
              {t("home.ctaPricing")}
            </Link>
          </div>
          {!signedIn ? <p className="mt-5 text-sm text-white/80">{t("home.noCard")}</p> : null}
        </div>
      </div>
    </section>
  );
}
