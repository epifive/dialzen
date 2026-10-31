import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { RefreshOnce } from "@/components/dashboard/actions";
import { BuyCreditsForm, WalletOptionsForm } from "@/components/dashboard/billing-forms";
import { Kpi, KpiGrid } from "@/components/dashboard/kit";
import { DashHeader, DTable, DTd, DTh, Empty, LinkTabs, Meter, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { creditPacks, listCreditPayments, pendingOfflineCreditPayment, priceList, pricePerMinuteMicros } from "@/lib/billing";
import { formatDateTime, formatNumber, formatTime } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { enabledGateways } from "@/lib/payments";
import { confirmCreditSession } from "@/lib/payments/credits";
import { getSettings } from "@/lib/settings";
import { getUsage } from "@/lib/usage";
import { getWallet, listTransactions } from "@/lib/wallet";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { formatCurrency, formatMicros, providerName } from "@/voice/format";
import { roleCan } from "@/voice/normalize";
import { CREDIT_KINDS, type CreditKind } from "@/voice/types";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.billing") };
}

const PER_PAGE = 30;

/** Call credits: balance, included minutes, credit packs, automatic recharge, alerts and the ledger. */
export default async function BillingPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ paid?: string; session_id?: string; checkout?: string; kind?: string; before?: string }> }) {
  const { user, workspace, role } = await requireWorkspace((await params).wid);
  const query = await searchParams;
  let justPaid = false;
  if (query.paid === "stripe" && typeof query.session_id === "string" && query.session_id.startsWith("cs_")) {
    // Don't wait for the webhook: confirm the session so the credits show at once.
    justPaid = await confirmCreditSession(query.session_id, user.id).catch(() => false);
  } else if (query.paid) justPaid = true;
  const kind = (CREDIT_KINDS as readonly string[]).includes(query.kind ?? "") ? (query.kind as CreditKind) : undefined;
  const before = Number(query.before) || undefined;
  const [t, locale, settings, wallet, entitlements, usage, ledger, payments, pending] = await Promise.all([
    getT(),
    getLocale(),
    getSettings(),
    getWallet(workspace.id),
    getWorkspaceEntitlements(workspace),
    getUsage(workspace.ownerId),
    listTransactions(workspace.id, { kind, beforeId: before, limit: PER_PAGE, hideZeroSettles: true }),
    listCreditPayments(workspace.id, 10),
    pendingOfflineCreditPayment(workspace.id),
  ]);
  const lc = locale.code;
  const currency = settings.currency || "USD";
  const money = (m: number, precise = false) => formatMicros(m, currency, lc, precise);
  const base = `/dashboard/w/${workspace.id}/billing`;
  const canManage = roleCan(role, "billing.manage");
  const packs = creditPacks(settings).map((amount) => ({ amount, label: formatCurrency(amount, currency, lc, { maximumFractionDigits: 2 }) }));
  const gateways = enabledGateways(settings);
  const includedLimit = entitlements.includedMinutesMonthly;
  const usedMin = Math.floor(usage.secondsUsed / 60);
  const leftMin = includedLimit < 0 ? Infinity : Math.max(0, includedLimit - usedMin);
  const db = await getDb();
  const cardSaved = Boolean(
    await db
      .selectFrom("payments")
      .innerJoin("users", "users.id", "payments.user_id")
      .select("payments.id")
      .where("payments.workspace_id", "=", workspace.id)
      .where("payments.purpose", "=", "credits")
      .where("payments.provider", "=", "stripe")
      .where("payments.status", "=", "paid")
      .where("users.stripe_customer_id", "is not", null)
      .executeTakeFirst(),
  );
  let symbol = currency;
  try {
    symbol = new Intl.NumberFormat(lc, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  } catch {
    // Unknown currency code: show the code.
  }
  const kindLabel = (k: CreditKind, note: string): string => (k === "adjustment" && note.startsWith("Number rental") ? t("dash.billing.kind.rental") : t(`dash.billing.kind.${k}` as MessageKey));
  const older = ledger.length === PER_PAGE ? `${base}?${new URLSearchParams({ ...(kind ? { kind } : {}), before: String(ledger[ledger.length - 1].id) })}` : null;

  return (
    <>
      {justPaid ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {t("dash.billing.paid")}
          </Alert>
        </>
      ) : query.checkout === "cancelled" || query.checkout === "failed" ? (
        <Alert tone="warning" className="mb-6">
          {t(query.checkout === "failed" ? "dash.billing.failed" : "dash.billing.cancelled")}
        </Alert>
      ) : null}
      <DashHeader title={t("dash.nav.billing")} description={t("dash.billing.subtitle")} />

      <KpiGrid className="mb-6 grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("dash.billing.balance")} value={<bdi className={wallet.balanceMicros < 0 ? "text-red-600 dark:text-red-400" : undefined}>{money(wallet.balanceMicros)}</bdi>} hint={wallet.lowBalanceMicros > 0 && wallet.balanceMicros < wallet.lowBalanceMicros ? t("dash.billing.belowAlert") : undefined} />
        <Kpi label={t("dash.billing.reserved")} value={<bdi>{money(wallet.reservedMicros)}</bdi>} hint={t("dash.billing.reservedHint")} />
        <Kpi label={t("dash.billing.includedLeft")} value={includedLimit < 0 ? t("pricing.unlimited") : formatNumber(leftMin, lc)} hint={includedLimit < 0 ? undefined : t("dash.billing.includedOf", { n: formatNumber(includedLimit, lc) })} />
        <Kpi label={t("dash.billing.price")} value={<bdi>{money(pricePerMinuteMicros(settings, settings.voice_default_provider), true)}</bdi>} hint={t("dash.billing.perMinute")} />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-6">
          <Panel title={t("dash.billing.buyTitle")} description={t("dash.billing.buyText")}>
            {pending ? (
              <Alert tone="info" className="mb-4">
                {t("dash.billing.pendingTransfer", { amount: formatCurrency(pending.amount / 100, pending.currency, lc), date: formatDateTime(pending.created_at, lc) })}
              </Alert>
            ) : null}
            {!canManage ? (
              <Alert tone="info">{t("dash.billing.adminsOnly")}</Alert>
            ) : gateways.length && packs.length ? (
              <BuyCreditsForm workspaceId={workspace.id} packs={packs} gateways={gateways} offlineInstructions={settings.offline_instructions} />
            ) : (
              <Alert tone="warning">{t("dash.billing.noGateways")}</Alert>
            )}
          </Panel>

          <Panel title={t("dash.billing.ledger")} padded={false}>
            <div className="overflow-x-auto border-b border-line px-3 py-2">
              <LinkTabs
                label={t("dash.billing.ledger")}
                items={[{ href: base, label: t("dash.billing.all"), active: !kind }, ...(["purchase", "settle", "reserve", "release", "adjustment", "included"] as const).map((k) => ({ href: `${base}?kind=${k}`, label: t(`dash.billing.kind.${k}`), active: kind === k }))]}
              />
            </div>
            {ledger.length ? (
              <DTable minWidth={480} label={t("dash.billing.ledger")} dense>
                <thead>
                  <tr>
                    <DTh>{t("dash.billing.date")}</DTh>
                    <DTh>{t("dash.billing.type")}</DTh>
                    <DTh className="text-end">{t("dash.billing.amount")}</DTh>
                    <DTh className="text-end">{t("dash.billing.balanceAfter")}</DTh>
                    <DTh>{t("dash.billing.note")}</DTh>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((x) => (
                    <tr key={x.id}>
                      <DTd className="whitespace-nowrap text-muted">
                        <time dateTime={x.createdAt} title={formatDateTime(x.createdAt, lc)}>
                          {formatTime(x.createdAt, lc, true)}
                        </time>
                      </DTd>
                      <DTd className="whitespace-nowrap">
                        <Badge tone={x.kind === "purchase" ? "success" : x.kind === "settle" ? "neutral" : x.kind === "adjustment" ? "warning" : "primary"}>{kindLabel(x.kind, x.note)}</Badge>
                      </DTd>
                      <DTd className={cn("text-end whitespace-nowrap tabular-nums", x.amountMicros > 0 ? "text-emerald-700 dark:text-emerald-400" : x.amountMicros < 0 ? "text-ink" : "text-muted")}>
                        <bdi>
                          {x.kind === "included" ? t("dash.billing.minutesN", { n: (x.seconds / 60).toFixed(1) }) : `${x.amountMicros > 0 ? "+" : ""}${money(x.amountMicros, Math.abs(x.amountMicros) % 10_000 !== 0)}`}
                        </bdi>
                      </DTd>
                      <DTd className="text-end whitespace-nowrap text-muted tabular-nums">
                        <bdi>{money(x.balanceAfter)}</bdi>
                      </DTd>
                      {/* The note takes the space left and is cut off with "…" so the table fits next to the sidebar. */}
                      <DTd className="w-full max-w-0 text-muted">
                        <div className="truncate" title={x.note && !x.callId ? x.note : undefined}>
                          {x.callId ? (
                            <Link href={`/dashboard/w/${workspace.id}/calls/${x.callId}`} className="hover:text-primary">
                              {t("dash.billing.callN", { id: x.callId })}
                            </Link>
                          ) : null}
                          {x.seconds && x.kind === "settle" ? <span className="ms-1">· {t("dash.billing.secondsN", { n: x.seconds })}</span> : null}
                          {x.note && !x.callId ? <span dir="auto">{x.note}</span> : null}
                        </div>
                      </DTd>
                    </tr>
                  ))}
                </tbody>
              </DTable>
            ) : (
              <Empty icon={<ReceiptText />} title={t("dash.billing.ledgerEmpty")} />
            )}
            <div className="flex justify-between px-5 py-3 text-sm">
              {before ? (
                <Link href={kind ? `${base}?kind=${kind}` : base} className="text-primary hover:underline">
                  {t("dash.audit.newest")}
                </Link>
              ) : (
                <span />
              )}
              {older ? (
                <Link href={older} className="text-primary hover:underline">
                  {t("dash.audit.older")}
                </Link>
              ) : null}
            </div>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("dash.billing.included")} description={t("dash.billing.includedText")}>
            {includedLimit === 0 ? (
              <p className="text-sm text-muted">{t("dash.billing.noIncluded")}</p>
            ) : (
              <Meter label={t("dash.home.meterMinutes")} used={usedMin} limit={includedLimit} usedText={formatNumber(usedMin, lc)} limitText={includedLimit < 0 ? t("pricing.unlimited") : formatNumber(includedLimit, lc)} />
            )}
          </Panel>
          <Panel title={t("dash.billing.optionsTitle")}>
            {canManage ? (
              <WalletOptionsForm
                workspaceId={workspace.id}
                packs={packs}
                values={{ enabled: wallet.autoRecharge.enabled, threshold: wallet.autoRecharge.thresholdMicros / 1_000_000, amount: wallet.autoRecharge.amountMicros / 1_000_000, lowBalance: wallet.lowBalanceMicros / 1_000_000 }}
                cardSaved={cardSaved}
                stripe={gateways.includes("stripe")}
                currencySymbol={symbol}
              />
            ) : (
              <p className="text-sm text-muted">{t("dash.billing.adminsOnly")}</p>
            )}
          </Panel>
          <Panel title={t("dash.billing.pricesTitle")}>
            <dl className="space-y-2 text-sm">
              {priceList(settings).map((p) => (
                <div key={p.provider} className="flex justify-between gap-3">
                  <dt className="text-muted">{p.provider === "byo" ? t("dash.billing.byo") : providerName(p.provider, t)}</dt>
                  <dd className="tabular-nums">
                    <bdi>{money(p.micros, true)}</bdi>
                    <span className="text-muted"> / {t("dash.billing.min")}</span>
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-line pt-2">
                <dt className="text-muted">{t("dash.billing.rounding")}</dt>
                <dd>{t(`dash.billing.rounding.${settings.billing_rounding}` as MessageKey)}</dd>
              </div>
              {Number(settings.number_monthly_price) > 0 ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">{t("dash.billing.rental")}</dt>
                  <dd className="tabular-nums">
                    <bdi>{formatCurrency(Number(settings.number_monthly_price), currency, lc)}</bdi>
                    <span className="text-muted"> / {t("dash.billing.month")}</span>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-xs text-muted">{t("dash.billing.howBilled")}</p>
          </Panel>
          {payments.length ? (
            <Panel title={t("dash.billing.purchases")} padded={false}>
              <ul className="divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <bdi className="font-medium tabular-nums">{formatCurrency(p.amount / 100, p.currency, lc)}</bdi>
                      <span className="block text-xs text-muted">
                        {t(`dash.billing.gateway.${p.provider}` as MessageKey)} · {formatDateTime(p.created_at, lc, false)}
                      </span>
                    </span>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "danger"}>{t(`dash.billing.payment.${p.status}` as MessageKey)}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
