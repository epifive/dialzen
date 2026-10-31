import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { PricingPlans, type PricingPlan } from "@/components/site/pricing-plans";
import { Alert } from "@/components/ui/alert";
import { getT } from "@/lib/i18n/server";
import { getActivePlans, planCardLimits, planFeatures } from "@/lib/plans";
import { getSiteContext } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("pricing.metaTitle"),
    description: t("pricing.metaDescription"),
    alternates: { canonical: "/pricing" },
  };
}

const BILLING_FAQ = [
  { q: "pricing.faq1q", a: "pricing.faq1a" },
  { q: "pricing.faq2q", a: "pricing.faq2a" },
  { q: "pricing.faq5q", a: "pricing.faq5a" },
  { q: "pricing.faq4q", a: "pricing.faq4a" },
] as const;

export default async function PricingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const [{ settings, user, entitlements, locale }, { checkout }, t] = await Promise.all([getSiteContext(), searchParams, getT()]);
  const plans = await getActivePlans();
  const data: PricingPlan[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceMonthly: p.price_monthly,
    priceYearly: p.price_yearly,
    features: planFeatures(p),
    ...planCardLimits(p),
    isFree: p.is_free === 1,
    isFeatured: p.is_featured === 1,
  }));

  return (
    <div className="mx-auto max-w-7xl px-4 pt-14 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tall-script:leading-[1.35] sm:text-5xl">{t("pricing.title")}</h1>
        <p className="mt-4 text-lg text-muted">{t("pricing.subtitle")}</p>
      </div>

      {checkout === "cancelled" ? (
        <Alert tone="info" className="mx-auto mt-8 max-w-2xl">
          {t("pricing.cancelled")}
        </Alert>
      ) : checkout === "failed" ? (
        <Alert tone="error" className="mx-auto mt-8 max-w-2xl" title={t("pricing.failedTitle")}>
          {t("pricing.failedText")}
        </Alert>
      ) : null}

      <div className="mt-10">
        <PricingPlans
          plans={data}
          currency={settings.currency}
          currentPlanId={entitlements.isPremium ? (entitlements.plan?.id ?? null) : user ? (data.find((p) => p.isFree)?.id ?? null) : null}
          signedIn={Boolean(user)}
          locale={locale.code}
        />
      </div>

      <section aria-labelledby="billing-faq" className="mx-auto mt-20 max-w-3xl">
        <h2 id="billing-faq" className="text-2xl font-bold">
          {t("pricing.faqTitle")}
        </h2>
        <div className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface">
          {BILLING_FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {t(f.q)}
                <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90" aria-hidden />
              </summary>
              <p className="mt-3 leading-relaxed text-muted">{t(f.a)}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
