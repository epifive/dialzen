import Link from "next/link";
import { Card, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { getSettings } from "@/lib/settings";
import { getTenantPnl } from "@/lib/voice/reconcile";
import { formatMicros } from "@/voice/format";

export const metadata = { title: "Tenant P&L" };

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

export default async function TenantPnlPage({ searchParams }: { searchParams: Promise<{ month?: string; scope?: string }> }) {
  const q = await searchParams;
  const current = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(q.month ?? "") ? q.month! : current;
  // Default: customers only. Internal (admin-owned) workspaces are cost without revenue.
  const all = q.scope === "all";
  const [pnl, settings] = await Promise.all([getTenantPnl(month), getSettings()]);
  const money = (v: number) => formatMicros(v, settings.currency, "en-US", true);
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const t = all ? pnl.totals : pnl.customerTotals;
  const other = all ? pnl.customerTotals : pnl.totals;
  const rows = all ? pnl.rows : pnl.rows.filter((r) => !r.internal);
  const href = (m: string, scope: boolean) => `/admin/voice/pnl?month=${m}${scope ? "&scope=all" : ""}`;
  const marginText = (v: { marginMicros: number; marginPct: number | null }) => `${money(v.marginMicros)}${v.marginPct === null ? "" : ` (${v.marginPct}%)`}`;
  return (
    <>
      <PageHeader
        title="Tenant P&L"
        description="What each workspace paid for calls and numbers against what the voice providers charged you, per calendar month (UTC). Plan minutes are paid by the subscription and show as included time. Internal workspaces (owned by an administrator) only cost money, so they are left out unless you show all workspaces."
        actions={
          <>
            <Link href={href(shift(month, -1), all)} className={buttonClass("outline", "sm")}>
              ← Previous
            </Link>
            {month < current ? (
              <Link href={href(shift(month, 1), all)} className={buttonClass("outline", "sm")}>
                Next →
              </Link>
            ) : null}
            <Link href="/admin/voice" className={buttonClass("ghost", "sm")}>
              Voice providers
            </Link>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{label}</h2>
        <nav aria-label="Workspaces in the totals" className="inline-flex rounded-lg border border-line p-0.5 text-sm">
          <Link href={href(month, false)} aria-current={all ? undefined : "page"} className={`rounded-md px-3 py-1 font-medium ${all ? "text-muted hover:text-ink" : "bg-primary text-white"}`}>
            Customers only
          </Link>
          <Link href={href(month, true)} aria-current={all ? "page" : undefined} className={`rounded-md px-3 py-1 font-medium ${all ? "bg-primary text-white" : "text-muted hover:text-ink"}`}>
            All workspaces
          </Link>
        </nav>
      </div>
      {pnl.internalWorkspaces ? (
        <p className="mb-4 text-sm text-muted">
          {all
            ? `Includes ${pnl.internalWorkspaces} internal workspace${pnl.internalWorkspaces === 1 ? "" : "s"} (owned by an administrator, no revenue). Customers only: margin ${marginText(other)}.`
            : `${pnl.internalWorkspaces} internal workspace${pnl.internalWorkspaces === 1 ? " is" : "s are"} left out (owned by an administrator, no revenue). All workspaces: margin ${marginText(other)}, provider cost ${money(other.providerCostMicros)}.`}
        </p>
      ) : null}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Revenue" value={money(t.revenueMicros)} hint={`Calls ${money(t.callRevenueMicros)} · numbers ${money(t.rentalRevenueMicros)}`} />
        <StatCard label="Provider cost" value={money(t.providerCostMicros)} hint={t.unknownCostCalls ? `${t.unknownCostCalls.toLocaleString("en-US")} calls without a reported cost` : "All costs reported"} />
        <StatCard label="Margin" value={money(t.marginMicros)} hint={t.marginPct === null ? "No revenue yet" : `${t.marginPct}% of revenue`} />
        <StatCard label="Calls / minutes" value={`${t.calls.toLocaleString("en-US")} / ${Math.round(t.billedSec / 60).toLocaleString("en-US")}`} hint={`${Math.round(t.includedSec / 60).toLocaleString("en-US")} included plan minutes · ${t.byoCalls.toLocaleString("en-US")} calls on own keys`} />
      </div>
      <Card padded={false}>
        {rows.length ? (
          <Table minWidth={900} dense>
            <thead>
              <tr>
                <Th>Workspace</Th>
                <Th className="text-end">Calls</Th>
                <Th className="text-end">Billed min</Th>
                <Th className="text-end">Included min</Th>
                <Th className="text-end">Call revenue</Th>
                <Th className="text-end">Numbers</Th>
                <Th className="text-end">Provider cost</Th>
                <Th className="text-end">Margin</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.workspaceId}>
                  <Td>
                    <span className="font-medium" dir="auto">
                      {r.workspaceName}
                    </span>
                    {r.internal ? (
                      <Badge tone="neutral" className="ms-2" title="Owned by an administrator: calls use plan minutes and bring no revenue">
                        Internal
                      </Badge>
                    ) : null}
                    <span className="block text-xs text-muted">{r.ownerEmail}</span>
                  </Td>
                  <Td className="text-end tabular-nums">{r.calls.toLocaleString("en-US")}</Td>
                  <Td className="text-end tabular-nums">{(r.billedSec / 60).toFixed(1)}</Td>
                  <Td className="text-end tabular-nums">{(r.includedSec / 60).toFixed(1)}</Td>
                  <Td className="text-end tabular-nums">{money(r.callRevenueMicros)}</Td>
                  <Td className="text-end tabular-nums">{money(r.rentalRevenueMicros)}</Td>
                  <Td className="text-end tabular-nums">
                    {money(r.providerCostMicros)}
                    {r.unknownCostCalls ? <span className="block text-xs text-muted">{r.unknownCostCalls} unknown</span> : null}
                  </Td>
                  <Td className={`text-end tabular-nums ${r.marginMicros < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                    {money(r.marginMicros)}
                    {r.marginPct !== null ? <span className="block text-xs text-muted">{r.marginPct}%</span> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={pnl.rows.length ? "No customer calls or rentals this month" : "No calls or rentals this month"}>
            {pnl.rows.length ? "Only internal workspaces had calls. Show all workspaces to see them." : "Revenue and provider costs appear here as calls finish."}
          </EmptyState>
        )}
      </Card>
    </>
  );
}
