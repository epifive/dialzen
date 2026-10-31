import Link from "next/link";
import { Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { GATEWAY_LABELS } from "@/lib/payments";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { PaymentReview } from "./payment-actions";

export const metadata = { title: "Payments" };

const PER_PAGE = 30;
const STATUSES = ["all", "paid", "pending", "rejected"] as const;
const TONE = { paid: "success", pending: "warning", rejected: "danger", refunded: "neutral" } as const;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const params = await searchParams;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "") ? params.status! : "all";
  const page = Math.max(1, Number(params.page) || 1);
  const db = await getDb();

  let query = db
    .selectFrom("payments")
    .leftJoin("users", "users.id", "payments.user_id")
    .leftJoin("plans", "plans.id", "payments.plan_id");
  if (status !== "all") query = query.where("payments.status", "=", status as "paid" | "pending" | "rejected");

  const [total, rows] = await Promise.all([
    query.select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
    query
      .select([
        "payments.id",
        "payments.amount",
        "payments.currency",
        "payments.billing_cycle",
        "payments.provider",
        "payments.provider_ref",
        "payments.status",
        "payments.note",
        "payments.created_at",
        "payments.purpose",
        "payments.workspace_id",
        "users.id as user_id",
        "users.email",
        "plans.name as plan_name",
      ])
      .orderBy("payments.id", "desc")
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE)
      .execute(),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total?.n ?? 0) / PER_PAGE));

  return (
    <>
      <PageHeader title="Payments" description="Every payment across all gateways. Approve bank transfers here." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-1 border-b border-line p-3">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={`/admin/payments?status=${s}`}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium capitalize", status === s ? "bg-primary-soft text-primary" : "text-muted hover:text-ink")}
            >
              {s}
            </Link>
          ))}
        </div>
        {rows.length ? (
          <Table minWidth={820} dense>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>User</Th>
                <Th>Plan</Th>
                <Th>Method</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap text-muted">
                    {formatDate(p.created_at)}
                    <span className="block text-xs">{new Date(p.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                  </Td>
                  <Td>
                    {p.user_id ? (
                      <Link href={`/admin/users/${p.user_id}`} title={p.email ?? undefined} className="block max-w-52 truncate hover:text-primary">
                        {p.email}
                      </Link>
                    ) : (
                      <span className="text-muted">Deleted user</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {p.purpose === "credits" ? (
                      <>
                        Call credits <span className="text-muted">(workspace #{p.workspace_id})</span>
                      </>
                    ) : (
                      <>
                        {p.plan_name ?? "—"} <span className="text-muted">({p.billing_cycle})</span>
                      </>
                    )}
                  </Td>
                  <Td>
                    {GATEWAY_LABELS[p.provider]}
                    {p.note ? <p className="max-w-44 truncate text-xs text-muted" title={p.note}>Ref: {p.note}</p> : null}
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{formatMoney(p.amount, p.currency)}</Td>
                  <Td>
                    <Badge tone={TONE[p.status]} className="capitalize">
                      {p.status}
                    </Badge>
                  </Td>
                  <Td>{p.status === "pending" && p.provider === "offline" ? <PaymentReview id={p.id} credits={p.purpose === "credits"} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No payments here yet" />
        )}
        <Pagination page={page} pages={pages} href={(p) => `/admin/payments?status=${status}&page=${p}`} />
      </Card>
    </>
  );
}
