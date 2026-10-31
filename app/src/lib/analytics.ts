import "server-only";
import { getDb } from "./db";
import { addDays, dayBoundsIso, localDay } from "./jobs/shared";
import { zonedParts } from "@/voice/normalize";
import { FINAL_CALL_STATUSES, type CallStatus } from "@/voice/types";

/**
 * Call analytics of a workspace over a period of local days: totals, answer rate, minutes,
 * outcomes, bookings, sentiment, credits and provider cost, breakdowns per agent / campaign /
 * number, daily series and the weekday × hour answer-rate heatmap. The maths is in
 * computeAnalytics() (pure, tested); loadAnalytics() reads the rows.
 */

export interface AnalyticsRow {
  agent_id: number | null;
  campaign_id: number | null;
  number_id: number | null;
  direction: string;
  status: string;
  outcome: string | null;
  sentiment: string;
  duration_sec: number;
  billed_seconds: number;
  included_seconds: number;
  credits_settled_micros: number;
  provider_cost_micros: number | null;
  created_at: string;
}

export interface Totals {
  calls: number;
  /** Calls with a final status other than canceled (could have been answered). */
  finished: number;
  answered: number;
  /** answered / finished, 0–1 (null when nothing finished). */
  answerRate: number | null;
  /** Talk time of answered calls, seconds. */
  talkSeconds: number;
  billedSeconds: number;
  includedSeconds: number;
  /** Average duration of answered calls, seconds (null when none). */
  avgDuration: number | null;
  bookings: number;
  optOuts: number;
  creditsMicros: number;
  costMicros: number;
}

export interface Breakdown extends Totals {
  id: number | null;
}

export interface DayPoint {
  day: string;
  calls: number;
  answered: number;
  bookings: number;
  billedSeconds: number;
}

export interface Analytics {
  from: string;
  to: string;
  days: string[];
  totals: Totals;
  daily: DayPoint[];
  /** By outcome label (booked, completed, no_answer…). */
  outcomes: Record<string, number>;
  /** Sentiment of answered calls. */
  sentiment: Record<string, number>;
  byAgent: Breakdown[];
  byCampaign: Breakdown[];
  byNumber: Breakdown[];
  /** heatmap[weekday 1–7][hour 0–23] = outbound calls and answered. */
  heatmap: Record<number, Array<{ calls: number; answered: number }>>;
}

const FINAL = new Set<string>(FINAL_CALL_STATUSES);

function emptyTotals(): Totals {
  return { calls: 0, finished: 0, answered: 0, answerRate: null, talkSeconds: 0, billedSeconds: 0, includedSeconds: 0, avgDuration: null, bookings: 0, optOuts: 0, creditsMicros: 0, costMicros: 0 };
}

function add(t: Totals, r: AnalyticsRow) {
  t.calls += 1;
  if (FINAL.has(r.status) && r.status !== "canceled") t.finished += 1;
  if (r.status === "completed") {
    t.answered += 1;
    t.talkSeconds += Number(r.duration_sec) || 0;
  }
  t.billedSeconds += Number(r.billed_seconds) || 0;
  t.includedSeconds += Number(r.included_seconds) || 0;
  if (r.outcome === "booked") t.bookings += 1;
  if (r.outcome === "opted_out") t.optOuts += 1;
  t.creditsMicros += Number(r.credits_settled_micros) || 0;
  t.costMicros += Number(r.provider_cost_micros ?? 0) || 0;
}

function finish(t: Totals): Totals {
  t.answerRate = t.finished ? t.answered / t.finished : null;
  t.avgDuration = t.answered ? t.talkSeconds / t.answered : null;
  return t;
}

/** The outcome label of a call for the outcome chart. */
export function outcomeLabel(r: Pick<AnalyticsRow, "status" | "outcome">): string {
  if (r.outcome === "booked" || r.outcome === "transferred" || r.outcome === "opted_out") return r.outcome;
  return r.status as CallStatus;
}

/** Pure analytics of `rows` over the local days `days` (oldest first) of `timezone`. */
export function computeAnalytics(rows: AnalyticsRow[], days: string[], timezone: string): Analytics {
  const totals = emptyTotals();
  const daily = new Map(days.map((d) => [d, { day: d, calls: 0, answered: 0, bookings: 0, billedSeconds: 0 }]));
  const outcomes: Record<string, number> = {};
  const sentiment: Record<string, number> = {};
  const groups = { agent: new Map<number | null, Totals>(), campaign: new Map<number | null, Totals>(), number: new Map<number | null, Totals>() };
  const heatmap: Analytics["heatmap"] = {};
  for (let d = 1; d <= 7; d++) heatmap[d] = Array.from({ length: 24 }, () => ({ calls: 0, answered: 0 }));

  for (const r of rows) {
    add(totals, r);
    const ms = Date.parse(r.created_at);
    const day = localDay(ms, timezone);
    const point = daily.get(day);
    if (point) {
      point.calls += 1;
      if (r.status === "completed") point.answered += 1;
      if (r.outcome === "booked") point.bookings += 1;
      point.billedSeconds += Number(r.billed_seconds) || 0;
    }
    const label = outcomeLabel(r);
    outcomes[label] = (outcomes[label] ?? 0) + 1;
    if (r.status === "completed") sentiment[r.sentiment || "unknown"] = (sentiment[r.sentiment || "unknown"] ?? 0) + 1;
    for (const [key, id] of [
      ["agent", r.agent_id],
      ["campaign", r.campaign_id],
      ["number", r.number_id],
    ] as const) {
      if (key !== "agent" && id === null) continue;
      const map = groups[key];
      if (!map.has(id)) map.set(id, emptyTotals());
      add(map.get(id)!, r);
    }
    if (r.direction === "outbound" && FINAL.has(r.status) && r.status !== "canceled") {
      const p = zonedParts(ms, timezone);
      const cell = heatmap[p.weekday][p.hour];
      cell.calls += 1;
      if (r.status === "completed") cell.answered += 1;
    }
  }
  const breakdown = (m: Map<number | null, Totals>) =>
    [...m.entries()].map(([id, t]) => ({ id, ...finish(t) })).sort((a, b) => b.calls - a.calls);
  return {
    from: days[0],
    to: days[days.length - 1],
    days,
    totals: finish(totals),
    daily: [...daily.values()],
    outcomes,
    sentiment,
    byAgent: breakdown(groups.agent),
    byCampaign: breakdown(groups.campaign),
    byNumber: breakdown(groups.number),
    heatmap,
  };
}

/** The last `n` local days ending today (oldest first). */
export function lastDays(n: number, timezone: string, nowMs = Date.now()): string[] {
  const today = localDay(nowMs, timezone);
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}

export interface AnalyticsFilter {
  agentId?: number;
  campaignId?: number;
  direction?: "inbound" | "outbound" | "web";
}

/** Reads the calls of the period and computes the analytics. */
export async function loadAnalytics(workspaceId: number, timezone: string, days: string[], filter: AnalyticsFilter = {}): Promise<Analytics> {
  const from = dayBoundsIso(days[0], timezone).start;
  const to = dayBoundsIso(days[days.length - 1], timezone).end;
  const db = await getDb();
  let q = db
    .selectFrom("calls")
    .select(["agent_id", "campaign_id", "number_id", "direction", "status", "outcome", "sentiment", "duration_sec", "billed_seconds", "included_seconds", "credits_settled_micros", "provider_cost_micros", "created_at"])
    .where("workspace_id", "=", workspaceId)
    .where("created_at", ">=", from)
    .where("created_at", "<", to);
  if (filter.agentId) q = q.where("agent_id", "=", filter.agentId);
  if (filter.campaignId) q = q.where("campaign_id", "=", filter.campaignId);
  if (filter.direction) q = q.where("direction", "=", filter.direction);
  const rows = (await q.limit(200_000).execute()) as AnalyticsRow[];
  return computeAnalytics(rows, days, timezone);
}
