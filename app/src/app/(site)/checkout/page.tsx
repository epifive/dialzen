import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { GatewayForm } from "@/components/site/checkout-forms";
import { Alert } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth/session";
import { getT } from "@/lib/i18n/server";
import { enabledGateways, planPrice } from "@/lib/payments";
import { getPlan } from "@/lib/plans";
import { getSiteContext } from "@/lib/site";
import { formatMoney } from "@/lib/utils";
import { formatLimit } from "@/voice/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("checkout.title"), robots: { index: false } };
}

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ plan?: string; cycle?: string }> }) {
  const { plan: planParam, cycle: cycleParam } = await searchParams;
  const cycle = cycleParam === "yearly" ? "yearly" : "monthly";
  await requireUser(`/checkout?plan=${encodeURIComponent(planParam ?? "")}&cycle=${cycle}`);
  const plan = await getPlan(Number(planParam));
  if (!plan || !plan.is_active || plan.is_free) notFound();

  const [{ settings, entitlements, locale }, t] = await Promise.all([getSiteContext(), getT()]);
  const price = planPrice(plan, cycle);
  const total = formatMoney(price, settings.currency);
  const gateways = enabledGateways(settings).map((id) => ({ id, label: t(`checkout.gateway.${id}`) }));

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_380px]">
      <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{t("checkout.title")}</h1>
        {entitlements.isPremium && entitlements.plan?.id === plan.id ? (
          <Alert tone="info" className="mt-4">
            {t("checkout.alreadyHave", { plan: plan.name, period: cycle === "yearly" ? t("checkout.year") : t("checkout.month") })}
          </Alert>
        ) : null}
        <div className="mt-6">
          {price <= 0 ? (
            <Alert tone="error">{t("checkout.periodUnavailable", { plan: plan.name })}</Alert>
          ) : gateways.length ? (
            <GatewayForm planId={plan.id} cycle={cycle} gateways={gateways} total={total} />
          ) : (
            <Alert tone="warning" title={t("checkout.noGatewaysTitle")}>
              {t("checkout.noGatewaysText", { email: settings.site_email })}
            </Alert>
          )}
        </div>
        <p className="mt-6 flex items-center gap-2 text-xs text-muted">
          <Lock className="size-3.5" aria-hidden />
          {t("checkout.secure")}
        </p>
      </section>

      <aside className="h-fit rounded-2xl border border-line bg-paper p-6">
        <h2 className="font-sans text-sm font-semibold tracking-normal text-muted">{t("checkout.summary")}</h2>
        <p className="mt-3 text-lg font-bold">{plan.name}</p>
        <p className="text-sm text-muted">{t("checkout.billed", { cycle: t(`checkout.cycle.${cycle}`) })}</p>
        <dl className="mt-5 space-y-2 border-t border-line pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">{t("pricing.agents")}</dt>
            <dd>{formatLimit(plan.max_agents, t, locale.code)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("pricing.numbers")}</dt>
            <dd>{formatLimit(plan.max_numbers, t, locale.code)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("pricing.minutes")}</dt>
            <dd>{formatLimit(plan.included_minutes_monthly, t, locale.code)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("pricing.concurrentLabel")}</dt>
            <dd>{formatLimit(plan.max_concurrent_calls, t, locale.code)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">{t("pricing.members")}</dt>
            <dd>{formatLimit(plan.max_members, t, locale.code)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
            <dt>{t("checkout.total")}</dt>
            <dd>{total}</dd>
          </div>
        </dl>
        <Link
          href={`/checkout?plan=${plan.id}&cycle=${cycle === "yearly" ? "monthly" : "yearly"}`}
          className="mt-5 inline-block text-sm font-medium text-primary hover:underline"
        >
          {t("checkout.switchTo", { cycle: cycle === "yearly" ? t("checkout.cycle.monthly") : t("checkout.cycle.yearly") })}
        </Link>
      </aside>
    </div>
  );
}
