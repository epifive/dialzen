import type { ReactNode } from "react";
import { sql } from "kysely";
import { Card, PageHeader } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { isDemoMode, storageDir } from "@/lib/config";
import { dbDriver, getDb } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { JOBS } from "@/lib/jobs";
import { getCronSecret, cronSecretFromEnv, getSchedulerStatus } from "@/lib/scheduler";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { formatDate } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { CopyValue, RegenerateKeyForm, RunChecksForm } from "./scheduler-forms";
import { ClearCacheForm, PruneSessionsForm, TestEmailForm } from "./system-forms";

export const metadata = { title: "System" };

export default async function SystemPage() {
  const db = await getDb();
  const settings = await getSettings();
  const migrations = await sql<{ name: string; timestamp: string }>`select name, timestamp from kysely_migration order by name`
    .execute(db)
    .then((r) => r.rows)
    .catch(() => []);
  const driver = dbDriver();

  const info: Array<[string, ReactNode]> = [
    ["Application version", APP_VERSION],
    ["Node.js", process.versions.node],
    ["Database", driver === "mysql" ? "MySQL / MariaDB" : "SQLite"],
    ["Storage folder", <code key="s" className="font-mono text-xs break-all">{storageDir()}</code>],
    ["Environment", process.env.NODE_ENV],
    ["Demo mode", isDemoMode() ? <Badge key="d" tone="warning">On</Badge> : "Off"],
    ["Email", mailConfigured(settings) ? <Badge key="e" tone="success">Configured</Badge> : <Badge key="e">Not configured</Badge>],
  ];

  const count = (row: { n: number | string | bigint } | undefined) => Number(row?.n ?? 0);
  const rows = (table: "workspaces" | "workspace_members" | "agents" | "phone_numbers" | "contacts" | "campaigns" | "calls" | "dnc_entries" | "media" | "webhook_events" | "audit_log" | "alert_log") =>
    db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst().then(count);
  const [scheduler, secret, workspaceRows, memberRows, agentRows, numberRows, contactRows, campaignRows, callRows, liveCalls, dncRows, mediaRows, webhookRows, auditRows, alertRows, jobRows] = await Promise.all([
    getSchedulerStatus(),
    getCronSecret(),
    rows("workspaces"),
    rows("workspace_members"),
    rows("agents"),
    rows("phone_numbers"),
    rows("contacts"),
    rows("campaigns"),
    rows("calls"),
    db.selectFrom("calls").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "in", ["queued", "ringing", "in_progress"]).executeTakeFirst().then(count),
    rows("dnc_entries"),
    rows("media"),
    rows("webhook_events"),
    rows("audit_log"),
    rows("alert_log"),
    db.selectFrom("settings").select(["key", "value"]).where("key", "like", "job_next:%").execute(),
  ]);
  const jobSetting = new Map(jobRows.map((r) => [r.key, r.value]));
  const jobNotes: Record<string, string> = {
    housekeeping: "Expired sessions, reset links and invites, notification log entries older than 90 days and webhook records older than 30 days.",
  };
  const n = (v: number) => v.toLocaleString("en-US");
  const data: Array<[string, ReactNode]> = [
    ["Workspaces (members)", `${n(workspaceRows)} (${n(memberRows)})`],
    ["Agents", n(agentRows)],
    ["Phone numbers", n(numberRows)],
    ["Contacts", n(contactRows)],
    ["Campaigns", n(campaignRows)],
    ["Calls (live now)", `${n(callRows)} (${n(liveCalls)})`],
    ["Do-not-call entries", n(dncRows)],
    ["Uploaded files", n(mediaRows)],
    ["Provider webhook events (30 days)", n(webhookRows)],
    ["Audit log entries", n(auditRows)],
    ["Notification log entries", n(alertRows)],
  ];
  const demo = isDemoMode();
  const cronUrl = absoluteUrl(settings, `/api/cron/tick?key=${demo ? "hidden-in-demo" : encodeURIComponent(secret)}`);
  const healthy = scheduler.healthy;
  const last = scheduler.lastSummary;

  return (
    <>
      <PageHeader title="System" description="Server information and maintenance tools." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card
          title="Scheduler"
          className="xl:col-span-2"
          actions={healthy ? <Badge tone="success">Running</Badge> : <Badge tone="warning">{scheduler.lastTickAt ? "Stalled" : "Never ran"}</Badge>}
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <dl className="divide-y divide-line text-sm">
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Last run</dt>
                  <dd className="text-right">
                    {scheduler.lastTickAt ? formatDate(scheduler.lastTickAt, true) : "Never"}
                    {scheduler.lastSource ? <span className="text-muted"> · {scheduler.lastSource}</span> : null}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Last result</dt>
                  <dd className="text-right">
                    {last ? (last.skippedLocked ? "Skipped (another run was active)" : `${(last.durationMs / 1000).toFixed(1)} s`) : "—"}
                  </dd>
                </div>
                {last && !last.skippedLocked ? (
                  <div className="py-2">
                    <dt className="sr-only">Jobs</dt>
                    <dd>
                      <ul className="flex flex-wrap gap-1.5">
                        {Object.entries(last.jobs).map(([name, n]) => (
                          <li key={name}>
                            <Badge tone={n > 0 ? "primary" : "neutral"}>
                              {name}: {n.toLocaleString("en-US")}
                            </Badge>
                          </li>
                        ))}
                        {last.failed.map((name) => (
                          <li key={`f-${name}`}>
                            <Badge tone="danger">{name}: failed</Badge>
                          </li>
                        ))}
                        {last.skipped.map((name) => (
                          <li key={`s-${name}`}>
                            <Badge tone="warning">{name}: next run</Badge>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1.5 text-xs text-muted">
                        Items handled per job (calls dialed, calls reconciled, rows cleaned up).
                        Failed jobs are logged on the server.
                      </p>
                    </dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4 py-2">
                  <dt className="text-muted">Lazy mode (jobs on page views)</dt>
                  <dd className="text-right">{settings.lazy_scheduler ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}</dd>
                </div>
              </dl>
              <RunChecksForm />
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-2 font-medium">Cron URL</p>
                <CopyValue value={cronUrl} label="Cron URL" />
                <p className="mt-2 text-xs text-muted">
                  {cronSecretFromEnv()
                    ? "The secret comes from the CRON_SECRET environment variable."
                    : "Keep this URL private. The secret is stored in the database."}
                </p>
              </div>
              <div>
                <p className="font-medium">cPanel / Linux cron (every minute)</p>
                <code className="mt-1 block overflow-x-auto rounded-lg bg-paper p-3 font-mono text-xs whitespace-nowrap" dir="ltr">
                  {`*/1 * * * * curl -fsS "${cronUrl}" >/dev/null 2>&1`}
                </code>
              </div>
              <div>
                <p className="font-medium">VPS / Docker worker (every 15 seconds)</p>
                <p className="mt-1 text-muted">
                  Run <code className="font-mono text-xs">CRON_SECRET=… npm run worker</code> next to the app, or use the
                  <code className="font-mono text-xs"> dialzen-worker</code> process in <code className="font-mono text-xs">ecosystem.config.cjs</code> /
                  the <code className="font-mono text-xs">worker</code> service in <code className="font-mono text-xs">docker-compose.yml</code>.
                </p>
              </div>
              <p className="text-muted">
                Without cron or the worker, lazy mode runs the background jobs (campaign dialing, call reconciliation, recordings,
                retention) at most once a minute while people use the site, so campaigns can dial late. For reliable timing use the cron URL or
                the worker. Turn lazy mode on or off in Settings → Scheduler.
              </p>
              {!cronSecretFromEnv() && !demo ? <RegenerateKeyForm /> : null}
            </div>
          </div>
        </Card>
        <Card title="Background jobs" className="xl:col-span-2" padded={false}>
          <ul className="divide-y divide-line text-sm">
            {JOBS.map((job) => {
              const next = jobSetting.get(`job_next:${job.name}`);
              const handled = last && !last.skippedLocked ? last.jobs[job.name] : undefined;
              const failed = last?.failed.includes(job.name);
              return (
                <li key={job.name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium">{job.name}</p>
                    <p className="mt-0.5 text-muted">{jobNotes[job.name] ?? ""}</p>
                  </div>
                  <div className="shrink-0 text-xs text-muted sm:text-right">
                    {failed ? <Badge tone="danger">Failed last run</Badge> : handled !== undefined ? <Badge tone={handled > 0 ? "primary" : "neutral"}>Last run: {handled.toLocaleString("en-US")}</Badge> : null}
                    <p className="mt-1">Next: {next ? (next <= new Date().toISOString() ? "next tick" : formatDate(next, true)) : "next tick"}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Server">
          <dl className="divide-y divide-line text-sm">
            {info.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Data">
          <dl className="divide-y divide-line text-sm">
            {data.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Notification log entries are kept for 90 days and webhook records for 30 days; calls, recordings and transcripts follow the retention settings of each workspace.</p>
        </Card>
        <Card title="Database migrations">
          <p className="mb-3 text-sm text-muted">Migrations run automatically after an update. These have been applied:</p>
          <ul className="space-y-1.5 font-mono text-xs">
            {migrations.map((m) => (
              <li key={m.name} className="flex justify-between gap-3">
                <span>{m.name}</span>
                <span className="text-muted">{String(m.timestamp).slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Maintenance">
          <div className="space-y-6">
            <div>
              <p className="mb-3 text-sm text-muted">Reload settings from the database if you edited them directly.</p>
              <ClearCacheForm />
            </div>
            <div className="border-t border-line pt-6">
              <p className="mb-3 text-sm text-muted">Delete expired sign-in sessions and password reset links.</p>
              <PruneSessionsForm />
            </div>
          </div>
        </Card>
        <Card title="Email test">
          <TestEmailForm defaultTo={settings.site_email} />
        </Card>
      </div>
    </>
  );
}
