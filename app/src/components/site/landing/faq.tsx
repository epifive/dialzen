import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { JsonLd } from "@/components/site/json-ld";
import type { Translator } from "@/lib/i18n/messages";
import { SectionHeading } from "./section-heading";

const QUESTIONS = [
  ["home.faq1q", "home.faq1a"],
  ["home.faq2q", "home.faq2a"],
  ["home.faq3q", "home.faq3a"],
  ["home.faq4q", "home.faq4a"],
  ["home.faq5q", "home.faq5a"],
  ["home.faq6q", "home.faq6a"],
  ["home.faq7q", "home.faq7a"],
  ["home.faq8q", "home.faq8a"],
] as const;

/** FAQ with native <details> (no JavaScript) and FAQPage structured data. */
export function Faq({ t, site, contact }: { t: Translator; site: string; contact: boolean }) {
  const items = QUESTIONS.map(([q, a]) => ({ q: t(q, { site }), a: t(a, { site }) }));
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 py-24 sm:py-28">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
        }}
      />
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading id="faq-title" eyebrow={t("home.faqEyebrow")} title={t("home.faqTitle")} text={t("home.faqText")} />
          {contact ? (
            <Link href="/contact" className="group mt-6 inline-flex items-center gap-1.5 font-semibold text-primary-text hover:underline">
              {t("home.faqContact")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className="divide-y divide-line border-y border-line">
          {items.map((item, i) => (
            <details key={item.q} className="group" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-start text-[17px] font-semibold transition-colors hover:text-primary-text [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-muted transition-all group-open:rotate-45 group-open:border-primary-line group-open:bg-primary-soft group-open:text-primary-text motion-reduce:transition-none">
                  <Plus className="size-4" aria-hidden />
                </span>
              </summary>
              <p className="-mt-1 max-w-[65ch] pe-12 pb-6 leading-relaxed text-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
