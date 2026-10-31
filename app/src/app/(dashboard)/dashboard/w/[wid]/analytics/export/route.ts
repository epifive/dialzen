import { listAgents } from "@/lib/agents";
import { lastDays, loadAnalytics, type Totals } from "@/lib/analytics";
import { getCurrentUser } from "@/lib/auth/session";
import { listCampaigns } from "@/lib/campaigns";
import { csvResponse } from "@/lib/csv";
import { workspaceIdOf } from "@/lib/dashboard";
import { listNumbers } from "@/lib/numbers";
import { getMembership } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

/**
 * CSV of the analytics page (same range and filters): one row per day, then per agent, campaign
 * and number, with a "section" column.
 */
export async function GET(request: Request, { params }: { params: Promise<{ wid: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Sign in first.", { status: 401 });
  const membership = await getMembership(workspaceIdOf((await params).wid), user.id);
  if (!membership) return new Response("Not found.", { status: 404 });
  const ws = membership.workspace;
  const q = new URL(request.url).searchParams;
  const range = [7, 30, 90].includes(Number(q.get("days"))) ? Number(q.get("days")) : 30;
  const direction = q.get("direction");
  const days = lastDays(range, ws.timezone);
  const [data, agents, campaigns, numbers] = await Promise.all([
    loadAnalytics(ws.id, ws.timezone, days, {
      agentId: Number(q.get("agent")) || undefined,
      campaignId: Number(q.get("campaign")) || undefined,
      direction: direction === "inbound" || direction === "outbound" || direction === "web" ? direction : undefined,
    }),
    listAgents(ws.id),
    listCampaigns(ws.id),
    listNumbers(ws.id, { includeReleased: true }),
  ]);
  const cols = (t: Pick<Totals, "calls" | "answered" | "answerRate" | "billedSeconds" | "bookings" | "optOuts" | "creditsMicros" | "costMicros">) => [
    t.calls,
    t.answered,
    t.answerRate === null ? "" : (t.answerRate * 100).toFixed(1),
    (t.billedSeconds / 60).toFixed(1),
    t.bookings,
    t.optOuts,
    (t.creditsMicros / 1_000_000).toFixed(4),
  ];
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const numberName = new Map(numbers.map((n) => [n.id, n.e164]));
  const rows: unknown[][] = [["section", "key", "name", "calls", "answered", "answer_rate_pct", "billed_minutes", "bookings", "opt_outs", "credits"]];
  for (const d of data.daily) rows.push(["day", d.day, d.day, d.calls, d.answered, d.calls ? ((d.answered / d.calls) * 100).toFixed(1) : "", (d.billedSeconds / 60).toFixed(1), d.bookings, "", ""]);
  rows.push(["total", "", `${data.from}..${data.to}`, ...cols(data.totals)]);
  for (const r of data.byAgent) rows.push(["agent", r.id ?? "", r.id ? (agentName.get(r.id) ?? "") : "", ...cols(r)]);
  for (const r of data.byCampaign) rows.push(["campaign", r.id ?? "", campaignName.get(r.id ?? 0) ?? "", ...cols(r)]);
  for (const r of data.byNumber) rows.push(["number", r.id ?? "", numberName.get(r.id ?? 0) ?? "", ...cols(r)]);
  return csvResponse(`analytics-${ws.id}-${data.from}-${data.to}.csv`, rows);
}
