import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { getDb, now } from "@/lib/db";
import { getAllPlans } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { countNoun, formatMoney } from "@/lib/utils";

export const metadata = { title: "Plans" };

/** "5 agents", "unlimited agents" (-1), "no numbers" (0). */
function limitNoun(value: number, noun: string): string {
  if (value < 0) return `unlimited ${noun}s`;
  if (value === 0) return `no ${noun}s`;
  return countNoun(value, noun);
}

export default async function AdminPlansPage({ searchParams }: { searchParams: Promise<{ saved?: string; deleted?: string }> }) {
  const [plans, settings, params] = await Promise.all([getAllPlans(), getSettings(), searchParams]);
  const db = await getDb();
  const counts = await db
    .selectFrom("users")
    .select(["plan_id", (eb) => eb.fn.countAll<number>().as("n")])
    .where("plan_id", "is not", null)
    .where("plan_expires_at", ">", now())
    .groupBy("plan_id")
    .execute();
  const subscribers = new Map(counts.map((c) => [c.plan_id, Number(c.n)]));

  return (
    <>
      <PageHeader
        title="Plans"
        description="The free plan sets the limits for visitors and free accounts. Paid plans unlock bigger limits."
        actions={
          <ButtonLink href="/admin/plans/new">
            <Plus aria-hidden />
            Add plan
          </ButtonLink>
        }
      />
      {params.saved ? <Alert tone="success" className="mb-4">Plan saved.</Alert> : null}
      {params.deleted ? <Alert tone="success" className="mb-4">Plan deleted.</Alert> : null}
      <Card padded={false}>
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>Plan</Th>
              <Th>Monthly</Th>
              <Th>Yearly</Th>
              <Th>Limits</Th>
              <Th>Active users</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <Td>
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {p.name}
                    {p.is_free ? <Badge tone="primary">Free plan</Badge> : null}
                    {p.is_featured ? <Badge tone="warning">Recommended</Badge> : null}
                    {!p.is_active ? <Badge>Hidden</Badge> : null}
                  </span>
                  {p.description ? <p className="text-xs text-muted">{p.description}</p> : null}
                </Td>
                <Td className="tabular-nums">{p.is_free ? "—" : formatMoney(p.price_monthly, settings.currency)}</Td>
                <Td className="tabular-nums">{p.is_free ? "—" : formatMoney(p.price_yearly, settings.currency)}</Td>
                <Td className="text-muted">
                  {limitNoun(p.max_agents, "agent")}, {limitNoun(p.max_numbers, "number")}, {limitNoun(p.included_minutes_monthly, "minute")}/month, {limitNoun(p.max_concurrent_calls, "call")} at once,{" "}
                  {limitNoun(p.max_members, "member")}
                  {[p.allow_outbound ? "outbound" : "", p.allow_campaigns ? "campaigns" : "", p.allow_api ? "API" : "", p.allow_byo_keys ? "own keys" : "", p.allow_white_label ? "white label" : "", p.remove_branding ? "no branding" : ""]
                    .filter(Boolean)
                    .map((f) => `, ${f}`)
                    .join("")}
                </Td>
                <Td className="tabular-nums">{p.is_free ? "—" : (subscribers.get(p.id) ?? 0)}</Td>
                <Td className="text-right">
                  <Link href={`/admin/plans/${p.id}`} className="text-sm font-medium text-primary hover:underline">
                    Edit
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
