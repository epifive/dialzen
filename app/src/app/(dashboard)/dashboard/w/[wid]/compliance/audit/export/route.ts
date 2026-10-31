import { auditActorNames, auditCsvRows, auditFilterFrom, auditForExport } from "@/lib/audit-view";
import { getCurrentUser } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv";
import { workspaceIdOf } from "@/lib/dashboard";
import { getMembership } from "@/lib/workspaces";
import { roleAtLeast } from "@/voice/normalize";

export const dynamic = "force-dynamic";

/** CSV export of the workspace's audit log (admins), with the viewer's filters, up to 10,000 entries. */
export async function GET(request: Request, { params }: { params: Promise<{ wid: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Sign in first.", { status: 401 });
  const membership = await getMembership(workspaceIdOf((await params).wid), user.id);
  if (!membership || !roleAtLeast(membership.role, "admin")) return new Response("Not found.", { status: 404 });
  const url = new URL(request.url);
  const q = Object.fromEntries(url.searchParams);
  const filter = auditFilterFrom(q, membership.workspace.timezone, 1000);
  const records = await auditForExport(membership.workspace.id, filter);
  const names = await auditActorNames(records);
  return csvResponse(`audit-log-${membership.workspace.id}-${new Date().toISOString().slice(0, 10)}.csv`, auditCsvRows(records, names));
}
