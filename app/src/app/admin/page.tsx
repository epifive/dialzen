import Link from "next/link";
import { CircleCheck, CircleDashed } from "lucide-react";
import { Card, EmptyState, PageHeader, StatCard, Table, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { getDb, now } from "@/lib/db";
import { periodRange } from "@/lib/periods";
import { mailConfigured } from "@/lib/mail";
import { enabledGateways } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { countNoun, formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function daysAgo(n: number): string {
  return daysAgoIso(n).slice(0, 10);
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export default async function AdminDashboard() {
  const db = await getDb();
  const settings = await getSettings();
  const monthStart = monthStartIso();
  const last30 = periodRange(30);
  const since14 = daysAgo(13);

  const [users, newUsers, premium, revenue, calls30, daily, topWorkspaces, workspaces, agents, recentUsers, recentPayments, pendingOffline, unread, pendingKyc] =
    await Promise.all([
      db.selectFrom("users").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
      db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("created_at", ">=", daysAgoIso(30))
        .executeTakeFirst(),
      db
        .selectFrom("users")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("plan_id", "is not", null)
        .where("plan_expires_at", ">", now())
        .executeTakeFirst(),
      db
        .selectFrom("payments")
        .select((eb) => eb.fn.sum<number>("amount").as("total"))
        .where("status", "=", "paid")
        .where("currency", "=", settings.currency)
        .where("created_at", ">=", monthStart)
        .executeTakeFirst(),
      db
        .selectFrom("calls")
        .select([(eb) => eb.fn.countAll<number>().as("total"), (eb) => eb.fn.sum<number>("duration_sec").as("seconds")])
        .where("created_at", ">=", `${last30.fromDay}T00:00:00.000Z`)
        .executeTakeFirst(),
      db.selectFrom("calls").select("created_at").where("created_at", ">=", `${since14}T00:00:00.000Z`).execute(),
      // Busiest workspaces by calls in the last 30 days.
      db
        .selectFrom("calls")
        .innerJoin("workspaces", "workspaces.id", "calls.workspace_id")
        .innerJoin("users", "users.id", "workspaces.owner_id")
        .select(["workspaces.id", "workspaces.name", "users.email", (eb) => eb.fn.countAll<number>().as("total")])
        .where("calls.created_at", ">=", `${last30.fromDay}T00:00:00.000Z`)
        .groupBy(["workspaces.id", "workspaces.name", "users.email"])
        .orderBy("total", "desc")
        .limit(8)
        .execute(),
      db.selectFrom("workspaces").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
      db.selectFrom("agents").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
      db.selectFrom("users").select(["id", "name", "email", "created_at", "role"]).orderBy("id", "desc").limit(6).execute(),
      db
        .selectFrom("payments")
        .innerJoin("users", "users.id", "payments.user_id")
        .select(["payments.id", "payments.amount", "payments.currency", "payments.status", "payments.created_at", "users.email"])
        .orderBy("payments.id", "desc")
        .limit(6)
        .execute(),
      db
        .selectFrom("payments")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("provider", "=", "offline")
        .where("status", "=", "pending")
        .executeTakeFirst(),
      db.selectFrom("contact_messages").select((eb) => eb.fn.countAll<number>().as("n")).where("is_read", "=", 0).executeTakeFirst(),
      db.selectFrom("kyc_requests").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "=", "pending").executeTakeFirst(),
    ]);

  const byDay = new Map<string, number>();
  for (const row of daily) {
    const day = (row.created_at ?? "").slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const chart = Array.from({ length: 14 }, (_, i) => {
    const day = daysAgo(13 - i);
    return { day, value: byDay.get(day) ?? 0 };
  });
  const max = Math.max(1, ...chart.map((c) => c.value));

  const checklist = [
    // SITE_URL in the environment counts too (absoluteUrl() falls back to it).
    { done: Boolean(settings.site_url || process.env.SITE_URL?.trim()), label: "Set your site URL", href: "/admin/settings/general" },
    { done: Boolean(settings.logo) || settings.site_name !== "Dialzen", label: "Add your brand name and logo", href: "/admin/settings/general" },
    { done: enabledGateways(settings).length > 0, label: "Connect a payment gateway", href: "/admin/settings/payments" },
    { done: mailConfigured(settings), label: "Configure email (SMTP)", href: "/admin/settings/email" },
    { done: Boolean(settings.elevenlabs_api_key || settings.retell_api_key), label: "Add a voice provider key (ElevenLabs or Retell)", href: "/admin/settings/voice" },
    { done: Number(agents?.n ?? 0) > 0, label: "Create your first AI agent in the dashboard", href: "/dashboard" },
  ];
  const remaining = checklist.filter((c) => !c.done);

  return (
    <>
      <PageHeader title="Dashboard" description={`Overview of ${settings.site_name}.`} />

      {Number(pendingOffline?.n) > 0 || Number(unread?.n) > 0 || Number(pendingKyc?.n) > 0 ? (
        <div className="mb-6 flex flex-wrap gap-3">
          {Number(pendingOffline?.n) > 0 ? (
            <Link href="/admin/payments?status=pending" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {pendingOffline?.n} bank transfer{Number(pendingOffline?.n) > 1 ? "s" : ""} waiting for approval
            </Link>
          ) : null}
          {Number(pendingKyc?.n) > 0 ? (
            <span className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {countNoun(Number(pendingKyc?.n), "outbound calling request")} waiting for review
            </span>
          ) : null}
          {Number(unread?.n) > 0 ? (
            <Link href="/admin/messages" className="rounded-lg border border-primary-line bg-primary-soft px-4 py-2 text-sm font-medium">
              {unread?.n} unread message{Number(unread?.n) > 1 ? "s" : ""}
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Users" value={Number(users?.n ?? 0).toLocaleString("en-US")} hint={`${Number(newUsers?.n ?? 0)} joined in the last 30 days`} />
        <StatCard label="Active paid plans" value={Number(premium?.n ?? 0).toLocaleString("en-US")} />
        <StatCard label="Revenue this month" value={formatMoney(Number(revenue?.total ?? 0), settings.currency)} hint={`Payments in ${settings.currency}`} />
        <StatCard
          label="Calls, 30 days"
          value={Number(calls30?.total ?? 0).toLocaleString("en-US")}
          hint={`${countNoun(Math.round(Number(calls30?.seconds ?? 0) / 60), "minute")} · ${countNoun(Number(workspaces?.n ?? 0), "workspace")}, ${countNoun(Number(agents?.n ?? 0), "agent")}`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Calls, last 14 days">
          <div className="flex h-48 items-end gap-1.5" role="img" aria-label="Bar chart of calls per day for the last 14 days">
            {chart.map((c) => (
              <div key={c.day} className="group flex h-full flex-1 flex-col justify-end" title={`${formatDate(c.day)}: ${countNoun(c.value, "call")}`}>
                <div
                  className="min-h-[2px] rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${(c.value / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>{formatDate(chart[0].day)}</span>
            <span>Today</span>
          </div>
        </Card>

        {remaining.length ? (
          <Card title="Finish setting up">
            <ul className="space-y-1">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-paper">
                    {c.done ? (
                      <CircleCheck className="size-5 text-primary" aria-label="Done" />
                    ) : (
                      <CircleDashed className="size-5 text-muted" aria-label="To do" />
                    )}
                    <span className={c.done ? "text-muted line-through" : undefined}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card title="Busiest workspaces, 30 days" padded={false}>
            <TopWorkspaces rows={topWorkspaces} />
          </Card>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {remaining.length ? (
          <Card title="Busiest workspaces, 30 days" padded={false}>
            <TopWorkspaces rows={topWorkspaces} />
          </Card>
        ) : null}
        <Card title="Newest users" padded={false} actions={<Link href="/admin/users" className="text-sm text-primary hover:underline">View all</Link>}>
          {recentUsers.length ? (
            <Table minWidth={420}>
              <tbody>
                {recentUsers.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <Link href={`/admin/users/${u.id}`} className="font-medium hover:text-primary">
                        {u.name}
                      </Link>
                      <p className="text-xs text-muted">{u.email}</p>
                    </Td>
                    <Td className="text-right text-muted">{formatDate(u.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No users yet" />
          )}
        </Card>
        <Card title="Latest payments" padded={false} actions={<Link href="/admin/payments" className="text-sm text-primary hover:underline">View all</Link>}>
          {recentPayments.length ? (
            <Table minWidth={420}>
              <tbody>
                {recentPayments.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <span className="font-medium tabular-nums">{formatMoney(p.amount, p.currency)}</span>
                      <p className="text-xs text-muted">{p.email}</p>
                    </Td>
                    <Td>
                      <Badge tone={p.status === "paid" ? "success" : p.status === "pending" ? "warning" : "danger"} className="capitalize">
                        {p.status}
                      </Badge>
                    </Td>
                    <Td className="text-right text-muted">{formatDate(p.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No payments yet">Connect a payment gateway in Settings → Payments.</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}

function TopWorkspaces({ rows }: { rows: Array<{ id: number; name: string; email: string; total: number | string }> }) {
  if (!rows.length) return <EmptyState title="No calls yet">The busiest workspaces of the last 30 days appear here once the agents of your customers take calls.</EmptyState>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{r.name}</span>
            <span className="block truncate text-xs text-muted">{r.email}</span>
          </span>
          <span className="shrink-0 font-medium tabular-nums" title="Calls in the last 30 days">
            {countNoun(Number(r.total), "call")}
          </span>
        </li>
      ))}
    </ul>
  );
}
