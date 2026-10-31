import Link from "next/link";
import { Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { listDnc } from "@/lib/contacts";
import { formatDate } from "@/lib/utils";
import { GlobalDncUploadForm, RemoveGlobalDncForm } from "../forms";

export const metadata = { title: "Global do-not-call list" };

const PER_PAGE = 50;

/** The operator's do-not-call list: checked for every workspace before every outbound call. */
export default async function GlobalDncPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const { entries, total } = await listDnc("global", 0, { q: params.q, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <>
      <PageHeader
        title="Global do-not-call list"
        description="Numbers no workspace may call (complaints, known litigators, regulator requests). Checked before every outbound call on the platform."
        actions={
          <Link href="/admin/compliance" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line">
            Back to compliance
          </Link>
        }
      />
      <Card title="Add numbers" className="mb-6">
        <GlobalDncUploadForm />
      </Card>
      <Card title={`Numbers (${total.toLocaleString()})`} padded={false}>
        <form method="get" className="flex gap-2 border-b border-line p-3">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Search a number" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm" dir="ltr" />
          <button type="submit" className="h-9 rounded-lg border border-line px-3 text-sm font-medium">
            Search
          </button>
        </form>
        {entries.length ? (
          <Table minWidth={640} dense>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Reference</Th>
                <Th>Note</Th>
                <Th>Added</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="font-mono text-[13px]">{e.phone_e164}</Td>
                  <Td className="text-muted">{e.list_ref || "—"}</Td>
                  <Td className="max-w-60 truncate text-muted">{e.note || "—"}</Td>
                  <Td className="text-muted">{formatDate(e.created_at)}</Td>
                  <Td>
                    <div className="flex justify-end">
                      <RemoveGlobalDncForm phone={e.phone_e164} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title={params.q ? "No number matches" : "The global list is empty"} />
        )}
        <Pagination page={page} pages={pages} href={(p) => `/admin/compliance/dnc?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), page: String(p) })}`} />
      </Card>
    </>
  );
}
