import "server-only";
import { sql, type Transaction } from "kysely";
import { getAppSecret, sign } from "../crypto";
import { SIM_COST_PER_MIN_MICROS } from "@/lib/voice/sim-script";
import { billableSeconds, encodeCallTags, estimateReserveMicros, localDay, priceForSeconds, RESERVE_CAP_SEC, toMicros, zonedTimeToUtc } from "@/voice/normalize";
import type { BillingRounding, ToolCallRecord, TranscriptTurn } from "@/voice/types";
import { makePerson, PhonePool, bayArea } from "./demo-voice-people";
import { FRONT_DESK, FRONT_DESK_AFTER_HOURS, FRONT_DESK_WEB, LEAD, ORDERS_HI, PLUMBING, PROPERTY_AR, RECALL, recallOptOut, REMINDER, SPANISH, pickScenario, type Person, type Scenario, type Step } from "./demo-voice-scripts";
import { contactRows, DAY, dnc, HOUR, ID_TABLES, iso, MIN, monthName, renderGreeting, seedBrightline, seedHarbor, seedPinecrest, seedSharma, TABLES, type AgentDef, type ContactDef, type NumberDef, type People, type Row, type Rows, type Seed, type WsDef } from "./demo-voice-setup";
import type { Database } from "./schema";

/**
 * Voice demo data (DEMO_SEED), called from demo-seed.ts inside its transaction:
 *
 *   Brightline Dental (the admin's workspace, Los Angeles time): Front desk, Recall reminders and a
 *     Spanish line, Cal.com / CRM webhook / transfer tools, a knowledge base, two numbers, ~250
 *     patients with consent records, lists, DNC (registry scrub, complaint, two opt-outs captured
 *     on calls), three campaigns (completed, paused mid-way, draft), approved outbound access,
 *     credit packs, notification channels and an API key
 *   Harbor Realty (a customer, Dubai): an Arabic property line and an English lead follow-up agent,
 *     one number, ~120 leads, a completed campaign, plan minutes then wallet charges
 *   Sharma Electronics (Hindi order line, outbound request rejected) and Pinecrest Plumbing
 *     (after-hours line, outbound request pending)
 *
 * About 900 calls over 60 days (inbound, outbound, web test and widget) with transcripts, tool
 * calls, analysis, billing that follows the real rules (plan minutes first, then the wallet at the
 * sell price; provider cost at the simulated rate), the wallet ledger, monthly usage, the audit
 * log and the notification log. Everything is built in memory with explicit ids and written with
 * multi-row inserts (about 9,000 rows), so it fits one request on a remote database.
 *
 * DEMO_MODE coherence: every call is final and on the Simulated provider (provider_call_id
 * "sim_call_…" / "sim_web_…"), so the stuck-call sweeps, the idle web-call job and the nightly
 * reconciliation (which skips simulated calls) leave them alone, and recordings are absent so the
 * call page offers "Play simulated audio". No campaign is left running: the dialer only dials
 * running campaigns and demo visitors can't start or resume one, so nothing is ever dialed.
 */

export interface DemoVoiceOptions {
  adminId: number;
  /** Absolute site URL ("" when unknown): its host is allowed to embed the demo widget. */
  siteUrl: string;
  rand: () => number;
}

type CallKind = "answered" | "voicemail" | "no_answer" | "busy" | "failed";
type Status = "completed" | "voicemail" | "no_answer" | "busy" | "failed";

interface CallDraft {
  id: number;
  ws: WsDef;
  agent: AgentDef;
  direction: "inbound" | "outbound" | "web";
  number: NumberDef | null;
  contact: ContactDef | null;
  campaignId: number | null;
  ccId: number | null;
  from: string;
  to: string;
  queuedMs: number;
  startedMs: number | null;
  endedMs: number;
  status: Status;
  endReason: string;
  durationSec: number;
  transcript: TranscriptTurn[];
  toolCalls: ToolCallRecord[];
  summary: string | null;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  outcome: string;
  extracted: Record<string, unknown> | null;
  latency: number | null;
  disclosure: number | null;
  error: string | null;
  web: { source: "widget" | "test"; origin?: string } | null;
  providerCallId: string;
  billed: number;
  included: number;
  charge: number;
  reserve: number;
  cost: number;
}

interface Ledger {
  ms: number;
  seq: number;
  ws: WsDef;
  kind: "purchase" | "reserve" | "settle" | "release" | "adjustment" | "included";
  amount: number;
  callId: number | null;
  paymentId: number | null;
  seconds: number;
  note: string;
  createdBy: number | null;
  /** number_rentals row waiting for this ledger id. */
  rental?: Row<"number_rentals">;
}

interface Alert {
  ms: number;
  ws: WsDef;
  call: CallDraft | null;
  channel: number;
  event: string;
  ok: boolean;
  error?: string;
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isoWeekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
};
const atLocal = (tz: string, day: string, hour: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return zonedTimeToUtc({ year: y, month: m, day: d, hour: Math.floor(hour), minute: Math.round((hour % 1) * 60) }, tz);
};

interface Window {
  start: number;
  end: number;
  days: number[];
}

/** `ms` when inside the window (in `tz`), else the next opening. */
function nextInWindow(ms: number, tz: string, w: Window): number {
  let day = localDay(ms, tz);
  for (let i = 0; i < 14; i++, day = addDays(day, 1)) {
    if (!w.days.includes(isoWeekday(day))) continue;
    const open = atLocal(tz, day, w.start);
    const close = atLocal(tz, day, w.end);
    if (ms < open) return open;
    if (ms < close) return ms;
  }
  return ms;
}

/** The latest window opening at or before `ms`. */
function prevWindowOpen(ms: number, tz: string, w: Window): number {
  let day = localDay(ms, tz);
  for (let i = 0; i < 14; i++, day = addDays(day, -1)) {
    if (!w.days.includes(isoWeekday(day))) continue;
    const open = atLocal(tz, day, w.start);
    if (open <= ms) return open;
  }
  return ms;
}

export async function seedDemoVoice(trx: Transaction<Database>, options: DemoVoiceOptions): Promise<Record<string, number>> {
  const { adminId, rand: r } = options;
  const NOW = Date.now();
  const secret = await getAppSecret(trx);

  // ── Settings that decide prices ──
  const settingRows = await trx.selectFrom("settings").select(["key", "value"]).where("key", "in", ["voice_price_simulated", "billing_rounding", "billing_min_seconds", "number_monthly_price", "wallet_low_balance"]).execute();
  const setting = (key: string, fallback: string) => settingRows.find((x) => x.key === key)?.value ?? fallback;
  const price = Math.max(0, toMicros(setting("voice_price_simulated", "0.1"), 100_000));
  const rounding = ((["per_second", "per_6s", "per_minute"] as const).find((x) => x === setting("billing_rounding", "per_6s")) ?? "per_6s") as BillingRounding;
  const minSec = Math.max(0, Math.floor(Number(setting("billing_min_seconds", "0")) || 0));
  const lowBalance = Math.max(0, toMicros(setting("wallet_low_balance", "5"), 5_000_000));

  // ── Ids: explicit, continuing after whatever exists ──
  const nextId = {} as Record<(typeof ID_TABLES)[number], number>;
  for (const table of ID_TABLES) {
    const res = await sql<{ m: number | null }>`select max(id) as m from ${sql.table(table)}`.execute(trx);
    nextId[table] = Number(res.rows[0]?.m ?? 0) + 1;
  }
  const rows = Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Rows;
  const s: Seed = {
    r,
    NOW,
    adminId,
    secret,
    siteUrl: options.siteUrl,
    rentalMicros: Math.max(0, toMicros(setting("number_monthly_price", "3"), 3_000_000)),
    id: (table) => nextId[table]++,
    rows,
    audits: [],
    audit: (ws, actor, action, entityType, entityId, data, ms, ip = "") => s.audits.push({ ms, row: { workspace_id: ws, actor_type: actor.type, actor_id: actor.id ?? null, action, entity_type: entityType, entity_id: String(entityId), data: JSON.stringify(data), ip } }),
    chance: (p) => r() < p,
    pick: (list) => list[Math.floor(r() * list.length) % list.length],
    between: (a, b) => a + r() * (b - a),
    token: (n) => Array.from({ length: n }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(r() * 64)]).join(""),
  };

  // ── People: the admin owns Brightline; three paying sample users become customers ──
  const plans = await trx.selectFrom("plans").select(["id", "included_minutes_monthly", "is_free"]).execute();
  const included = (planId: number | null) => Number(plans.find((p) => p.id === planId)?.included_minutes_monthly ?? 10);
  const sample = await trx.selectFrom("users").select(["id", "plan_id", "plan_expires_at"]).where("role", "=", "user").where("status", "=", "active").orderBy("id").execute();
  const nowIso = iso(NOW);
  const paid = sample.filter((u) => u.plan_id && u.plan_expires_at && u.plan_expires_at > nowIso);
  // Harbor on the plan with the fewest included minutes, so the wallet pays the rest.
  const byMinutes = [...paid].sort((a, b) => included(a.plan_id) - included(b.plan_id) || a.id - b.id);
  const harborUser = byMinutes[0] ?? null;
  const others = paid.filter((u) => u.id !== harborUser?.id);
  const team = sample.filter((u) => !u.plan_id).map((u) => u.id);
  const adminPersonal = await trx.selectFrom("workspaces").select("id").where("owner_id", "=", adminId).where("is_personal", "=", 1).executeTakeFirst();
  const customerPersonal = async (id: number) => Boolean(await trx.selectFrom("workspaces").select("id").where("owner_id", "=", id).executeTakeFirst());
  const people: People = {
    admin: { id: adminId, name: "Admin" },
    harbor: harborUser && !(await customerPersonal(harborUser.id)) ? { id: harborUser.id, includedMin: included(harborUser.plan_id) } : null,
    sharma: others[0] && !(await customerPersonal(others[0].id)) ? { id: others[0].id, includedMin: included(others[0].plan_id) } : null,
    pinecrest: others[1] && !(await customerPersonal(others[1].id)) ? { id: others[1].id, includedMin: included(others[1].plan_id) } : null,
    team,
    adminHasPersonal: Boolean(adminPersonal),
  };

  const bright = seedBrightline(s, people);
  const harbor = people.harbor ? seedHarbor(s, people.harbor) : null;
  const sharma = people.sharma ? seedSharma(s, people.sharma) : null;
  const pine = people.pinecrest ? seedPinecrest(s, people.pinecrest) : null;
  const spaces = [bright, harbor, sharma, pine].filter((w): w is WsDef => w !== null);

  // The customers' accounts get names and dates that match their business.
  const renames: Array<[WsDef | null, string, string]> = [
    [harbor, "Omar Haddad", "omar@harborrealty.example"],
    [sharma, "Vikram Sharma", "vikram@sharmaelectronics.example"],
    [pine, "Megan Kowalski", "megan@pinecrestplumbing.example"],
  ];
  for (const [ws, name, email] of renames) {
    if (!ws) continue;
    const taken = await trx.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
    await trx
      .updateTable("users")
      .set({ name, ...(taken ? {} : { email }), created_at: iso(ws.createdMs - 2 * HOUR), updated_at: iso(ws.createdMs - 2 * HOUR) })
      .where("id", "=", ws.ownerId)
      .execute();
  }
  await trx.updateTable("users").set({ created_at: iso(bright.createdMs - 3 * DAY) }).where("id", "=", adminId).execute();

  // ── Calls ──
  const calls: CallDraft[] = [];
  const callIds = new Set<string>();
  const providerId = (prefix: string) => {
    for (;;) {
      const id = `${prefix}_${s.token(12)}`;
      if (!callIds.has(id)) {
        callIds.add(id);
        return id;
      }
    }
  };
  const optOuts: Array<{ call: CallDraft; contact: ContactDef }> = [];

  /** The transcript, tool calls and duration of a script, timed like a real conversation. */
  const play = (steps: Step[], pace: number) => {
    const turns: TranscriptTurn[] = [];
    const tools: ToolCallRecord[] = [];
    let t = 0.4 + r() * 0.6;
    for (const step of steps) {
      if (step[0] === "p") {
        t += step[1] * (0.8 + r() * 0.6);
      } else if (step[0] === "t") {
        const ms = 320 + Math.floor(r() * 1200);
        const tool = step[1];
        turns.push({ role: "tool", text: `${tool.name}: ${String(tool.result.message ?? "Done.")}`, at: Math.round(t * 10) / 10 });
        tools.push({ name: tool.name, args: tool.args, result: JSON.stringify(tool.result), ok: tool.ok ?? true, at: Math.round(t), durationMs: ms });
        t += ms / 1000 + 0.4;
      } else {
        const agentLine = step[0] === "a";
        turns.push({ role: agentLine ? "agent" : "caller", text: step[1], at: Math.round(t * 10) / 10 });
        t += (step[1].length / (agentLine ? 12.5 : 10.5)) * pace + 0.8 + r() * 1.8 * pace;
      }
    }
    return { turns, tools, duration: Math.max(4, Math.round(t + 1 + r() * 2)) };
  };

  const business = (ws: WsDef) => ws.name;

  function addCall(p: {
    ws: WsDef;
    agent: AgentDef;
    direction: "inbound" | "outbound" | "web";
    number: NumberDef | null;
    contact: ContactDef | null;
    person: Person;
    at: number;
    kind: CallKind;
    scenario?: Scenario;
    web?: CallDraft["web"];
    campaignId?: number | null;
    ccId?: number | null;
    appointment?: number | null;
  }): CallDraft {
    const { ws, agent, direction } = p;
    const outbound = direction === "outbound";
    const call: CallDraft = {
      id: 0,
      ws,
      agent,
      direction,
      number: p.number,
      contact: p.contact,
      campaignId: p.campaignId ?? null,
      ccId: p.ccId ?? null,
      from: direction === "inbound" ? p.person.phone : outbound ? (p.number?.e164 ?? "") : "",
      to: direction === "inbound" ? (p.number?.e164 ?? "") : outbound ? p.person.phone : "",
      queuedMs: p.at,
      startedMs: null,
      endedMs: p.at,
      status: "completed",
      endReason: "unknown",
      durationSec: 0,
      transcript: [],
      toolCalls: [],
      summary: null,
      sentiment: "unknown",
      outcome: "completed",
      extracted: null,
      latency: null,
      disclosure: null,
      error: null,
      web: p.web ?? null,
      providerCallId: providerId(direction === "web" ? "sim_web" : "sim_call"),
      billed: 0,
      included: 0,
      charge: 0,
      reserve: 0,
      cost: 0,
    };
    if (p.kind === "answered") {
      const started = p.at + (outbound ? 6_000 + r() * 16_000 : 800 + r() * 2_200);
      const greeting = renderGreeting(agent.firstMessage, outbound ? p.person.first : null, business(ws));
      const script = (p.scenario ?? FRONT_DESK[0][0])({ r, person: p.person, tz: ws.tz, greeting, at: started, hours: ws.hours, tools: agent.tools, appointment: p.appointment ?? null });
      const pace = r() < 0.12 ? 2.2 + r() * 0.8 : 1.3 + r() * 0.8;
      const played = play(script.steps, pace);
      Object.assign(call, {
        startedMs: Math.round(started),
        durationSec: played.duration,
        endedMs: Math.round(started) + played.duration * 1000,
        transcript: played.turns,
        toolCalls: played.tools,
        status: "completed",
        endReason: script.endReason,
        outcome: script.outcome,
        sentiment: script.sentiment,
        summary: script.summary,
        extracted: script.extracted,
        latency: direction === "web" ? null : 520 + Math.floor(r() * 430),
        disclosure: 1,
      });
      if (script.outcome === "opted_out" && p.contact) optOuts.push({ call, contact: p.contact });
    } else if (p.kind === "voicemail") {
      const started = p.at + 18_000 + r() * 10_000;
      const vm = agent.voicemailMessage ? renderGreeting(agent.voicemailMessage, p.person.first, business(ws)) : "";
      const duration = vm ? Math.round(0.8 + (vm.length / 14) * 1.1 + 2) : 6;
      Object.assign(call, { startedMs: Math.round(started), durationSec: duration, endedMs: Math.round(started) + duration * 1000, transcript: vm ? [{ role: "agent", text: vm, at: 0.8 }] : [], status: "voicemail", endReason: "voicemail", outcome: "voicemail", latency: 520 + Math.floor(r() * 430), disclosure: 0 });
    } else {
      const ring = p.kind === "busy" ? 3_000 : p.kind === "failed" ? 2_000 : 25_000;
      Object.assign(call, { endedMs: p.at + ring, status: p.kind, endReason: p.kind === "failed" ? "error" : p.kind, outcome: p.kind, error: p.kind === "failed" ? "The carrier rejected the call (simulated)." : null });
    }
    calls.push(call);
    return call;
  }

  const unansweredKind = (): CallKind => {
    const x = r();
    return x < 0.5 ? "no_answer" : x < 0.82 ? "voicemail" : x < 0.94 ? "busy" : "failed";
  };

  // ── Inbound and web traffic: business-hour seasonality and growth over 60 days ──
  interface Stream {
    ws: WsDef;
    agent: AgentDef | undefined;
    number: NumberDef | null;
    web?: CallDraft["web"];
    bank: ReadonlyArray<[Scenario, number]>;
    afterHours?: ReadonlyArray<[Scenario, number]>;
    base: number;
    fromDay: number;
    hours: number[];
    days: Record<number, number>;
    known: ContactDef[];
    knownShare: number;
    set: Parameters<typeof makePerson>[1];
    pool: PhonePool;
  }
  const HOURS_OFFICE = [0.02, 0.01, 0.01, 0.01, 0.02, 0.04, 0.12, 0.35, 1.2, 1.6, 1.7, 1.5, 1.0, 1.2, 1.5, 1.4, 1.2, 0.9, 0.5, 0.3, 0.25, 0.15, 0.08, 0.04];
  const HOURS_EVENING = [0.25, 0.18, 0.12, 0.08, 0.06, 0.1, 0.3, 0.4, 0.2, 0.1, 0.1, 0.1, 0.12, 0.12, 0.12, 0.15, 0.4, 0.9, 1.3, 1.4, 1.3, 1.1, 0.8, 0.45];
  const HOURS_RETAIL = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.6, 1.2, 1.4, 1.3, 1.1, 1.0, 1.1, 1.2, 1.3, 1.2, 1.0, 0.6, 0.3, 0.1, 0.02];
  const pickHour = (weights: number[]) => {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let h = 0; h < 24; h++) {
      x -= weights[h];
      if (x < 0) return h;
    }
    return 12;
  };

  function runStream(st: Stream): void {
    if (!st.agent) return;
    const today = localDay(NOW, st.ws.tz);
    const agentRow = rows.agents.find((a) => a.id === st.agent!.id)!;
    const agentStart = Date.parse(String(agentRow.created_at));
    for (let d = st.fromDay; d >= 0; d--) {
      const day = addDays(today, -d);
      const wd = isoWeekday(day);
      const growth = 0.45 + 0.55 * (1 - d / 59);
      const expected = st.base * growth * (st.days[wd] ?? 1);
      let n = Math.floor(expected + r());
      if (d === 0 && st === streams[0]) n = Math.max(n, 3);
      for (let i = 0; i < n; i++) {
        const hour = pickHour(st.hours);
        let at = atLocal(st.ws.tz, day, hour + r() * 0.98);
        if (d === 0 && at > NOW - 3 * MIN) {
          if (st !== streams[0] || i >= 3) continue;
          at = NOW - (12 + Math.floor(r() * 160)) * MIN;
        }
        if (at < agentStart + HOUR) continue;
        const open = st.ws.hours[isoWeekday(localDay(at, st.ws.tz))];
        const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: st.ws.tz, hour: "numeric", hourCycle: "h23" }).format(at));
        const afterHours = !open || localHour < open[0] || localHour >= open[1];
        const known = st.known.length && r() < st.knownShare ? st.known[Math.floor(r() * st.known.length)] : null;
        const person = known ? known.person : makePerson(r, st.set, st.web ? "" : st.pool.take());
        const bank = afterHours && st.afterHours ? st.afterHours : st.bank;
        addCall({ ws: st.ws, agent: st.agent, direction: st.web ? "web" : "inbound", number: st.web ? null : st.number, contact: st.web ? null : known, person, at, kind: "answered", scenario: pickScenario(r, bank), web: st.web });
      }
    }
  }

  const officeDays = { 1: 1.25, 2: 1.1, 3: 1.05, 4: 1.0, 5: 0.95, 6: 0.55, 7: 0.18 };
  const brightUnknown = new PhonePool(r, bayArea);
  for (const c of bright.contacts) brightUnknown.reserve(c.phone);
  const streams: Stream[] = [
    { ws: bright, agent: bright.agents.frontDesk, number: bright.numbers.main, bank: FRONT_DESK, afterHours: FRONT_DESK_AFTER_HOURS, base: 7.0, fromDay: 59, hours: HOURS_OFFICE, days: officeDays, known: bright.contacts.filter((c) => c.language === "en"), knownShare: 0.55, set: "en", pool: brightUnknown },
    { ws: bright, agent: bright.agents.spanish, number: bright.numbers.spanish, bank: SPANISH, base: 1.2, fromDay: 52, hours: HOURS_OFFICE, days: officeDays, known: bright.contacts.filter((c) => c.language === "es"), knownShare: 0.6, set: "es", pool: brightUnknown },
    { ws: bright, agent: bright.agents.frontDesk, number: null, web: { source: "widget", origin: "https://www.brightlinedental.example" }, bank: FRONT_DESK_WEB, base: 0.75, fromDay: 40, hours: HOURS_EVENING.map((v, h) => v + HOURS_OFFICE[h] * 0.6), days: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1.2, 7: 1.3 }, known: [], knownShare: 0, set: "en", pool: brightUnknown },
  ];
  if (harbor) {
    streams.push(
      { ws: harbor, agent: harbor.agents.property, number: harbor.numbers.main, bank: PROPERTY_AR, base: 3.0, fromDay: 48, hours: [0, 0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.9, 1.3, 1.4, 1.2, 1.0, 1.0, 1.2, 1.3, 1.3, 1.1, 0.9, 0.7, 0.4, 0.1, 0], days: { 1: 1.1, 2: 1.1, 3: 1.0, 4: 1.0, 5: 0.9, 6: 1.2, 7: 0.7 }, known: harbor.contacts.filter((c) => c.language === "ar"), knownShare: 0.35, set: "ar", pool: harbor.pool },
      { ws: harbor, agent: harbor.agents.property, number: null, web: { source: "widget", origin: "https://harborrealty.example" }, bank: PROPERTY_AR, base: 0.3, fromDay: 30, hours: HOURS_EVENING, days: {}, known: [], knownShare: 0, set: "ar", pool: harbor.pool },
    );
  }
  if (sharma) streams.push({ ws: sharma, agent: sharma.agents.orders, number: sharma.numbers.main, bank: ORDERS_HI, base: 1.5, fromDay: 26, hours: HOURS_RETAIL, days: { 7: 0.5 }, known: sharma.contacts, knownShare: 0.5, set: "hi", pool: sharma.pool });
  if (pine) streams.push({ ws: pine, agent: pine.agents.afterHours, number: pine.numbers.main, bank: PLUMBING, base: 1.6, fromDay: 19, hours: HOURS_EVENING, days: { 6: 1.6, 7: 1.8 }, known: pine.contacts, knownShare: 0.4, set: "en", pool: pine.pool });
  for (const st of streams) runStream(st);

  // Browser test calls while the agents were being built and tuned.
  const tests: Array<[WsDef | null, AgentDef | undefined, ReadonlyArray<[Scenario, number]>, number[]]> = [
    [bright, bright.agents.frontDesk, FRONT_DESK_WEB, [61.8, 61.75, 61.7, 61.2, 60.9, 47.3, 30.2, 30.15, 12.4]],
    [bright, bright.agents.recall, RECALL, [61.6, 61.55, 20.1]],
    [bright, bright.agents.spanish, SPANISH, [52.7, 52.65]],
    [harbor, harbor?.agents.property, PROPERTY_AR, [49.8, 49.75, 38.4]],
    [harbor, harbor?.agents.lead, LEAD, [39.6, 13.2]],
    [sharma, sharma?.agents.orders, ORDERS_HI, [27.8, 27.75]],
    [pine, pine?.agents.afterHours, PLUMBING, [20.7]],
  ];
  for (const [ws, agentDef, bank, daysAgo] of tests) {
    if (!ws || !agentDef) continue;
    for (const d of daysAgo) {
      const person = makePerson(r, ws.nameSet === "hi" ? "hi" : ws.nameSet === "ar" ? "ar" : agentDef.language.startsWith("es") ? "es" : "en", "");
      addCall({ ws, agent: agentDef, direction: "web", number: null, contact: null, person, at: NOW - d * DAY, kind: "answered", scenario: pickScenario(r, bank), web: { source: "test" } });
    }
  }

  // ── Campaigns ──
  interface CampaignSpec {
    ws: WsDef;
    agent: AgentDef;
    number: NumberDef;
    name: string;
    listKey: string;
    purpose: "informational" | "telemarketing";
    createdMs: number;
    startMs: number;
    stopMs: number;
    window: Window;
    maxAttempts: number;
    retryOn: string[];
    delays: Record<string, number>;
    concurrency: number;
    dailyCap: number;
    gapSec: [number, number];
    answerP: number;
    bank: ReadonlyArray<[Scenario, number]>;
    forcedOptOut: ContactDef | null;
    blocked: (c: ContactDef) => string | null;
    appointment?: (c: ContactDef) => number | null;
    variables: Record<string, string>;
  }
  interface CcState {
    id: number;
    contact: ContactDef;
    state: "pending" | "retry" | "completed" | "failed" | "skipped";
    attempts: number;
    next: number | null;
    lastCall: CallDraft | null;
    lastOutcome: string | null;
    skip: string | null;
    updatedMs: number;
  }

  function runCampaign(c: CampaignSpec, status: "completed" | "paused" | "draft"): { id: number; endMs: number; rows: CcState[] } {
    const id = s.id("campaigns");
    const members = c.ws.lists[c.listKey]?.members ?? [];
    const states: CcState[] = status === "draft" ? [] : members.map((contact) => ({ id: s.id("campaign_contacts"), contact, state: "pending", attempts: 0, next: null, lastCall: null, lastOutcome: null, skip: null, updatedMs: c.startMs }));
    const queue = states.map((row, i) => ({ row, due: c.startMs + i }));
    let last = c.startMs - 60_000;
    const perDay = new Map<string, number>();
    let endMs = c.startMs;
    while (queue.length && status !== "draft") {
      queue.sort((a, b) => a.due - b.due);
      const item = queue.shift()!;
      const row = item.row;
      const tz = row.contact.tz || c.ws.tz;
      let t = Math.max(item.due, last + (c.gapSec[0] + r() * (c.gapSec[1] - c.gapSec[0])) * 1000);
      const moved = nextInWindow(t, tz, c.window);
      if (moved !== t) t = moved + Math.floor(r() * 25) * MIN;
      for (let i = 0; i < 10 && (perDay.get(localDay(t, c.ws.tz)) ?? 0) >= c.dailyCap; i++) t = nextInWindow(atLocal(c.ws.tz, addDays(localDay(t, c.ws.tz), 1), 0), tz, c.window) + Math.floor(r() * 20) * MIN;
      if (t > c.stopMs) {
        row.state = row.attempts ? "retry" : "pending";
        row.next = row.attempts ? (item.due > NOW ? item.due : nextInWindow(NOW + 2 * HOUR, tz, c.window)) : null;
        continue;
      }
      const reason = row.attempts === 0 ? c.blocked(row.contact) : null;
      if (reason) {
        Object.assign(row, { state: "skipped", lastOutcome: "blocked", skip: reason, updatedMs: t });
        s.audit(c.ws.id, { type: "system", id: null }, "call.blocked", "phone", row.contact.phone, { reasons: reason.split(","), campaignId: id, contactId: row.contact.id }, t);
        last = t - 50_000;
        continue;
      }
      const forced = row.contact === c.forcedOptOut && row.attempts === 0;
      const kind: CallKind = forced || r() < c.answerP ? "answered" : unansweredKind();
      row.attempts += 1;
      const call = addCall({ ws: c.ws, agent: c.agent, direction: "outbound", number: c.number, contact: row.contact, person: row.contact.person, at: t, kind, scenario: forced ? recallOptOut : pickScenario(r, c.bank), campaignId: id, ccId: row.id, appointment: c.appointment?.(row.contact) ?? null });
      s.audit(c.ws.id, { type: "system", id: null }, "call.dialed", "call", 0, { to: row.contact.phone, from: c.number.e164, agentId: c.agent.id, campaignId: id, provider: "simulated" }, t);
      (s.audits[s.audits.length - 1] as { call?: CallDraft }).call = call;
      row.contact.callsCount += 1;
      row.contact.lastCalledMs = t;
      last = t;
      perDay.set(localDay(t, c.ws.tz), (perDay.get(localDay(t, c.ws.tz)) ?? 0) + 1);
      row.lastCall = call;
      row.updatedMs = call.endedMs + 2_000;
      endMs = Math.max(endMs, call.endedMs);
      const outcome = call.outcome === "opted_out" ? "opt_out" : call.status;
      row.lastOutcome = outcome;
      if (call.status === "completed") row.state = "completed";
      else if (c.retryOn.includes(call.status) && row.attempts < c.maxAttempts) {
        row.state = "retry";
        const due = call.endedMs + (c.delays[call.status] ?? 240) * MIN;
        row.next = due;
        queue.push({ row, due });
      } else row.state = "failed";
    }
    const completedMs = endMs + 40_000;
    const pausedMs = status === "paused" ? c.stopMs : null;
    rows.campaigns.push({
      id,
      workspace_id: c.ws.id,
      name: c.name,
      agent_id: c.agent.id,
      number_id: c.number.id,
      list_id: c.ws.lists[c.listKey]?.id ?? null,
      purpose: c.purpose,
      status,
      starts_at: null,
      ends_at: null,
      calling_window: JSON.stringify({ start: `${String(c.window.start).padStart(2, "0")}:00`, end: `${String(c.window.end).padStart(2, "0")}:00`, days: c.window.days }),
      timezone_mode: "contact",
      timezone: c.ws.tz,
      max_attempts: c.maxAttempts,
      retry_delay_min: c.delays.no_answer ?? 240,
      retry_on: JSON.stringify(c.retryOn),
      concurrency: c.concurrency,
      daily_cap: c.dailyCap,
      variables: JSON.stringify(c.variables),
      stats: JSON.stringify(status === "draft" ? {} : { waiting: null, checkedAt: iso(pausedMs ?? completedMs) }),
      number_ids: JSON.stringify([c.number.id]),
      list_ids: JSON.stringify(c.ws.lists[c.listKey] ? [c.ws.lists[c.listKey].id] : []),
      retry_delays: JSON.stringify({ no_answer: c.delays.no_answer ?? 240, busy: c.delays.busy ?? 30, voicemail: c.delays.voicemail ?? 1440, failed: c.delays.failed ?? 60 }),
      abandon_max_pct: 3,
      paused_reason: null,
      created_by: c.ws.ownerId,
      created_at: iso(c.createdMs),
      updated_at: iso(pausedMs ?? (status === "completed" ? completedMs : c.createdMs)),
      completed_at: status === "completed" ? iso(completedMs) : null,
    });
    const actor = { type: "user" as const, id: c.ws.ownerId };
    s.audit(c.ws.id, actor, "campaign.created", "campaign", id, { name: c.name, purpose: c.purpose }, c.createdMs);
    if (status !== "draft") s.audit(c.ws.id, actor, "campaign.started", "campaign", id, { contacts: states.length, purpose: c.purpose, status: "running" }, c.startMs - 2 * MIN);
    if (status === "completed") {
      const by: Record<string, number> = {};
      for (const st of states) by[st.state] = (by[st.state] ?? 0) + 1;
      s.audit(c.ws.id, { type: "system", id: null }, "campaign.completed", "campaign", id, by, completedMs);
      for (const ch of [c.ws.channels.email, c.ws.channels.webhook]) if (ch) alerts.push({ ms: completedMs + 1_000, ws: c.ws, call: null, channel: ch, event: "campaign_finished", ok: true });
    }
    if (status === "paused") s.audit(c.ws.id, actor, "campaign.paused", "campaign", id, {}, c.stopMs);
    for (const st of states) {
      rows.campaign_contacts.push({
        id: st.id,
        campaign_id: id,
        workspace_id: c.ws.id,
        contact_id: st.contact.id,
        phone_e164: st.contact.phone,
        state: st.state,
        attempts: st.attempts,
        next_attempt_at: st.state === "retry" && st.next ? iso(st.next) : null,
        lease_token: null,
        lease_until: null,
        last_call_id: null,
        last_outcome: st.lastOutcome,
        skip_reason: st.skip,
        created_at: iso(c.startMs - 2 * MIN),
        updated_at: iso(st.updatedMs),
      });
      (rows.campaign_contacts[rows.campaign_contacts.length - 1] as { call?: CallDraft | null }).call = st.lastCall;
    }
    return { id, endMs, rows: states };
  }

  const alerts: Alert[] = [];
  const OFFICE: Window = { start: 9, end: 18, days: [1, 2, 3, 4, 5] };
  const due = bright.lists.due.members;
  const nov = bright.lists.nov.members;
  const scrubbed = due[23];
  const octOptOut = due.find((c, i) => i > 12 && c.hasConsent && c !== scrubbed) ?? null;
  const octStart = prevWindowOpen(NOW - 18 * DAY, bright.tz, OFFICE) + 5 * MIN;
  runCampaign(
    {
      ws: bright,
      agent: bright.agents.recall,
      number: bright.numbers.main,
      name: `${monthName(octStart)} recall`,
      listKey: "due",
      purpose: "informational",
      createdMs: octStart - 2 * DAY - 3 * HOUR,
      startMs: octStart,
      stopMs: Infinity,
      window: OFFICE,
      maxAttempts: 3,
      retryOn: ["no_answer", "busy", "voicemail"],
      delays: { no_answer: 240, busy: 30, voicemail: 1440, failed: 60 },
      concurrency: 3,
      dailyCap: 35,
      gapSec: [420, 900],
      answerP: 0.56,
      bank: RECALL,
      forcedOptOut: octOptOut,
      blocked: (c) => (c === scrubbed ? "dnc_workspace" : !c.hasConsent ? "no_consent" : null),
      variables: { clinic_phone: "(415) 555-0100" },
    },
    "completed",
  );
  const novOptOut = nov.find((c, i) => i > 4 && c.hasConsent && c !== octOptOut && c !== scrubbed) ?? null;
  const novStart = prevWindowOpen(NOW - 30 * HOUR, bright.tz, OFFICE) + 35 * MIN;
  const novPause = Math.min(NOW - 2 * HOUR, nextInWindow(novStart + 22 * HOUR, bright.tz, OFFICE) + 3 * HOUR);
  const appointments = new Map<number, number>();
  for (const c of nov) {
    const day = addDays(localDay(NOW, bright.tz), 12 + Math.floor(r() * 16));
    const wd = isoWeekday(day);
    const open = bright.hours[wd] ?? [9, 16];
    const at = atLocal(bright.tz, day, open[0] + Math.floor(r() * (open[1] - open[0] - 1) * 2) / 2);
    appointments.set(c.id, at);
    c.fields.appointment_time = new Intl.DateTimeFormat("en-US", { timeZone: bright.tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
    c.fields.appointment_at = iso(at);
  }
  runCampaign(
    {
      ws: bright,
      agent: bright.agents.recall,
      number: bright.numbers.main,
      name: `${monthName(NOW + 15 * DAY)} reminders`,
      listKey: "nov",
      purpose: "informational",
      createdMs: NOW - 4 * DAY - 2 * HOUR,
      startMs: novStart,
      stopMs: novPause,
      window: OFFICE,
      maxAttempts: 2,
      retryOn: ["no_answer", "busy", "voicemail"],
      delays: { no_answer: 240, busy: 30, voicemail: 1440, failed: 60 },
      concurrency: 2,
      dailyCap: 30,
      gapSec: [600, 1100],
      answerP: 0.6,
      bank: REMINDER,
      forcedOptOut: novOptOut,
      blocked: (c) => (c === octOptOut ? "opted_out,dnc_workspace" : c === scrubbed ? "dnc_workspace" : !c.hasConsent ? "no_consent" : null),
      appointment: (c) => appointments.get(c.id) ?? null,
      variables: { clinic_phone: "(415) 555-0100" },
    },
    "paused",
  );
  runCampaign(
    { ws: bright, agent: bright.agents.recall, number: bright.numbers.main, name: "Re-engagement", listKey: "lapsed", purpose: "telemarketing", createdMs: NOW - 26 * HOUR, startMs: NOW, stopMs: NOW, window: { start: 10, end: 18, days: [2, 3, 4] }, maxAttempts: 2, retryOn: ["no_answer"], delays: { no_answer: 1440 }, concurrency: 2, dailyCap: 40, gapSec: [60, 120], answerP: 0.5, bank: RECALL, forcedOptOut: null, blocked: () => null, variables: { offer: "Free whitening touch-up with your next cleaning" } },
    "draft",
  );
  if (harbor) {
    const hStart = prevWindowOpen(NOW - 12 * DAY, harbor.tz, { start: 10, end: 19, days: [1, 2, 3, 4, 5, 6] }) + 20 * MIN;
    runCampaign(
      {
        ws: harbor,
        agent: harbor.agents.lead,
        number: harbor.numbers.main,
        name: "Marina Heights launch leads",
        listKey: "launch",
        purpose: "telemarketing",
        createdMs: hStart - DAY - 4 * HOUR,
        startMs: hStart,
        stopMs: Infinity,
        window: { start: 10, end: 19, days: [1, 2, 3, 4, 5, 6] },
        maxAttempts: 2,
        retryOn: ["no_answer", "busy"],
        delays: { no_answer: 300, busy: 45 },
        concurrency: 2,
        dailyCap: 30,
        gapSec: [600, 1100],
        answerP: 0.52,
        bank: LEAD,
        forcedOptOut: null,
        blocked: () => null,
        variables: { project: "Marina Heights" },
      },
      "completed",
    );
  }

  // ── Ids in time order, opt-outs, billing ──
  calls.sort((a, b) => a.queuedMs - b.queuedMs);
  for (const c of calls) c.id = s.id("calls");

  for (const { call, contact } of optOuts) {
    const ms = call.endedMs + 4_000;
    contact.optedOutMs = ms;
    let revoked = 0;
    for (const cid of contact.consentIds) {
      const row = rows.consents.find((x) => x.id === cid);
      if (row && !row.revoked_at && row.type !== "recording") {
        row.revoked_at = iso(ms);
        row.revoked_reason = `opt_out: call:${call.id}`;
        revoked++;
      }
    }
    dnc(s, call.ws, { phone: contact.phone, reason: "opt_out", source: `call:${call.id}`, createdMs: ms, by: null });
    s.audit(call.ws.id, { type: "provider", id: null }, "dnc.added", "dnc", contact.phone, { scope: "workspace", reason: "opt_out", source: `call:${call.id}` }, ms);
    s.audit(call.ws.id, { type: "provider", id: null }, "opt_out.recorded", "contact", contact.phone, { source: `call:${call.id}`, revoked, callId: call.id, phrase: "take me off your list", lang: "en", flagged: true }, ms + 50);
    for (const ch of [call.ws.channels.email, call.ws.channels.webhook]) if (ch) alerts.push({ ms: ms + 900, ws: call.ws, call, channel: ch, event: "opt_out", ok: true });
  }

  const ledger: Ledger[] = [];
  let seq = 0;
  const usage = new Map<string, { owner: number; month: string; sec: number; calls: number; capSec: number; warnMs: number | null; reachedMs: number | null; ws: WsDef }>();
  for (const call of calls) {
    const ws = call.ws;
    const month = iso(call.endedMs).slice(0, 7);
    const key = `${ws.ownerId}|${month}`;
    const cap = ws.includedMin < 0 ? Infinity : ws.includedMin * 60;
    if (!usage.has(key)) usage.set(key, { owner: ws.ownerId, month, sec: 0, calls: 0, capSec: cap, warnMs: null, reachedMs: null, ws });
    const u = usage.get(key)!;
    const left = Math.max(0, cap - u.sec);
    const reserveSec = Math.min(call.agent.maxDurationSec, RESERVE_CAP_SEC);
    if (call.direction === "outbound" && left < reserveSec) call.reserve = estimateReserveMicros(call.agent.maxDurationSec, price);
    if (call.direction === "web" && reserveSec - left > 0) call.reserve = estimateReserveMicros(reserveSec - left, price);
    call.billed = billableSeconds(call.durationSec, rounding, call.durationSec > 0 ? minSec : 0);
    call.included = Math.min(call.billed, left);
    call.charge = priceForSeconds(call.billed - call.included, price);
    call.cost = call.status === "completed" || call.status === "voicemail" ? Math.ceil((call.durationSec * SIM_COST_PER_MIN_MICROS) / 60) : 0;
    u.sec += call.included;
    u.calls += 1;
    if (Number.isFinite(cap)) {
      if (!u.warnMs && u.sec >= cap * 0.8 && u.sec < cap) u.warnMs = call.endedMs;
      if (!u.reachedMs && u.sec >= cap) u.reachedMs = call.endedMs;
    }
    if (call.reserve) ledger.push({ ms: call.queuedMs, seq: seq++, ws, kind: "reserve", amount: -call.reserve, callId: call.id, paymentId: null, seconds: 0, note: "", createdBy: null });
    if (call.included) ledger.push({ ms: call.endedMs, seq: seq++, ws, kind: "included", amount: 0, callId: call.id, paymentId: null, seconds: call.included, note: "Plan minutes", createdBy: null });
    if (call.reserve) ledger.push({ ms: call.endedMs, seq: seq++, ws, kind: "release", amount: call.reserve, callId: call.id, paymentId: null, seconds: 0, note: "", createdBy: null });
    ledger.push({ ms: call.endedMs, seq: seq++, ws, kind: "settle", amount: -call.charge, callId: call.id, paymentId: null, seconds: call.billed - call.included, note: "", createdBy: null });
  }

  // Credit packs (paid payments) and the monthly number rentals.
  const packs: Array<[WsDef | null, number, number, "stripe" | "paypal" | "razorpay" | "offline"]> = [
    [bright, bright.createdMs + 2 * DAY + 3 * HOUR, 5_000, "stripe"],
    [bright, NOW - 20 * DAY - 5 * HOUR, 10_000, "stripe"],
    [harbor, (harbor?.createdMs ?? 0) + 22 * HOUR, 2_500, "stripe"],
    [harbor, NOW - 17 * DAY - 2 * HOUR, 5_000, "paypal"],
    [sharma, (sharma?.createdMs ?? 0) + 2 * HOUR, 2_500, "razorpay"],
    [pine, (pine?.createdMs ?? 0) + 2 * HOUR, 2_500, "offline"],
  ];
  for (const [ws, ms, cents, provider] of packs) {
    if (!ws) continue;
    const pid = s.id("payments");
    rows.payments.push({ id: pid, user_id: ws.ownerId, plan_id: 0, purpose: "credits", workspace_id: ws.id, credits_micros: cents * 10_000, amount: cents, currency: "USD", billing_cycle: "monthly", provider, provider_ref: `demo:credits:${pid}`, status: "paid", note: provider === "offline" ? "Wire ref. PCP-2291" : null, created_at: iso(ms) });
    ledger.push({ ms: ms + 4_000, seq: seq++, ws, kind: "purchase", amount: cents * 10_000, callId: null, paymentId: pid, seconds: 0, note: `Credit pack (${provider})`, createdBy: ws.ownerId });
    s.audit(ws.id, { type: "user", id: ws.ownerId }, "credits.purchased", "payment", pid, { micros: cents * 10_000, provider }, ms + 4_100);
  }
  for (const ws of spaces) {
    for (const n of Object.values(ws.numbers)) {
      if (n.monthlyMicros <= 0) continue;
      let month = iso(n.createdMs).slice(0, 7);
      const current = iso(NOW).slice(0, 7);
      for (let first = true; month <= current; first = false) {
        const [y, m] = month.split("-").map(Number);
        const ms = first ? n.createdMs + MIN : Date.UTC(y, m - 1, 1, 0, 7 + Math.floor(r() * 40));
        const rental: Row<"number_rentals"> = { id: s.id("number_rentals"), workspace_id: ws.id, number_id: n.id, month, amount_micros: n.monthlyMicros, transaction_id: null, created_at: iso(ms) };
        rows.number_rentals.push(rental);
        ledger.push({ ms, seq: seq++, ws, kind: "adjustment", amount: -n.monthlyMicros, callId: null, paymentId: null, seconds: 0, note: `Number rental ${n.e164} ${month}`, createdBy: null, rental });
        month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      }
    }
  }

  ledger.sort((a, b) => a.ms - b.ms || a.seq - b.seq);
  const balances = new Map<number, number>();
  for (const e of ledger) {
    const balance = (balances.get(e.ws.id) ?? 0) + e.amount;
    balances.set(e.ws.id, balance);
    const lid = s.id("credit_transactions");
    if (e.rental) e.rental.transaction_id = lid;
    rows.credit_transactions.push({ id: lid, workspace_id: e.ws.id, kind: e.kind, amount_micros: e.amount, balance_after: balance, call_id: e.callId, payment_id: e.paymentId, seconds: e.seconds, note: e.note, created_by: e.createdBy, created_at: iso(e.ms) });
  }
  for (const ws of spaces) {
    rows.wallets.push({
      workspace_id: ws.id,
      balance_micros: balances.get(ws.id) ?? 0,
      reserved_micros: 0,
      auto_recharge: JSON.stringify(ws.ownerIsAdmin ? { enabled: true, thresholdMicros: 20_000_000, amountMicros: 50_000_000 } : { enabled: false, thresholdMicros: 5_000_000, amountMicros: 20_000_000 }),
      low_balance_micros: ws.ownerIsAdmin ? 20_000_000 : lowBalance,
      low_balance_notified_at: null,
      auto_recharge_at: null,
      created_at: iso(ws.createdMs),
      updated_at: iso(NOW - 3 * MIN),
    });
  }

  // ── Usage, notifications and the call audit trail ──
  const currentMonth = iso(NOW).slice(0, 7);
  for (const u of usage.values()) {
    const alertsSent = u.reachedMs ? "minutes:quota_reached,minutes:quota_warning" : u.warnMs ? "minutes:quota_warning" : null;
    rows.usage_monthly.push({ user_id: u.owner, month: u.month, seconds_used: u.sec, calls: u.calls, ai_requests: u.ws.ownerIsAdmin ? (u.month === currentMonth ? 37 : 52) : u.month === currentMonth ? 6 : 3, quota_alerts: alertsSent });
    const ch = u.ws.channels.email;
    if (ch && u.warnMs) alerts.push({ ms: u.warnMs + 2_000, ws: u.ws, call: null, channel: ch, event: "quota_warning", ok: true });
    if (ch && u.reachedMs) alerts.push({ ms: u.reachedMs + 2_000, ws: u.ws, call: null, channel: ch, event: "quota_reached", ok: true });
  }
  for (const call of calls) {
    const ws = call.ws;
    const chCreated = (id?: number) => (id ? Date.parse(String(rows.notify_channels.find((c) => c.id === id)?.created_at)) : Infinity);
    if (call.outcome === "booked") {
      if (ws.channels.webhook && ws.channels.webhookEvents.includes("booking_made") && call.endedMs > chCreated(ws.channels.webhook)) {
        const fail = r() < 0.02;
        alerts.push({ ms: call.endedMs + 3_500, ws, call, channel: ws.channels.webhook, event: "booking_made", ok: !fail, error: fail ? "HTTP 502 from hooks.brightlinedental.example" : undefined });
      }
      if (ws.channels.email && ws.channels.emailEvents.includes("booking_made") && call.endedMs > chCreated(ws.channels.email)) alerts.push({ ms: call.endedMs + 3_500, ws, call, channel: ws.channels.email, event: "booking_made", ok: true });
    }
    if (call.status === "failed" && ws.channels.email && call.endedMs > chCreated(ws.channels.email)) alerts.push({ ms: call.endedMs + 1_200, ws, call, channel: ws.channels.email, event: "call_failed", ok: true });
    if (call.direction === "inbound") s.audit(ws.id, { type: "provider", id: null }, "call.inbound", "call", call.id, { provider: "simulated", from: call.from, to: call.to }, call.queuedMs);
    if (call.direction === "web") s.audit(ws.id, { type: "system", id: null }, "call.web_started", "call", call.id, { agentId: call.agent.id, source: call.web?.source ?? "test", origin: call.web?.origin ?? "", ip: "" }, call.queuedMs);
  }
  for (const a of s.audits) {
    const call = (a as { call?: CallDraft }).call;
    if (call) a.row.entity_id = String(call.id);
  }

  // ── Rows ──
  for (const call of calls) {
    const tags = encodeCallTags({ workspaceId: call.ws.id, callId: call.direction === "inbound" ? undefined : call.id, agentId: call.agent.id, campaignId: call.campaignId ?? undefined, contactId: call.contact?.id });
    const metadata = call.web ? { ...tags, web_source: call.web.source, ...(call.web.origin ? { web_origin: call.web.origin } : {}) } : tags;
    const analysed = call.status === "completed";
    rows.calls.push({
      id: call.id,
      workspace_id: call.ws.id,
      agent_id: call.agent.id,
      campaign_id: call.campaignId,
      campaign_contact_id: call.ccId,
      contact_id: call.contact?.id ?? null,
      number_id: call.number?.id ?? null,
      direction: call.direction,
      from_e164: call.from,
      to_e164: call.to,
      provider: "simulated",
      provider_call_id: call.providerCallId,
      key_source: "platform",
      status: call.status,
      end_reason: call.endReason,
      queued_at: iso(call.queuedMs),
      started_at: call.startedMs ? iso(call.startedMs) : null,
      ended_at: iso(call.endedMs),
      duration_sec: call.durationSec,
      billed_seconds: call.billed,
      included_seconds: call.included,
      price_per_min_micros: price,
      credits_reserved_micros: call.reserve,
      credits_settled_micros: call.charge,
      provider_cost_micros: call.cost,
      recording_storage: null,
      recording_key: null,
      recording_url: null,
      recording_deleted_at: null,
      transcript: call.transcript.length ? JSON.stringify(call.transcript) : null,
      summary: analysed ? call.summary : null,
      sentiment: analysed ? call.sentiment : "unknown",
      outcome: call.outcome,
      extracted: analysed && call.extracted ? JSON.stringify(call.extracted) : null,
      disclosure_played: call.disclosure,
      tool_calls: call.toolCalls.length ? JSON.stringify(call.toolCalls) : null,
      latency_ms: call.latency,
      metadata: JSON.stringify(metadata),
      error: call.error,
      reconciled_at: null,
      created_at: iso(call.queuedMs),
      updated_at: iso(call.endedMs + (analysed ? 3_000 : 0)),
    });
  }
  for (const row of rows.campaign_contacts) {
    const holder = row as Row<"campaign_contacts"> & { call?: CallDraft | null };
    row.last_call_id = holder.call?.id ?? null;
    delete holder.call;
  }
  for (const ws of spaces) rows.contacts.push(...contactRows(ws));

  alerts.sort((a, b) => a.ms - b.ms);
  for (const a of alerts) {
    if (a.ms > NOW) continue;
    rows.alert_log.push({ id: s.id("alert_log"), workspace_id: a.ws.id, call_id: a.call?.id ?? null, notify_channel_id: a.channel, event: a.event, ok: a.ok ? 1 : 0, error: a.ok ? null : (a.error ?? "Delivery failed"), created_at: iso(a.ms) });
  }
  s.audits.sort((a, b) => a.ms - b.ms);
  for (const a of s.audits) {
    const { call: _call, ...rest } = a as typeof a & { call?: CallDraft };
    void _call;
    rows.audit_log.push({ id: s.id("audit_log"), ...rest.row, created_at: iso(Math.min(rest.ms, NOW)) });
  }

  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const list = rows[table] as Array<Record<string, unknown>>;
    counts[table] = list.length;
    for (let i = 0; i < list.length; i += 400) {
      await trx
        .insertInto(table)
        .values(list.slice(i, i + 400) as never)
        .execute();
    }
  }

  // The widget key of Front desk, so the landing page and marketing can embed the live demo.
  const key = `${bright.agents.frontDesk.id}.${(await sign(`agent:${bright.agents.frontDesk.id}`, "widget-key")).slice(0, 22)}`;
  const exists = await trx.selectFrom("settings").select("key").where("key", "=", "showcase_widget_agent_key").executeTakeFirst();
  if (exists) await trx.updateTable("settings").set({ value: key }).where("key", "=", "showcase_widget_agent_key").execute();
  else await trx.insertInto("settings").values({ key: "showcase_widget_agent_key", value: key }).execute();
  counts.workspaces_seeded = spaces.length;
  return counts;
}
