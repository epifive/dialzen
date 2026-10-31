import Link from "next/link";
import { Card, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/admin/ui";
import { creditPacks, priceList, revenueByMonth } from "@/lib/billing";
import { getTenantPnl } from "@/lib/voice/reconcile";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDate, formatMoney } from "@/lib/utils";
import { formatMicros, providerName } from "@/voice/format";
import { WalletAdjustForm } from "./forms";

export const metadata = { title: "Billing" };

function monthOptions(n: number): string[] {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

/** Tenant P&L (minutes sold vs provider cost), revenue by month, wallet adjustments and credit packs. */
export default async function AdminBillingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const q = await searchParams;
  const months = monthOptions(12);
  const month = months.includes(q.month ?? "") ? q.month! : months[0];
  const settings = await getSettings();
  const currency = settings.currency || "USD";
  const db = await getDb();
  const [pnl, revenue, workspaces, adjustments, balances] = await Promise.all([
    getTenantPnl(month),
    revenueByMonth(12, currency),
    db.selectFrom("workspaces as w").leftJoin("users as u", "u.id", "w.owner_id").select(["w.id", "w.name", "u.email"]).orderBy("w.name").limit(500).execute(),
    db
      .selectFrom("credit_transactions as t")
      .leftJoin("workspaces as w", "w.id", "t.workspace_id")
      .leftJoin("users as u", "u.id", "t.created_by")
      .select(["t.id", "t.workspace_id", "w.name", "t.amount_micros", "t.balance_after", "t.note", "t.created_at", "u.email"])
      .where("t.kind", "=", "adjustment")
      .where("t.note", "not like", "Number rental%")
      .orderBy("t.id", "desc")
      .limit(15)
      .execute(),
    db.selectFrom("wallets").select([(eb) => eb.fn.sum<number>("balance_micros").as("balance"), (eb) => eb.fn.sum<number>("reserved_micros").as("reserved")]).executeTakeFirst(),
  ]);
  const money = (m: number) => formatMicros(m, currency, "en-US");
  // Customers only: internal (admin-owned) workspaces are cost without revenue (see the full P&L for all).
  const tot = pnl.customerTotals;
  const all = pnl.totals;
  const top = pnl.rows.filter((r) => !r.internal).sort((a, b) => b.revenueMicros - a.revenueMicros).slice(0, 10);
  const maxRev = Math.max(1, ...revenue.map((r) => r.plansCents * 10_000 + r.creditsCents * 10_000), ...revenue.map((r) => r.costMicros));

  return (
    <>
      <PageHeader title="Billing" description="What workspaces paid for call minutes against what the voice providers charged you, and the call-credit wallets." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Revenue, ${month}`} value={money(tot.revenueMicros)} hint={`${Math.round(tot.billedSec / 60).toLocaleString()} billed min, ${Math.round(tot.includedSec / 60).toLocaleString()} included, ${money(tot.rentalRevenueMicros)} rentals`} />
        <StatCard label={`Provider cost, ${month}`} value={money(tot.providerCostMicros)} hint={`Customers only · ${tot.unknownCostCalls ? `${tot.unknownCostCalls} calls without a reported cost` : "all calls reported a cost"}`} />
        <StatCard
          label="Margin, customers"
          value={money(tot.marginMicros)}
          hint={pnl.internalWorkspaces ? `${pct(tot.marginMicros, tot.revenueMicros)} of revenue · all workspaces incl. ${pnl.internalWorkspaces} internal: ${money(all.marginMicros)}` : `${pct(tot.marginMicros, tot.revenueMicros)} of revenue`}
        />
        <StatCard label="Credits held by workspaces" value={money(Number(balances?.balance ?? 0))} hint={`${money(Number(balances?.reserved ?? 0))} reserved for live calls`} />
      </div>

      <Card
        title="Top customers by revenue"
        padded={false}
        className="mb-6"
        actions={
          <form method="get" className="flex items-center gap-2">
            <select name="month" defaultValue={month} aria-label="Month" className="h-8 rounded-lg border border-line bg-surface px-2 text-sm">
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button type="submit" className="h-8 rounded-lg border border-line px-3 text-sm font-medium">
              Show
            </button>
          </form>
        }
      >
        {top.length ? (
          <Table minWidth={760} dense>
            <thead>
              <tr>
                <Th>Workspace</Th>
                <Th className="text-right">Calls</Th>
                <Th className="text-right">Billed min</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Provider cost</Th>
                <Th className="text-right">Margin</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.workspaceId}>
                  <Td>
                    <span className="font-medium">{r.workspaceName}</span>
                    <span className="block text-xs text-muted">
                      #{r.workspaceId} · {r.ownerEmail}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">{r.calls.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{Math.round(r.billedSec / 60).toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{money(r.revenueMicros)}</Td>
                  <Td className="text-right tabular-nums">{money(r.providerCostMicros)}</Td>
                  <Td className={`text-right tabular-nums ${r.marginMicros < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {money(r.marginMicros)}
                    <span className="block text-xs text-muted">{r.marginPct === null ? "–" : `${Math.round(r.marginPct)}%`}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={`No calls in ${month}`} />
        )}
        <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted">
          <span>Customers only (internal, admin-owned workspaces are left out). Included minutes are paid by the plan subscription, so their revenue shows under plan payments below.</span>
          <Link href={`/admin/voice/pnl?month=${month}`} className="font-medium text-primary hover:underline">
            Full tenant P&amp;L →
          </Link>
        </p>
      </Card>

      <Card title="Revenue by month" padded={false} className="mb-6">
        <Table minWidth={760} dense>
          <thead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right">Plans</Th>
              <Th className="text-right">Credit packs</Th>
              <Th className="text-right">Minutes charged</Th>
              <Th className="text-right">Provider cost</Th>
              <Th className="w-[30%]">Cash in vs provider cost</Th>
            </tr>
          </thead>
          <tbody>
            {[...revenue].reverse().map((r) => {
              const cash = (r.plansCents + r.creditsCents) * 10_000;
              return (
                <tr key={r.month}>
                  <Td className="font-medium">{r.month}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.plansCents, currency)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(r.creditsCents, currency)}</Td>
                  <Td className="text-right tabular-nums">{money(r.usageMicros)}</Td>
                  <Td className="text-right tabular-nums">{money(r.costMicros)}</Td>
                  <Td>
                    <div className="space-y-1" aria-hidden>
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${(cash / maxRev) * 100}%`, minWidth: cash ? 2 : 0 }} />
                      <div className="h-2 rounded-full bg-amber-400" style={{ width: `${(r.costMicros / maxRev) * 100}%`, minWidth: r.costMicros ? 2 : 0 }} />
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="flex flex-wrap gap-4 border-t border-line px-4 py-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary" /> Plans + credit packs paid
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber-400" /> Provider cost
          </span>
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card title="Adjust a wallet">
            <WalletAdjustForm workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, email: w.email ?? "" }))} currency={currency} />
          </Card>
          <Card title="Recent adjustments" padded={false}>
            {adjustments.length ? (
              <Table minWidth={640} dense>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Workspace</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Reason</Th>
                    <Th>By</Th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((a) => (
                    <tr key={a.id}>
                      <Td className="text-muted">{formatDate(a.created_at, true)}</Td>
                      <Td>
                        {a.name ?? "—"} <span className="text-xs text-muted">#{a.workspace_id}</span>
                      </Td>
                      <Td className={`text-right tabular-nums ${Number(a.amount_micros) < 0 ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}>{money(Number(a.amount_micros))}</Td>
                      <Td className="max-w-60 truncate text-muted">{a.note}</Td>
                      <Td className="text-muted">{a.email ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No adjustments yet" />
            )}
          </Card>
        </div>
        <Card title="Prices and credit packs">
          <dl className="space-y-2 text-sm">
            {priceList(settings).map((p) => (
              <div key={p.provider} className="flex justify-between gap-3">
                <dt className="text-muted">{p.provider === "byo" ? "Own keys (platform fee)" : providerName(p.provider)}</dt>
                <dd className="tabular-nums">{formatMicros(p.micros, currency, "en-US", true)} / min</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line pt-2">
              <dt className="text-muted">Credit packs</dt>
              <dd className="text-right">{creditPacks(settings).map((a) => formatMoney(Math.round(a * 100), currency)).join(", ") || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Rounding</dt>
              <dd>{settings.billing_rounding.replace("_", " ")}</dd>
            </div>
          </dl>
          <Link href="/admin/settings/voice" className="mt-4 inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line">
            Edit prices and packs
          </Link>
        </Card>
      </div>
    </>
  );
}
