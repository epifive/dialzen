import Link from "next/link";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { AUDIT_CATEGORIES, auditActorNames, auditDetails, auditFilterFrom, auditScopeOf, searchAudit } from "@/lib/audit-view";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Audit search" };

const PER_PAGE = 50;

/** Search the audit trail of the whole platform (one workspace, platform-level entries or everything). */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ workspace?: string; category?: string; from?: string; to?: string; entity?: string; before?: string }> }) {
  const q = await searchParams;
  const scope = auditScopeOf(q.workspace);
  const filter = auditFilterFrom({ ...q, before: Number(q.before) || undefined }, "UTC", PER_PAGE);
  const entries = await searchAudit(scope, filter);
  const names = await auditActorNames(entries);
  const qs = new URLSearchParams(Object.entries({ workspace: q.workspace ?? "", category: q.category ?? "", from: q.from ?? "", to: q.to ?? "", entity: q.entity ?? "" }).filter(([, v]) => v));
  const older = entries.length === PER_PAGE ? `/admin/compliance/audit?${new URLSearchParams([...qs, ["before", String(entries[entries.length - 1].id)]])}` : null;
  const input = "mt-1 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm";
  return (
    <>
      <PageHeader
        title="Audit search"
        description="Consent records, do-not-call changes, dial decisions, opt-outs, approvals, kill switches and wallet adjustments, across all workspaces. Entries can't be changed or deleted. Dates are UTC."
        actions={
          <>
            <a href={`/admin/compliance/audit/export?${qs}`} className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line">
              Export CSV
            </a>
            <Link href="/admin/compliance" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line">
              Back to compliance
            </Link>
          </>
        }
      />
      <Card padded={false}>
        <form method="get" className="grid gap-2 border-b border-line p-3 sm:grid-cols-6 sm:items-end">
          <label className="text-xs text-muted">
            Workspace ID
            <input name="workspace" defaultValue={q.workspace ?? ""} placeholder="all / platform / 12" className={input} />
          </label>
          <label className="text-xs text-muted">
            Category
            <select name="category" defaultValue={q.category ?? ""} className={input}>
              <option value="">Everything</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.slice(0, -1)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            From
            <input name="from" type="date" defaultValue={q.from ?? ""} className={input} />
          </label>
          <label className="text-xs text-muted">
            To
            <input name="to" type="date" defaultValue={q.to ?? ""} className={input} />
          </label>
          <label className="text-xs text-muted">
            Number or ID
            <input name="entity" defaultValue={q.entity ?? ""} className={input} dir="ltr" />
          </label>
          <button type="submit" className="h-9 rounded-lg border border-line px-3 text-sm font-medium">
            Search
          </button>
        </form>
        {entries.length ? (
          <Table minWidth={900} dense>
            <thead>
              <tr>
                <Th>Time (UTC)</Th>
                <Th>Workspace</Th>
                <Th>Action</Th>
                <Th>By</Th>
                <Th>About</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDate(e.createdAt, true)}</Td>
                  <Td className="text-muted">{e.workspaceId ?? "platform"}</Td>
                  <Td>
                    <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px]">{e.action}</code>
                  </Td>
                  <Td className="whitespace-nowrap">{e.actorId ? (names.get(e.actorId) ?? `${e.actorType} #${e.actorId}`) : e.actorType}</Td>
                  <Td className="whitespace-nowrap">
                    <span className="text-muted">{e.entityType}</span> <span className="font-mono text-[12px]">{e.entityId}</span>
                  </Td>
                  <Td className="max-w-96 truncate text-xs text-muted">
                    <span title={JSON.stringify(e.data)}>{auditDetails(e.data)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No entries match" />
        )}
        <div className="flex justify-between px-4 py-3 text-sm">
          {q.before ? (
            <Link href={`/admin/compliance/audit?${qs}`} className="text-primary hover:underline">
              Newest entries
            </Link>
          ) : (
            <span />
          )}
          {older ? (
            <Link href={older} className="text-primary hover:underline">
              Older entries
            </Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}
