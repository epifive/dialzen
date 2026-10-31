import crypto from "node:crypto";
import { localDay, zonedTimeToUtc } from "@/voice/normalize";
import { signatureHeaders } from "@/lib/webhook-signature";
import type { ToolConfigByKind, ToolKind } from "@/voice/types";

/**
 * The tool runtime: what happens when an agent calls one of its tools during a call. Server tools
 * must answer fast (providers wait ~5-10 s while the caller hears silence), so every external
 * request has a short timeout and the result is a small JSON object with a `message` the agent
 * can say. Pure: fetch, the clock and API bases are injected (tests use mocks).
 *
 *   cal_com          Cal.com API v2: free slots (GET /v2/slots) and bookings (POST /v2/bookings)
 *   google_calendar  Google Calendar: freeBusy + events.insert with the tenant's OAuth token
 *   webhook          POST/GET the arguments to the tenant's URL, signed (X-Dialzen-Signature)
 *   google_sheets    Google Sheets: values.append of one row
 *   transfer/end_call are handled by the provider itself (never called here)
 *
 * Demo calendars: a Cal.com tool whose API key starts with "cal_demo_" (the demo seed's keys), and
 * on a DEMO_MODE site every Cal.com tool and every Google Calendar tool without a working Google
 * connection, answer from a simulated calendar (plausible free times on business days, bookings
 * accepted deterministically, nothing sent anywhere). DEMO_MODE also answers webhook tools that
 * point at a reserved ".example" host. Nothing else is ever simulated.
 */

export interface ToolCallContext {
  fetch: typeof fetch;
  now: () => number;
  /** Per request timeout (ms), capped so the whole tool answers within ~5 s. */
  timeoutMs: number;
  /** Google OAuth client of the site. */
  google: { clientId: string; clientSecret: string };
  /** Test overrides of API bases ("" = the real APIs). */
  apiBase: { google: string; calcom: string };
  /** The call the tool runs in (for webhook payloads, sheet rows and defaults). */
  call: { id: number | null; workspaceId: number; agentId: number; from: string; to: string; direction: string; callerNumber: string };
  /** DEMO_MODE site: demo calendars and ".example" webhooks are simulated (see above). */
  demo?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** JSON returned to the agent (always has `message`). */
  data: Record<string, unknown>;
  /** A booking was made (outcome "booked"). */
  booked?: boolean;
  error?: string;
}

const ok = (data: Record<string, unknown>, booked = false): ToolResult => ({ ok: true, data, booked });
const failed = (message: string, error = message): ToolResult => ({ ok: false, data: { message }, error });

class ToolHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function http(ctx: ToolCallContext, url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; body: unknown; text: string }> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  let res: Response;
  try {
    res = await ctx.fetch(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, redirect: "manual", signal: AbortSignal.timeout(Math.max(500, Math.min(ctx.timeoutMs, 4500))) });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ToolHttpError(0, timeout ? "The service did not answer in time." : "Could not reach the service.");
  }
  const text = (await res.text().catch(() => "")).slice(0, 200_000);
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // text
  }
  return { status: res.status, body: parsed, text };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

// ── Dates and slots ──

/** "Tuesday, October 21, 9:30 AM" in a zone. */
export function slotLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const isoWeekday = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
};

/** The requested day (YYYY-MM-DD) or today in the zone; never in the past. */
export function requestedDay(arg: unknown, tz: string, nowMs: number): string {
  const today = localDay(nowMs, tz);
  const v = s(arg, 40);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m && m[1] >= today ? m[1] : today;
}

/** Free slots of a Google calendar: weekly hours minus busy intervals (with buffer), from `day` for `days` days. */
export function freeSlots(input: { day: string; days: number; tz: string; hours: { start: string; end: string; days: number[] }; durationMin: number; bufferMin: number; busy: Array<{ start: string; end: string }>; nowMs: number; leadMin?: number; max?: number }): string[] {
  const out: string[] = [];
  const busy = input.busy.map((b) => [Date.parse(b.start) - input.bufferMin * 60_000, Date.parse(b.end) + input.bufferMin * 60_000] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const earliest = input.nowMs + (input.leadMin ?? 30) * 60_000;
  const [sh, sm] = input.hours.start.split(":").map(Number);
  const [eh, em] = input.hours.end.split(":").map(Number);
  const step = Math.max(10, input.durationMin) * 60_000;
  for (let i = 0; i < input.days && out.length < (input.max ?? 50); i++) {
    const day = addDays(input.day, i);
    if (!input.hours.days.includes(isoWeekday(day))) continue;
    const [y, m, d] = day.split("-").map(Number);
    const open = zonedTimeToUtc({ year: y, month: m, day: d, hour: sh, minute: sm }, input.tz);
    const close = zonedTimeToUtc({ year: y, month: m, day: d, hour: eh, minute: em }, input.tz);
    for (let t = open; t + input.durationMin * 60_000 <= close; t += step) {
      const end = t + input.durationMin * 60_000;
      if (t < earliest) continue;
      if (busy.some(([a, b]) => t < b && end > a)) continue;
      out.push(new Date(t).toISOString());
      if (out.length >= (input.max ?? 50)) break;
    }
  }
  return out;
}

/** Groups slots by local day and keeps the first day that has any (plus a hint of the next). */
function availabilityAnswer(slots: string[], tz: string, requested: string): Record<string, unknown> {
  if (!slots.length) return { message: "There are no free times in the next 7 days.", slots: [] };
  const firstDay = localDay(Date.parse(slots[0]), tz);
  const day = slots.filter((x) => localDay(Date.parse(x), tz) === firstDay).slice(0, 8);
  const labels = day.map((x) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(x)));
  const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(day[0]));
  const moved = firstDay !== requested ? ` (nothing was free on ${requested})` : "";
  return { message: `Free times on ${dayLabel}${moved}: ${labels.join(", ")}. Time zone ${tz}.`, date: firstDay, timezone: tz, slots: day.map((start) => ({ start, label: slotLabel(start, tz) })) };
}

// ── Cal.com ──

const CAL_SLOTS_VERSION = "2024-09-04";
const CAL_BOOKINGS_VERSION = "2026-02-25";

async function calCom(ctx: ToolCallContext, config: ToolConfigByKind["cal_com"], args: Record<string, unknown>): Promise<ToolResult> {
  if (usesDemoCalendar("cal_com", config, ctx)) return simulatedCalendar(ctx, { seed: `cal:${config.apiKey}:${config.eventTypeId}`, tz: config.timezone || "UTC", hours: DEMO_HOURS, durationMin: 30 }, args);
  if (!config.apiKey || !config.eventTypeId) return failed("Booking is not set up yet. Offer to take a message instead.", "Cal.com API key or event type missing.");
  const base = (ctx.apiBase.calcom || config.apiBase || "https://api.cal.com").replace(/\/+$/, "");
  const auth = { Authorization: `Bearer ${config.apiKey}` };
  const tz = config.timezone || "UTC";
  const action = s(args.action, 20).toLowerCase();
  if (action === "book") {
    const start = s(args.start, 60);
    const name = s(args.name, 120);
    if (!start || Number.isNaN(Date.parse(start))) return failed("I need the exact start time from the list of free times before I can book.", "");
    if (!name) return failed("I need the caller's name to book.", "");
    const attendee: Record<string, unknown> = { name, timeZone: tz, language: "en" };
    const email = s(args.email, 190);
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) attendee.email = email;
    const phone = s(args.phone, 30) || ctx.call.callerNumber;
    if (/^\+\d{6,15}$/.test(phone)) attendee.phoneNumber = phone;
    const res = await http(ctx, `${base}/v2/bookings`, {
      method: "POST",
      headers: { ...auth, "cal-api-version": CAL_BOOKINGS_VERSION },
      json: { start: new Date(start).toISOString(), eventTypeId: config.eventTypeId, attendee, metadata: { dialzen_call_id: String(ctx.call.id ?? ""), notes: s(args.notes, 400) } },
    });
    const data = obj(obj(res.body).data);
    const first = Array.isArray(obj(res.body).data) ? obj((obj(res.body).data as unknown[])[0]) : data;
    if (res.status >= 300 || obj(res.body).status === "error") return failed("That time could not be booked. Offer another free time.", `Cal.com HTTP ${res.status}: ${s(obj(obj(res.body).error).message ?? res.text, 200)}`);
    return ok({ message: `Booked for ${slotLabel(s(first.start) || start, tz)}.`, booking_id: s(first.uid) || s(first.id), start: s(first.start) || start }, true);
  }
  const day = requestedDay(args.date, tz, ctx.now());
  const res = await http(ctx, `${base}/v2/slots?eventTypeId=${config.eventTypeId}&start=${day}&end=${addDays(day, 6)}&timeZone=${encodeURIComponent(tz)}`, { headers: { ...auth, "cal-api-version": CAL_SLOTS_VERSION } });
  if (res.status >= 300) return failed("I can't check the calendar right now. Offer to take a message.", `Cal.com HTTP ${res.status}`);
  const byDay = obj(obj(res.body).data);
  const slots = Object.keys(byDay)
    .sort()
    .flatMap((k) => (Array.isArray(byDay[k]) ? (byDay[k] as unknown[]) : []).map((x) => s(obj(x).start ?? x, 60)))
    .filter((x) => x && !Number.isNaN(Date.parse(x)))
    .map((x) => new Date(x).toISOString());
  return ok(availabilityAnswer(slots, tz, day));
}

// ── Simulated calendar (demo) ──

/** Business hours of a simulated Cal.com calendar: Monday to Friday, 9:00 to 17:00. */
const DEMO_HOURS = { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] };

/**
 * Whether a calendar tool answers from the simulated calendar: Cal.com keys starting with
 * "cal_demo_" (anywhere), and on a DEMO_MODE site every Cal.com tool and Google Calendar tools
 * without a working Google connection (no account connected or no Google OAuth client on the site).
 */
export function usesDemoCalendar(kind: "cal_com" | "google_calendar", config: { apiKey?: string; refreshToken?: string }, ctx: Pick<ToolCallContext, "demo" | "google">): boolean {
  if (kind === "cal_com") return (config.apiKey ?? "").startsWith("cal_demo_") || ctx.demo === true;
  return ctx.demo === true && (!config.refreshToken || !ctx.google.clientId || !ctx.google.clientSecret);
}

/** DEMO_MODE webhook tools pointing at a reserved ".example" host (RFC 2606) are answered locally. */
export function isDemoWebhook(url: string, demo: boolean): boolean {
  if (!demo) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "example" || host.endsWith(".example");
  } catch {
    return false;
  }
}

const demoHash = (text: string) => crypto.createHash("sha256").update(text).digest();

/** About one time in three is "already booked", the same on every request, so the calendar looks used. */
const demoTaken = (seed: string, startIso: string) => demoHash(`${seed}|${startIso}`)[0] % 3 === 0;

/** A start time from the agent: ISO with a zone, or a local "YYYY-MM-DDTHH:MM" read in the calendar's zone. */
function demoStart(value: string, tz: string): number {
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (local) return zonedTimeToUtc({ year: Number(local[1]), month: Number(local[2]), day: Number(local[3]), hour: Number(local[4]), minute: Number(local[5]) }, tz);
  return Date.parse(value);
}

function simulatedCalendar(ctx: ToolCallContext, cal: { seed: string; tz: string; hours: { start: string; end: string; days: number[] }; durationMin: number }, args: Record<string, unknown>): ToolResult {
  const { tz, hours, durationMin, seed } = cal;
  const action = s(args.action, 20).toLowerCase();
  if (action === "book") {
    const start = s(args.start, 60);
    const name = s(args.name, 120);
    const startMs = start ? demoStart(start, tz) : NaN;
    if (!Number.isFinite(startMs)) return failed("I need the exact start time from the list of free times before I can book.", "");
    if (!name) return failed("I need the caller's name to book.", "");
    const startIso = new Date(startMs).toISOString();
    const open = freeSlots({ day: localDay(startMs, tz), days: 1, tz, hours, durationMin, bufferMin: 0, busy: [], nowMs: ctx.now(), max: 200 });
    if (!open.includes(startIso)) return failed("That time isn't free. Offer one of the free times.", "");
    if (demoTaken(seed, startIso)) return failed("That time was just taken. Offer another free time.", "");
    const bookingId = `demo_${demoHash(`${seed}|${startIso}|${name.toLowerCase()}`).toString("hex").slice(0, 12)}`;
    return ok({ message: `Booked for ${slotLabel(startIso, tz)}.`, booking_id: bookingId, start: startIso, simulated: true }, true);
  }
  const day = requestedDay(args.date, tz, ctx.now());
  const slots = freeSlots({ day, days: 7, tz, hours, durationMin, bufferMin: 0, busy: [], nowMs: ctx.now(), max: 400 }).filter((x) => !demoTaken(seed, x));
  return ok({ ...availabilityAnswer(slots, tz, day), simulated: true });
}

// ── Google ──

const tokenCache = new Map<string, { token: string; until: number }>();

/** An access token for a refresh token (cached until shortly before it expires). */
export async function googleAccessToken(ctx: ToolCallContext, refreshToken: string): Promise<string> {
  const key = crypto.createHash("sha256").update(refreshToken).digest("hex");
  const hit = tokenCache.get(key);
  if (hit && hit.until > ctx.now()) return hit.token;
  if (!ctx.google.clientId || !ctx.google.clientSecret) throw new ToolHttpError(0, "Google is not set up on this site.");
  const url = ctx.apiBase.google ? `${ctx.apiBase.google.replace(/\/+$/, "")}/token` : "https://oauth2.googleapis.com/token";
  const res = await http(ctx, url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: ctx.google.clientId, client_secret: ctx.google.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
  });
  const token = s(obj(res.body).access_token, 4000);
  if (res.status >= 300 || !token) throw new ToolHttpError(res.status, res.status === 400 || res.status === 401 ? "The Google connection expired. Connect the Google account again." : `Google token HTTP ${res.status}`);
  const ttl = Number(obj(res.body).expires_in) || 3600;
  tokenCache.set(key, { token, until: ctx.now() + Math.max(60, ttl - 120) * 1000 });
  return token;
}

/** Test hook: forget cached Google access tokens. */
export function clearGoogleTokenCache(): void {
  tokenCache.clear();
}

const calendarBase = (ctx: ToolCallContext) => (ctx.apiBase.google ? `${ctx.apiBase.google.replace(/\/+$/, "")}/calendar/v3` : "https://www.googleapis.com/calendar/v3");
const sheetsBase = (ctx: ToolCallContext) => (ctx.apiBase.google ? `${ctx.apiBase.google.replace(/\/+$/, "")}/v4/spreadsheets` : "https://sheets.googleapis.com/v4/spreadsheets");

async function googleBusy(ctx: ToolCallContext, token: string, calendarId: string, fromIso: string, toIso: string, tz: string): Promise<Array<{ start: string; end: string }>> {
  const res = await http(ctx, `${calendarBase(ctx)}/freeBusy`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: { timeMin: fromIso, timeMax: toIso, timeZone: tz, items: [{ id: calendarId }] } });
  if (res.status >= 300) throw new ToolHttpError(res.status, `Google freeBusy HTTP ${res.status}`);
  const cal = obj(obj(obj(res.body).calendars)[calendarId]);
  if (Array.isArray(cal.errors) && cal.errors.length) throw new ToolHttpError(404, "The calendar can't be read with this Google account.");
  return (Array.isArray(cal.busy) ? cal.busy : []).map((b) => ({ start: s(obj(b).start, 60), end: s(obj(b).end, 60) }));
}

async function googleCalendar(ctx: ToolCallContext, config: ToolConfigByKind["google_calendar"], args: Record<string, unknown>): Promise<ToolResult> {
  if (usesDemoCalendar("google_calendar", config, ctx)) return simulatedCalendar(ctx, { seed: `google:${config.calendarId}`, tz: config.timezone || "UTC", hours: config.hours?.days?.length ? config.hours : DEMO_HOURS, durationMin: config.durationMin || 30 }, args);
  if (!config.refreshToken) return failed("Booking is not set up yet. Offer to take a message instead.", "Google account not connected.");
  const tz = config.timezone || "UTC";
  const token = await googleAccessToken(ctx, config.refreshToken);
  const action = s(args.action, 20).toLowerCase();
  if (action === "book") {
    const start = s(args.start, 60);
    const name = s(args.name, 120);
    if (!start || Number.isNaN(Date.parse(start))) return failed("I need the exact start time from the list of free times before I can book.", "");
    if (!name) return failed("I need the caller's name to book.", "");
    const startMs = Date.parse(start);
    const endMs = startMs + config.durationMin * 60_000;
    const busy = await googleBusy(ctx, token, config.calendarId, new Date(startMs - config.bufferMin * 60_000).toISOString(), new Date(endMs + config.bufferMin * 60_000).toISOString(), tz);
    if (busy.length) return failed("That time was just taken. Offer another free time.", "");
    const phone = s(args.phone, 30) || ctx.call.callerNumber;
    const email = s(args.email, 190);
    const description = [`Booked by phone (AI agent).`, `Name: ${name}`, phone ? `Phone: ${phone}` : "", email ? `Email: ${email}` : "", s(args.notes, 500) ? `Notes: ${s(args.notes, 500)}` : ""].filter(Boolean).join("\n");
    const event: Record<string, unknown> = {
      summary: `${name}${s(args.notes, 60) ? ` – ${s(args.notes, 60)}` : ""}`,
      description,
      start: { dateTime: new Date(startMs).toISOString(), timeZone: tz },
      end: { dateTime: new Date(endMs).toISOString(), timeZone: tz },
      extendedProperties: { private: { dialzen_call_id: String(ctx.call.id ?? "") } },
    };
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) event.attendees = [{ email, displayName: name }];
    const res = await http(ctx, `${calendarBase(ctx)}/calendars/${encodeURIComponent(config.calendarId)}/events`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: event });
    if (res.status >= 300) return failed("That time could not be booked. Offer another free time.", `Google events.insert HTTP ${res.status}`);
    return ok({ message: `Booked for ${slotLabel(new Date(startMs).toISOString(), tz)}.`, booking_id: s(obj(res.body).id), start: new Date(startMs).toISOString() }, true);
  }
  const day = requestedDay(args.date, tz, ctx.now());
  const [y, m, d] = day.split("-").map(Number);
  const from = zonedTimeToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, tz);
  const busy = await googleBusy(ctx, token, config.calendarId, new Date(from).toISOString(), new Date(from + 7 * 86_400_000).toISOString(), tz);
  const slots = freeSlots({ day, days: 7, tz, hours: config.hours, durationMin: config.durationMin, bufferMin: config.bufferMin, busy, nowMs: ctx.now() });
  return ok(availabilityAnswer(slots, tz, day));
}

async function googleSheets(ctx: ToolCallContext, config: ToolConfigByKind["google_sheets"], args: Record<string, unknown>): Promise<ToolResult> {
  if (!config.refreshToken || !config.spreadsheetId) return failed("I noted the details.", "Google Sheets not connected.");
  const token = await googleAccessToken(ctx, config.refreshToken);
  const at = new Date(ctx.now());
  const builtins: Record<string, string> = { call_id: String(ctx.call.id ?? ""), caller_number: ctx.call.callerNumber, date: at.toISOString().slice(0, 10), time: at.toISOString().slice(11, 19) };
  const columns = config.columns.length ? config.columns : Object.keys(args);
  const row = columns.map((c) => {
    const key = c.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    const v = args[key] ?? args[c] ?? builtins[key] ?? "";
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v).slice(0, 1000) : JSON.stringify(v).slice(0, 1000);
  });
  const range = encodeURIComponent(`${config.sheetName || "Sheet1"}!A1`);
  const res = await http(ctx, `${sheetsBase(ctx)}/${encodeURIComponent(config.spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, json: { values: [row] } });
  if (res.status >= 300) return failed("I noted the details.", `Google Sheets HTTP ${res.status}`);
  return ok({ message: "Saved.", updated_range: s(obj(obj(res.body).updates).updatedRange, 200) });
}

// ── Webhook ──


async function webhookTool(ctx: ToolCallContext, config: ToolConfigByKind["webhook"], args: Record<string, unknown>, toolName: string): Promise<ToolResult> {
  if (!config.url) return failed("I can't do that right now.", "Webhook URL missing.");
  if (isDemoWebhook(config.url, ctx.demo === true)) return ok({ message: "Saved.", simulated: true });
  const payload = { tool: toolName, args, call: { id: ctx.call.id, workspace_id: ctx.call.workspaceId, agent_id: ctx.call.agentId, direction: ctx.call.direction, from: ctx.call.from, to: ctx.call.to }, sent_at: new Date(ctx.now()).toISOString() };
  const body = JSON.stringify(payload);
  // Signed like every Dialzen webhook: HMAC-SHA256 of "<X-Dialzen-Timestamp>.<body>" (src/lib/webhook-signature.ts).
  const headers: Record<string, string> = { ...config.headers, "User-Agent": "Dialzen-Tool/1.0", "X-Dialzen-Event": "tool_call", ...signatureHeaders(body, config.secret ?? "", ctx.now()) };
  const limited = { ...ctx, timeoutMs: Math.min(ctx.timeoutMs, config.timeoutMs || 4000) };
  // Always POST with the signed JSON body (a GET would carry the arguments outside the signature).
  const res = await http(limited, config.url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body });
  if (res.status >= 300) return failed("The system didn't accept that. Offer to take a message.", `Webhook HTTP ${res.status}`);
  const answer = res.body && typeof res.body === "object" ? obj(res.body) : { message: res.text.slice(0, 2000) || "Done." };
  if (!("message" in answer)) answer.message = "Done.";
  return ok(answer);
}

// ── Entry point ──

export async function runTool<K extends ToolKind>(kind: K, config: ToolConfigByKind[K], args: Record<string, unknown>, ctx: ToolCallContext, toolName = "tool"): Promise<ToolResult> {
  try {
    switch (kind) {
      case "cal_com":
        return await calCom(ctx, config as ToolConfigByKind["cal_com"], args);
      case "google_calendar":
        return await googleCalendar(ctx, config as ToolConfigByKind["google_calendar"], args);
      case "google_sheets":
        return await googleSheets(ctx, config as ToolConfigByKind["google_sheets"], args);
      case "webhook":
        return await webhookTool(ctx, config as ToolConfigByKind["webhook"], args, toolName);
      default:
        return failed("This action is handled by the phone system.", `${kind} tools run at the provider.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed.";
    return failed("I can't do that right now. Offer to take a message instead.", message);
  }
}
