import { callFilterFromQuery, type CallQuery } from "@/components/dashboard/call-query";
import { listAgents } from "@/lib/agents";
import { getCurrentUser } from "@/lib/auth/session";
import { listCalls } from "@/lib/calls";
import { csvResponse } from "@/lib/csv";
import { workspaceIdOf } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { getMembership } from "@/lib/workspaces";
import { END_REASON_LABELS } from "@/voice/format";

/** CSV export of the calls list with the same filters (at most 10,000 rows). */
export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

export async function GET(request: Request, { params }: { params: Promise<{ wid: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("Unauthorized", { status: 401 });
  const membership = await getMembership(workspaceIdOf((await params).wid), user.id);
  if (!membership) return new Response("Not found", { status: 404 });
  if (!rateLimit(`dz-calls-csv:${user.id}`, 10, 60_000)) return new Response("Too many requests", { status: 429 });
  const workspace = membership.workspace;
  const query = Object.fromEntries(new URL(request.url).searchParams) as CallQuery;
  const { filter, none } = await callFilterFromQuery(workspace.id, query);
  const { calls } = none ? { calls: [] } : await listCalls(workspace.id, { ...filter, limit: MAX_ROWS });
  const agents = new Map((await listAgents(workspace.id)).map((a) => [a.id, a.name]));
  const contactIds = [...new Set(calls.map((c) => c.contactId).filter((n): n is number => Boolean(n)))];
  const db = await getDb();
  const contacts = new Map<number, string>();
  for (let i = 0; i < contactIds.length; i += 500) {
    const rows = await db.selectFrom("contacts").select(["id", "first_name", "last_name"]).where("workspace_id", "=", workspace.id).where("id", "in", contactIds.slice(i, i + 500)).execute();
    for (const r of rows) contacts.set(r.id, [r.first_name, r.last_name].filter(Boolean).join(" "));
  }
  const rows: unknown[][] = [
    ["id", "started_at", "ended_at", "direction", "from", "to", "contact", "agent", "campaign_id", "status", "end_reason", "duration_sec", "billed_seconds", "included_seconds", "credits", "outcome", "sentiment", "summary", "extracted"],
    ...calls.map((c) => [
      c.id,
      c.startedAt ?? c.createdAt,
      c.endedAt ?? "",
      c.direction,
      c.from,
      c.to,
      c.contactId ? (contacts.get(c.contactId) ?? "") : "",
      c.agentId ? (agents.get(c.agentId) ?? "") : "",
      c.campaignId ?? "",
      c.status,
      c.endReason ? END_REASON_LABELS[c.endReason] : "",
      c.durationSec,
      c.billedSeconds,
      c.includedSeconds,
      (c.creditsSettledMicros / 1_000_000).toFixed(4),
      c.outcome ?? "",
      c.sentiment,
      c.summary,
      Object.keys(c.extracted).length ? JSON.stringify(c.extracted) : "",
    ]),
  ];
  return csvResponse(`calls-${workspace.id}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}
