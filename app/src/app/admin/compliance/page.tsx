import Link from "next/link";
import { Card, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { listKycRequests } from "@/lib/compliance";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { GlobalKillForm, KycReviewForm, OutboundStateForm, WorkspaceKillForm } from "./forms";

export const metadata = { title: "Compliance" };

/** ISO time 24 hours ago (outside the component: render must stay pure). */
function dayAgoIso(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

const STATE_TONE = { not_requested: "neutral", pending: "warning", approved: "success", rejected: "danger", suspended: "danger" } as const;

/** Outbound access review queue, kill switches and the outbound state of every workspace. */
export default async function AdminCompliancePage() {
  const [settings, pending, reviewed] = await Promise.all([getSettings(), listKycRequests({ status: "pending", limit: 50 }), listKycRequests({ limit: 30 })]);
  const db = await getDb();
  const workspaces = await db
    .selectFrom("compliance_settings as c")
    .innerJoin("workspaces as w", "w.id", "c.workspace_id")
    .leftJoin("users as u", "u.id", "w.owner_id")
    .select(["w.id", "w.name", "u.email", "c.outbound_state", "c.kill_switch", "c.kill_reason", "c.outbound_paused", "c.aup_accepted_at", "c.updated_at"])
    .orderBy("c.updated_at", "desc")
    .limit(200)
    .execute();
  const wsNames = new Map((await db.selectFrom("workspaces as w").leftJoin("users as u", "u.id", "w.owner_id").select(["w.id", "w.name", "u.email"]).where("w.id", "in", [0, ...pending.map((p) => p.workspace_id)]).execute()).map((w) => [w.id, w]));
  const [dncCount, blocked24] = await Promise.all([
    db.selectFrom("dnc_entries").select((eb) => eb.fn.countAll<number>().as("n")).where("scope", "=", "global").executeTakeFirst(),
    db.selectFrom("audit_log").select((eb) => eb.fn.countAll<number>().as("n")).where("action", "=", "call.blocked").where("created_at", ">=", dayAgoIso()).executeTakeFirst(),
  ]);

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Who may place outbound calls, the platform's stop switches and the global do-not-call list. These are tools, not legal advice: you and your customers stay responsible for the rules that apply to their calls."
        actions={
          <>
            <Link href="/admin/compliance/dnc" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line">
              Global DNC list
            </Link>
            <Link href="/admin/compliance/audit" className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium hover:border-primary-line">
              Audit search
            </Link>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Waiting for review" value={pending.length} />
        <StatCard label="Approved workspaces" value={workspaces.filter((w) => w.outbound_state === "approved").length} />
        <StatCard label="Global DNC numbers" value={Number(dncCount?.n ?? 0).toLocaleString()} />
        <StatCard label="Calls blocked (24 h)" value={Number(blocked24?.n ?? 0).toLocaleString()} hint="By the dial-time checks" />
      </div>

      <Card title="Emergency stop" className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <p className="font-medium">{settings.outbound_kill_switch ? "All outbound calls are stopped." : "Outbound calls are allowed for approved workspaces."}</p>
            <p className="mt-1 text-muted">
              Approval before outbound: <span className="font-medium text-ink">{settings.outbound_requires_approval ? "required" : "not required"}</span> (Settings → Voice providers → Safety).
            </p>
          </div>
          <GlobalKillForm on={settings.outbound_kill_switch} />
        </div>
      </Card>

      <Card title={`Outbound access requests (${pending.length})`} className="mb-6" padded={!pending.length}>
        {pending.length ? (
          <ul className="divide-y divide-line">
            {pending.map((r) => {
              const ws = wsNames.get(r.workspace_id);
              return (
                <li key={r.id} className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-w-0 space-y-3 text-sm">
                    <div>
                      <p className="font-semibold">{r.business_name}</p>
                      <p className="text-xs text-muted">
                        Workspace #{r.workspace_id} {ws ? `· ${ws.name} · ${ws.email ?? ""}` : ""} · sent {formatDate(r.created_at, true)}
                      </p>
                    </div>
                    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted">Address</dt>
                        <dd>{r.address}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Website · Country · Volume</dt>
                        <dd className="break-words">
                          {r.website || "—"} · {r.country || "—"} · {r.expected_volume || "—"}
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <p className="text-xs text-muted">Use case</p>
                      <p className="whitespace-pre-wrap">{r.use_case}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted">How people consent</p>
                      <p className="whitespace-pre-wrap">{r.consent_method}</p>
                    </div>
                    {r.sample_script ? (
                      <div>
                        <p className="text-xs text-muted">Sample script</p>
                        <p className="rounded-lg bg-paper p-3 whitespace-pre-wrap">{r.sample_script}</p>
                      </div>
                    ) : null}
                  </div>
                  <KycReviewForm requestId={r.id} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">No requests are waiting.</p>
        )}
      </Card>

      <Card title="Workspaces" padded={false} className="mb-6">
        {workspaces.length ? (
          <Table minWidth={860} dense>
            <thead>
              <tr>
                <Th>Workspace</Th>
                <Th>Outbound</Th>
                <Th>Acceptable use</Th>
                <Th>Own stop</Th>
                <Th>Kill switch</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <Td>
                    <span className="font-medium">{w.name}</span>
                    <span className="block text-xs text-muted">
                      #{w.id} · {w.email ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATE_TONE[w.outbound_state]} className="capitalize">
                      {w.outbound_state.replace("_", " ")}
                    </Badge>
                  </Td>
                  <Td className="text-muted">{w.aup_accepted_at ? formatDate(w.aup_accepted_at) : "—"}</Td>
                  <Td>{w.outbound_paused ? <Badge tone="warning">Paused</Badge> : <span className="text-muted">—</span>}</Td>
                  <Td>
                    {w.kill_switch ? (
                      <Badge tone="danger" title={w.kill_reason ?? ""}>
                        On
                      </Badge>
                    ) : (
                      <span className="text-muted">Off</span>
                    )}
                    {w.kill_reason ? <span className="mt-0.5 block max-w-48 truncate text-xs text-muted">{w.kill_reason}</span> : null}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {w.outbound_state === "approved" || w.outbound_state === "suspended" ? <OutboundStateForm workspaceId={w.id} state={w.outbound_state} /> : null}
                      <WorkspaceKillForm workspaceId={w.id} on={w.kill_switch === 1} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No workspace has compliance settings yet" />
        )}
      </Card>

      <Card title="Recent decisions" padded={false}>
        {reviewed.filter((r) => r.status !== "pending").length ? (
          <Table minWidth={640} dense>
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Decision</Th>
                <Th>Note</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {reviewed
                .filter((r) => r.status !== "pending")
                .map((r) => (
                  <tr key={r.id}>
                    <Td>
                      {r.business_name} <span className="text-xs text-muted">#{r.workspace_id}</span>
                    </Td>
                    <Td>
                      <Badge tone={STATE_TONE[r.status]} className="capitalize">
                        {r.status}
                      </Badge>
                    </Td>
                    <Td className="max-w-72 truncate text-muted">{r.review_note ?? "—"}</Td>
                    <Td className="text-muted">{formatDate(r.reviewed_at, true)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No decisions yet" />
        )}
      </Card>
    </>
  );
}
