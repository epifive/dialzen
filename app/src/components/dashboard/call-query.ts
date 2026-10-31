import "server-only";
import type { CallFilter } from "@/lib/calls";
import { getDb } from "@/lib/db";
import { CALL_DIRECTIONS, CALL_STATUSES, SENTIMENTS, type CallDirection, type CallStatus, type Sentiment } from "@/voice/types";

/** Query string of the calls list (also used by the CSV export). */
export interface CallQuery {
  agent?: string;
  dir?: string;
  status?: string;
  campaign?: string;
  sentiment?: string;
  booked?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: string;
}

/** Known analysis outcomes get a translated label (dash.call.outcome.*); others are shown as they are. */
export const KNOWN_OUTCOMES = ["booked", "transferred", "opt_out", "opted_out", "completed", "voicemail", "no_answer", "busy", "failed", "callback", "message_taken", "resolved", "escalated", "qualified", "not_interested"] as const;

export const CALL_QUERY_KEYS = ["agent", "dir", "status", "campaign", "sentiment", "booked", "from", "to", "q"] as const;

const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : "");
const id = (v: string | undefined) => (v && /^\d{1,10}$/.test(v) ? Number(v) : undefined);

/** The filter for listCalls() from the query string; a name search becomes the matching contacts. */
export async function callFilterFromQuery(workspaceId: number, query: CallQuery): Promise<{ filter: CallFilter; clean: Record<string, string>; none: boolean }> {
  const clean: Record<string, string> = {};
  const filter: CallFilter = {};
  const agentId = id(query.agent);
  if (agentId) {
    filter.agentId = agentId;
    clean.agent = String(agentId);
  }
  const campaignId = id(query.campaign);
  if (campaignId) {
    filter.campaignId = campaignId;
    clean.campaign = String(campaignId);
  }
  if ((CALL_DIRECTIONS as readonly string[]).includes(query.dir ?? "")) {
    filter.direction = query.dir as CallDirection;
    clean.dir = query.dir as string;
  }
  if ((CALL_STATUSES as readonly string[]).includes(query.status ?? "")) {
    filter.status = query.status as CallStatus;
    clean.status = query.status as string;
  }
  if ((SENTIMENTS as readonly string[]).includes(query.sentiment ?? "")) {
    filter.sentiment = query.sentiment as Sentiment;
    clean.sentiment = query.sentiment as string;
  }
  if (query.booked === "1") {
    filter.outcome = "booked";
    clean.booked = "1";
  }
  const from = day(query.from);
  const to = day(query.to);
  if (from) {
    filter.from = `${from}T00:00:00.000Z`;
    clean.from = from;
  }
  if (to) {
    filter.to = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
    clean.to = to;
  }
  const q = (query.q ?? "").trim().slice(0, 80);
  if (q) {
    clean.q = q;
    const digits = q.replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length >= 3) filter.phone = digits;
    const term = q.replace(/[%_\\]/g, "");
    const db = await getDb();
    const words = term.split(/\s+/).filter(Boolean).slice(0, 3);
    const contacts = words.length
      ? await db
          .selectFrom("contacts")
          .select("id")
          .where("workspace_id", "=", workspaceId)
          .where((eb) => eb.and(words.map((w) => eb.or([eb("first_name", "like", `%${w}%`), eb("last_name", "like", `%${w}%`), eb("company", "like", `%${w}%`), eb("email", "like", `%${w}%`)]))))
          .limit(500)
          .execute()
      : [];
    filter.orContactIds = contacts.map((c) => c.id);
    // Nothing can match: the caller shows an empty list instead of every call.
    if (!filter.phone && !filter.orContactIds.length) return { filter, clean, none: true };
  }
  return { filter, clean, none: false };
}

/** Names of the contacts of some calls. */
export async function contactNames(workspaceId: number, ids: Array<number | null>): Promise<Map<number, string>> {
  const clean = [...new Set(ids.filter((n): n is number => typeof n === "number" && n > 0))];
  if (!clean.length) return new Map();
  const db = await getDb();
  const rows = await db.selectFrom("contacts").select(["id", "first_name", "last_name", "company"]).where("workspace_id", "=", workspaceId).where("id", "in", clean).execute();
  return new Map(rows.map((r) => [r.id, [r.first_name, r.last_name].filter(Boolean).join(" ") || r.company]));
}
