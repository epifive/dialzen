import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { getDb, now } from "@/lib/db";
import { cn, countNoun, formatDate } from "@/lib/utils";

export const metadata = { title: "Users" };

const PER_PAGE = 25;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid plan" },
  { value: "admin", label: "Admins" },
  { value: "banned", label: "Banned" },
] as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; deleted?: string }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const filter = FILTERS.some((f) => f.value === params.filter) ? params.filter! : "all";
  const page = Math.max(1, Number(params.page) || 1);
  const db = await getDb();

  let query = db.selectFrom("users").leftJoin("plans", "plans.id", "users.plan_id");
  if (q) query = query.where((eb) => eb.or([eb("users.name", "like", `%${q}%`), eb("users.email", "like", `%${q}%`)]));
  if (filter === "paid") query = query.where("users.plan_id", "is not", null).where("users.plan_expires_at", ">", now());
  if (filter === "admin") query = query.where("users.role", "=", "admin");
  if (filter === "banned") query = query.where("users.status", "=", "banned");

  const [total, rows] = await Promise.all([
    query.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
    query
      .select([
        "users.id",
        "users.name",
        "users.email",
        "users.role",
        "users.status",
        "users.plan_expires_at",
        "users.created_at",
        "plans.name as plan_name",
      ])
      .orderBy("users.id", "desc")
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE)
      .execute(),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total?.n ?? 0) / PER_PAGE));
  const href = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), filter, page: String(p) })}`;
  const ts = now();

  return (
    <>
      <PageHeader
        title="Users"
        description={countNoun(Number(total?.n ?? 0), "user")}
        actions={
          <ButtonLink href="/admin/users/new">
            <Plus aria-hidden />
            Add user
          </ButtonLink>
        }
      />
      {params.deleted ? <Alert tone="success" className="mb-4">The user was deleted.</Alert> : null}
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <form className="relative w-full sm:max-w-xs" action="/admin/users">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="hidden" name="filter" value={filter} />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name or email"
              aria-label="Search users"
              className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm focus:border-primary focus:outline-none"
            />
          </form>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Link
                key={f.value}
                href={`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), filter: f.value })}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  filter === f.value ? "bg-primary-soft text-primary" : "text-muted hover:text-ink",
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>
        {rows.length ? (
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Plan</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const paid = u.plan_name && u.plan_expires_at && u.plan_expires_at > ts;
                return (
                  <tr key={u.id}>
                    <Td>
                      <Link href={`/admin/users/${u.id}`} className="font-medium hover:text-primary">
                        {u.name}
                      </Link>
                      <p className="text-xs text-muted">{u.email}</p>
                    </Td>
                    <Td>
                      {paid ? (
                        <>
                          {u.plan_name}
                          <p className="text-xs text-muted">until {formatDate(u.plan_expires_at)}</p>
                        </>
                      ) : (
                        <span className="text-muted">Free</span>
                      )}
                    </Td>
                    <Td>{u.role === "admin" ? <Badge tone="primary">Admin</Badge> : <span className="text-muted">User</span>}</Td>
                    <Td>
                      <Badge tone={u.status === "active" ? "success" : "danger"} className="capitalize">
                        {u.status}
                      </Badge>
                    </Td>
                    <Td className="text-muted">{formatDate(u.created_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No users found">Try a different search or filter.</EmptyState>
        )}
        <Pagination page={page} pages={pages} href={href} />
      </Card>
    </>
  );
}
