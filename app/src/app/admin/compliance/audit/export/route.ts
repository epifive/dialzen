import { requireAdmin } from "@/lib/auth/session";
import { auditActorNames, auditCsvRows, auditFilterFrom, auditScopeOf, searchAudit } from "@/lib/audit-view";
import { csvResponse } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** CSV export of the admin audit search (same filters), up to 10,000 entries. */
export async function GET(request: Request) {
  await requireAdmin();
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const scope = auditScopeOf(q.workspace);
  const filter = auditFilterFrom(q, "UTC", 1000);
  const records = [];
  let before = filter.beforeId;
  while (records.length < 10_000) {
    const page = await searchAudit(scope, { ...filter, beforeId: before, limit: 1000 });
    records.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].id;
  }
  const names = await auditActorNames(records);
  return csvResponse(`audit-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, auditCsvRows(records.slice(0, 10_000), names));
}
