import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { CancelRenewalForm, PasswordForm, ProfileForm } from "@/components/site/account-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { interpolateParts } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatDateTime, formatNumber } from "@/lib/dash-format";
import { getEntitlements } from "@/lib/plans";
import { getUsage } from "@/lib/usage";
import { stripeSubscriptionStatus } from "@/lib/payments/stripe";
import { formatMoney } from "@/lib/utils";
import { formatLimit } from "@/voice/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("account.title"), robots: { index: false } };
}

const STATUS_TONE = { paid: "success", pending: "warning", rejected: "danger", refunded: "neutral" } as const;

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ payment?: string; password?: string }> }) {
  const [user, query, t, locale] = await Promise.all([requireUser("/account"), searchParams, getT(), getLocale()]);
  const lc = locale.code;
  const [entitlements, usage] = await Promise.all([getEntitlements(user), getUsage(user.id)]);
  const formatDate = (iso: string | null | undefined) => formatDateTime(iso, lc, false);
  // Administrators (no plan) and plans assigned without an end date never expire.
  const noExpiry = entitlements.isPremium && !entitlements.expiresAt;
  const db = await getDb();
  const payments = await db
    .selectFrom("payments")
    .leftJoin("plans", "plans.id", "payments.plan_id")
    .select([
      "payments.id",
      "payments.amount",
      "payments.currency",
      "payments.billing_cycle",
      "payments.provider",
      "payments.status",
      "payments.created_at",
      "payments.purpose",
      "plans.name as plan_name",
    ])
    .where("payments.user_id", "=", user.id)
    .orderBy("payments.id", "desc")
    .limit(20)
    .execute();
  const renewal = user.stripe_subscription_id ? await stripeSubscriptionStatus(user.stripe_subscription_id) : null;
  const autoRenews = Boolean(renewal && renewal.status === "active" && !renewal.cancelAtPeriodEnd);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold">{t("account.title")}</h1>
      <p className="mt-1 text-muted">{t("account.signedInAs", { email: user.email })}</p>

      <div className="mt-6 space-y-3">
        {query.payment === "submitted" ? (
          <Alert tone="success" title={t("account.transferSubmittedTitle")}>
            {t("account.transferSubmittedText")}
          </Alert>
        ) : null}
        {query.password === "reset" ? <Alert tone="success">{t("account.passwordReset")}</Alert> : null}
      </div>

      <div className="mt-8 space-y-6">
        <Section title={t("account.plan")}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xl font-bold">
                {entitlements.plan?.name ?? (entitlements.isPremium ? t("account.adminPlan") : t("account.free"))}
                {entitlements.isPremium ? <Badge tone="success">{t("account.active")}</Badge> : null}
              </p>
              <p className="mt-1 text-sm text-muted">
                {noExpiry
                  ? entitlements.plan
                    ? t("account.noExpiry")
                    : t("account.adminText")
                  : entitlements.isPremium
                  ? autoRenews
                    ? t("account.renews", { date: formatDate(entitlements.expiresAt) })
                    : t("account.activeUntil", { date: formatDate(entitlements.expiresAt) })
                  : t("account.freeText")}
              </p>
              <p className="mt-3 text-sm">
                {interpolateParts(t("account.limits"), {
                  agents: <strong>{formatLimit(entitlements.maxAgents, t, lc)}</strong>,
                  numbers: <strong>{formatLimit(entitlements.maxNumbers, t, lc)}</strong>,
                  minutes: <strong>{formatLimit(entitlements.includedMinutesMonthly, t, lc)}</strong>,
                  concurrent: <strong>{formatLimit(entitlements.maxConcurrentCalls, t, lc)}</strong>,
                  members: <strong>{formatLimit(entitlements.maxMembers, t, lc)}</strong>,
                }).map((part, i) => (
                  <Fragment key={i}>{part}</Fragment>
                ))}
                .
              </p>
              <p className="mt-1 text-sm text-muted">
                {entitlements.includedMinutesMonthly >= 0
                  ? t("account.usageMinutes", { used: formatNumber(Math.floor(usage.secondsUsed / 60), lc), limit: formatNumber(entitlements.includedMinutesMonthly, lc) })
                  : t("account.usageMinutesUnlimited", { used: formatNumber(Math.floor(usage.secondsUsed / 60), lc) })}
              </p>
            </div>
            {!entitlements.isPremium || (!autoRenews && !noExpiry) ? (
              <ButtonLink href="/pricing">{entitlements.isPremium ? t("account.extend") : t("account.upgrade")}</ButtonLink>
            ) : null}
          </div>
          {autoRenews ? (
            <div className="mt-5 border-t border-line pt-5">
              <CancelRenewalForm />
            </div>
          ) : null}
        </Section>

        <Section title={t("account.profile")}>
          <ProfileForm name={user.name} email={user.email} />
        </Section>

        <Section title={t("account.passwordSection")}>
          <PasswordForm />
        </Section>

        <Section title={t("account.history")}>
          {payments.length ? (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-start text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">{t("account.date")}</th>
                    <th className="px-2 py-2 font-medium">{t("account.plan")}</th>
                    <th className="px-2 py-2 font-medium">{t("account.method")}</th>
                    <th className="px-2 py-2 font-medium">{t("account.amount")}</th>
                    <th className="px-2 py-2 font-medium">{t("account.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-2 py-2.5">{formatDate(p.created_at)}</td>
                      <td className="px-2 py-2.5">
                        {p.purpose === "credits" ? (
                          t("account.creditPack")
                        ) : (
                          <>
                            {p.plan_name ?? "—"} <span className="text-muted">({t(`checkout.cycle.${p.billing_cycle}`)})</span>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2.5">{t(`checkout.gateway.${p.provider}`)}</td>
                      <td className="px-2 py-2.5 tabular-nums">{formatMoney(p.amount, p.currency)}</td>
                      <td className="px-2 py-2.5">
                        <Badge tone={STATUS_TONE[p.status]} className="capitalize">
                          {t(`account.status.${p.status}`)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">{t("account.noPayments")}</p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="mb-4 font-sans text-base font-semibold tracking-normal">{title}</h2>
      {children}
    </section>
  );
}
