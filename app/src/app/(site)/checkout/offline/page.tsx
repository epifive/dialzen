import type { Metadata } from "next";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { OfflinePaymentForm } from "@/components/site/checkout-forms";
import { requireUser } from "@/lib/auth/session";
import { interpolateParts } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { planPrice } from "@/lib/payments";
import { getPlan } from "@/lib/plans";
import { getSiteContext } from "@/lib/site";
import { formatMoney } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("checkout.offlineTitle"), robots: { index: false } };
}

export default async function OfflineCheckoutPage({ searchParams }: { searchParams: Promise<{ plan?: string; cycle?: string }> }) {
  const { plan: planParam, cycle: cycleParam } = await searchParams;
  const cycle = cycleParam === "yearly" ? "yearly" : "monthly";
  await requireUser(`/checkout/offline?plan=${encodeURIComponent(planParam ?? "")}&cycle=${cycle}`);
  const [{ settings }, t] = await Promise.all([getSiteContext(), getT()]);
  const plan = await getPlan(Number(planParam));
  if (!settings.offline_enabled || !plan || !plan.is_active || plan.is_free) notFound();

  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-bold">{t("checkout.offlineTitle")}</h1>
      <p className="mt-2 text-muted">
        {interpolateParts(t("checkout.offlineText"), {
          amount: <strong className="text-ink">{formatMoney(planPrice(plan, cycle), settings.currency)}</strong>,
          plan: plan.name,
          cycle: t(`checkout.cycle.${cycle}`),
        }).map((part, i) => (
          <Fragment key={i}>{part}</Fragment>
        ))}
      </p>
      <div className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-sans text-sm font-semibold tracking-normal">{t("checkout.instructions")}</h2>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted">{settings.offline_instructions}</p>
      </div>
      <div className="mt-6">
        <OfflinePaymentForm planId={plan.id} cycle={cycle} />
      </div>
    </div>
  );
}
