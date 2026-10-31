/**
 * Turns untrusted input (dashboard forms, CSV imports, stored JSON, REST API bodies, provider
 * webhooks) into valid values, and holds the pure logic shared by the dashboard, the campaign
 * engine, the webhook ingest, the billing code and the tests: E.164 phone numbers, time zones and
 * calling hours, the dial-time compliance check (canDial), opt-out detection, the AI disclosure,
 * prompt variables, credit maths, roles and settings. Unknown keys are dropped, missing keys get
 * defaults. Dependency-free (server, client components and tests).
 *
 * Compliance helpers are tools, not legal advice: the operator and its tenants stay responsible
 * for the TCPA/TSR, PECR, GDPR, TRAI and other rules that apply to their calls.
 */

import {
  AGENT_STATUSES,
  ANALYSIS_FIELD_TYPES,
  ASSIGNABLE_ROLES,
  CAMPAIGN_PURPOSES,
  CONSENT_SOURCES,
  CONSENT_TYPES,
  DEFAULT_NOTIFY_EVENTS,
  INTERRUPTION_LEVELS,
  NOTIFY_CHANNEL_TYPES,
  NOTIFY_EVENTS,
  PROVIDERS,
  RETRYABLE_OUTCOMES,
  TOOL_KINDS,
  VOICEMAIL_ACTIONS,
  WORKSPACE_ROLES,
  type AgentSettings,
  type AgentStatus,
  type AnalysisField,
  type AssignableRole,
  type AutoRecharge,
  type BillingRounding,
  type CallingWindow,
  type CallTags,
  type CampaignPurpose,
  type CampaignStatus,
  type ComplianceSettings,
  type Consent,
  type ConsentSource,
  type ConsentType,
  type DialBlockReason,
  type DialCheckResult,
  type DncMatch,
  type NotifyChannelType,
  type NotifyConfigByType,
  type NotifyEvent,
  type ProviderId,
  type RetryableOutcome,
  type ToolConfigByKind,
  type ToolKind,
  type ToolParameter,
  type TranscriptTurn,
  type WeeklyHours,
  type WidgetSettings,
  type WorkspaceBranding,
  type WorkspaceCapability,
  type WorkspaceRole,
  type WorkspaceSettings,
} from "./types";

type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
export const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;

// ── Primitive helpers ──

/** JSON.parse that never throws: {} for empty or invalid text. */
export function parseJson(text: string | null | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** A JSON array of strings (tags, scopes…) from stored text; [] when invalid. */
export function parseJsonList(text: string | null | undefined): string[] {
  const v = parseJson(text);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** A JSON array of positive integers (ids) from stored text or a value; [] when invalid. */
export function idList(v: unknown, max = 100): number[] {
  const raw = typeof v === "string" ? (v.trim().startsWith("[") ? parseJson(v) : v.split(/[\s,]+/)) : v;
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = typeof x === "number" ? x : typeof x === "string" && /^\d{1,10}$/.test(x.trim()) ? Number(x) : NaN;
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** Trimmed string without control characters, at most `max` characters. */
export function str(v: unknown, fallback = "", max = 500): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v).slice(0, max);
  if (typeof v !== "string") return fallback;
  return v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

/** Like str() but keeps line breaks (prompts, notes). */
export function text(v: unknown, max = 20_000): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max);
}

export function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "on" || v === 1 || v === "1" || v === "yes") return true;
  if (v === "false" || v === "off" || v === 0 || v === "0" || v === "no") return false;
  return fallback;
}

/** Integer clamped to [min, max]; `fallback` when not a number. */
export function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Number (decimals kept) clamped to [min, max]; `fallback` when not a number. */
export function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function list(v: unknown, max: number, each: (s: string) => string): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]+/) : [];
  return [...new Set(raw.map((x) => each(String(x))).filter(Boolean))].slice(0, max);
}

/** Lowercase email or "" when it doesn't look like one. */
export function normalizeEmail(v: unknown): string {
  const s = str(v, "", 190).toLowerCase();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(s) ? s : "";
}

/** Up to `max` valid, distinct email addresses from a comma / space / newline separated list. */
export function normalizeEmailList(v: unknown, max = 10): string[] {
  return list(typeof v === "string" ? v.replace(/[;\s]+/g, ",") : v, max, normalizeEmail);
}

/** #rrggbb (or "" when invalid). "#abc" is expanded. */
export function normalizeColor(v: unknown): string {
  const s = str(v, "", 7).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return "";
}

/** http(s) URL or "". */
export function httpUrl(v: unknown): string {
  if (typeof v !== "string") return "";
  const value = v.trim().slice(0, 2000);
  return /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value : "";
}

/** Tags: trimmed, single spaces, distinct (case-insensitive), at most 20 × 40 characters. */
export function normalizeTags(v: unknown, max = 20): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const tag = str(x, "", 40).replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** "HH:MM" (24 h) or "" when invalid. "9:5" → "09:05". */
export function normalizeTime(v: unknown): string {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(str(v, "", 5));
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min <= 59 && !(h === 24 && min > 0) ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : "";
}

/** ISO weekdays 1–7, distinct and sorted. */
export function normalizeDays(v: unknown, fallback: number[] = [1, 2, 3, 4, 5, 6, 7]): number[] {
  if (!Array.isArray(v)) return [...fallback];
  return [...new Set(v.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
}

/** "YYYY-MM-DD" or "". */
export function normalizeDay(v: unknown): string {
  const s = str(v, "", 10);
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) ? s : "";
}

export function isProvider(v: unknown): v is ProviderId {
  return typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);
}

// ── Time zones (Intl only) ──

const dtfCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Current IANA names of zones that ICU (Node, some browsers) still reports under their old names. */
const TZ_ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
};

/** The current IANA name of a zone ("Asia/Calcutta" → "Asia/Kolkata"). */
export function canonicalTimeZone(tz: string): string {
  return TZ_ALIASES[tz] ?? tz;
}

/** A valid IANA time zone (current name) or `fallback` ("UTC"). */
export function normalizeTimeZone(v: unknown, fallback = "UTC"): string {
  return isValidTimeZone(v) ? canonicalTimeZone(v) : fallback;
}

function tzFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: isValidTimeZone(tz) ? tz : "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    dtfCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday 1–7. */
  weekday: number;
}

/** Wall-clock parts of an instant in a time zone (DST-aware through Intl). */
export function zonedParts(ms: number, tz: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of tzFormatter(tz).formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 1,
  };
}

/** Local time minus UTC at an instant, in ms (e.g. +7,200,000 for Berlin in summer). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant of a local wall-clock time. Times skipped by a DST change (02:30 on a
 * spring-forward day) move forward by the gap (→ 03:30); repeated times (fall-back) resolve to
 * the first occurrence.
 */
export function zonedTimeToUtc(local: { year: number; month: number; day: number; hour: number; minute: number }, tz: string): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const o1 = tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
  const o2 = tzOffsetMs(guess - o1, tz);
  const candidates = [...new Set([guess - o1, guess - o2, guess - tzOffsetMs(guess - 86_400_000, tz), guess - tzOffsetMs(guess + 86_400_000, tz)])].sort((a, b) => a - b);
  for (const c of candidates) {
    const p = zonedParts(c, tz);
    if (p.year === local.year && p.month === local.month && p.day === local.day && p.hour === local.hour && p.minute === local.minute) return c;
  }
  return guess - tzOffsetMs(guess - 86_400_000, tz);
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function localDay(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "HH:MM" of an instant in a time zone. */
export function localTime(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Interprets "YYYY-MM-DDTHH:MM" (a datetime-local input) in a time zone; NaN when invalid. */
export function parseLocalDateTime(value: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return NaN;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return NaN;
  return zonedTimeToUtc({ year, month, day, hour, minute }, tz);
}

/** Common time zones for selects (all of Intl's when available). */
export function timeZoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  try {
    const all = supported ? supported("timeZone") : [];
    if (all.length) return ["UTC", ...[...new Set(all.map(canonicalTimeZone))].filter((z) => z !== "UTC").sort()];
  } catch {
    // Older runtimes.
  }
  return ["UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
}

// ── Countries and E.164 phone numbers ──

/**
 * Compact numbering table: ISO, calling code, trunk prefix dropped from national numbers,
 * national significant number length (min-max), and the time zones assumed when a contact's own
 * zone is unknown (calling hours must then hold in EVERY listed zone, so the check stays on the
 * safe side). Not exhaustive: numbers with other calling codes are accepted with country "".
 */
const COUNTRY_ROWS: ReadonlyArray<[iso: string, cc: string, trunk: string, len: string, zones: string, name: string]> = [
  ["US", "1", "1", "10-10", "America/New_York|America/Chicago|America/Denver|America/Los_Angeles", "United States"],
  ["CA", "1", "1", "10-10", "America/Halifax|America/Toronto|America/Winnipeg|America/Edmonton|America/Vancouver", "Canada"],
  ["PR", "1", "1", "10-10", "America/Puerto_Rico", "Puerto Rico"],
  ["DO", "1", "1", "10-10", "America/Santo_Domingo", "Dominican Republic"],
  ["JM", "1", "1", "10-10", "America/Jamaica", "Jamaica"],
  ["TT", "1", "1", "10-10", "America/Port_of_Spain", "Trinidad and Tobago"],
  ["BS", "1", "1", "10-10", "America/Nassau", "Bahamas"],
  ["BB", "1", "1", "10-10", "America/Barbados", "Barbados"],
  ["BM", "1", "1", "10-10", "Atlantic/Bermuda", "Bermuda"],
  ["GU", "1", "1", "10-10", "Pacific/Guam", "Guam"],
  ["GB", "44", "0", "9-10", "Europe/London", "United Kingdom"],
  ["IE", "353", "0", "7-9", "Europe/Dublin", "Ireland"],
  ["FR", "33", "0", "9-9", "Europe/Paris", "France"],
  ["DE", "49", "0", "6-13", "Europe/Berlin", "Germany"],
  ["ES", "34", "", "9-9", "Europe/Madrid", "Spain"],
  ["IT", "39", "", "6-11", "Europe/Rome", "Italy"],
  ["PT", "351", "", "9-9", "Europe/Lisbon", "Portugal"],
  ["NL", "31", "0", "9-9", "Europe/Amsterdam", "Netherlands"],
  ["BE", "32", "0", "8-9", "Europe/Brussels", "Belgium"],
  ["LU", "352", "", "6-11", "Europe/Luxembourg", "Luxembourg"],
  ["CH", "41", "0", "9-9", "Europe/Zurich", "Switzerland"],
  ["AT", "43", "0", "4-13", "Europe/Vienna", "Austria"],
  ["SE", "46", "0", "7-10", "Europe/Stockholm", "Sweden"],
  ["NO", "47", "", "8-8", "Europe/Oslo", "Norway"],
  ["DK", "45", "", "8-8", "Europe/Copenhagen", "Denmark"],
  ["FI", "358", "0", "5-12", "Europe/Helsinki", "Finland"],
  ["PL", "48", "", "9-9", "Europe/Warsaw", "Poland"],
  ["CZ", "420", "", "9-9", "Europe/Prague", "Czechia"],
  ["SK", "421", "0", "9-9", "Europe/Bratislava", "Slovakia"],
  ["HU", "36", "06", "8-9", "Europe/Budapest", "Hungary"],
  ["RO", "40", "0", "9-9", "Europe/Bucharest", "Romania"],
  ["BG", "359", "0", "8-9", "Europe/Sofia", "Bulgaria"],
  ["GR", "30", "", "10-10", "Europe/Athens", "Greece"],
  ["HR", "385", "0", "8-9", "Europe/Zagreb", "Croatia"],
  ["SI", "386", "0", "8-8", "Europe/Ljubljana", "Slovenia"],
  ["EE", "372", "", "7-8", "Europe/Tallinn", "Estonia"],
  ["LV", "371", "", "8-8", "Europe/Riga", "Latvia"],
  ["LT", "370", "8", "8-8", "Europe/Vilnius", "Lithuania"],
  ["CY", "357", "", "8-8", "Asia/Nicosia", "Cyprus"],
  ["MT", "356", "", "8-8", "Europe/Malta", "Malta"],
  ["IS", "354", "", "7-9", "Atlantic/Reykjavik", "Iceland"],
  ["UA", "380", "0", "9-9", "Europe/Kyiv", "Ukraine"],
  ["TR", "90", "0", "10-10", "Europe/Istanbul", "Turkey"],
  ["RU", "7", "8", "10-10", "Europe/Moscow", "Russia"],
  ["KZ", "7", "8", "10-10", "Asia/Almaty", "Kazakhstan"],
  ["IL", "972", "0", "8-9", "Asia/Jerusalem", "Israel"],
  ["AE", "971", "0", "8-9", "Asia/Dubai", "United Arab Emirates"],
  ["SA", "966", "0", "9-9", "Asia/Riyadh", "Saudi Arabia"],
  ["QA", "974", "", "8-8", "Asia/Qatar", "Qatar"],
  ["KW", "965", "", "8-8", "Asia/Kuwait", "Kuwait"],
  ["BH", "973", "", "8-8", "Asia/Bahrain", "Bahrain"],
  ["OM", "968", "", "8-8", "Asia/Muscat", "Oman"],
  ["JO", "962", "0", "8-9", "Asia/Amman", "Jordan"],
  ["EG", "20", "0", "9-10", "Africa/Cairo", "Egypt"],
  ["MA", "212", "0", "9-9", "Africa/Casablanca", "Morocco"],
  ["NG", "234", "0", "8-10", "Africa/Lagos", "Nigeria"],
  ["GH", "233", "0", "9-9", "Africa/Accra", "Ghana"],
  ["KE", "254", "0", "9-9", "Africa/Nairobi", "Kenya"],
  ["ZA", "27", "0", "9-9", "Africa/Johannesburg", "South Africa"],
  ["IN", "91", "0", "10-10", "Asia/Kolkata", "India"],
  ["PK", "92", "0", "9-10", "Asia/Karachi", "Pakistan"],
  ["BD", "880", "0", "10-10", "Asia/Dhaka", "Bangladesh"],
  ["LK", "94", "0", "9-9", "Asia/Colombo", "Sri Lanka"],
  ["NP", "977", "0", "8-10", "Asia/Kathmandu", "Nepal"],
  ["SG", "65", "", "8-8", "Asia/Singapore", "Singapore"],
  ["MY", "60", "0", "8-10", "Asia/Kuala_Lumpur", "Malaysia"],
  ["ID", "62", "0", "8-12", "Asia/Jakarta|Asia/Makassar|Asia/Jayapura", "Indonesia"],
  ["PH", "63", "0", "10-10", "Asia/Manila", "Philippines"],
  ["TH", "66", "0", "8-9", "Asia/Bangkok", "Thailand"],
  ["VN", "84", "0", "9-10", "Asia/Ho_Chi_Minh", "Vietnam"],
  ["CN", "86", "0", "10-11", "Asia/Shanghai", "China"],
  ["HK", "852", "", "8-8", "Asia/Hong_Kong", "Hong Kong"],
  ["TW", "886", "0", "8-9", "Asia/Taipei", "Taiwan"],
  ["JP", "81", "0", "9-10", "Asia/Tokyo", "Japan"],
  ["KR", "82", "0", "8-10", "Asia/Seoul", "South Korea"],
  ["AU", "61", "0", "9-9", "Australia/Perth|Australia/Adelaide|Australia/Sydney", "Australia"],
  ["NZ", "64", "0", "8-10", "Pacific/Auckland", "New Zealand"],
  ["BR", "55", "0", "10-11", "America/Sao_Paulo|America/Manaus", "Brazil"],
  ["MX", "52", "", "10-10", "America/Mexico_City|America/Tijuana", "Mexico"],
  ["AR", "54", "0", "10-11", "America/Argentina/Buenos_Aires", "Argentina"],
  ["CL", "56", "", "9-9", "America/Santiago", "Chile"],
  ["CO", "57", "", "10-10", "America/Bogota", "Colombia"],
  ["PE", "51", "", "8-9", "America/Lima", "Peru"],
];

export interface CountryInfo {
  iso: string;
  callingCode: string;
  trunk: string;
  minLength: number;
  maxLength: number;
  /** Zones assumed when a contact's own zone is unknown (all must allow the call). */
  zones: string[];
  name: string;
}

export const COUNTRIES: Readonly<Record<string, CountryInfo>> = Object.fromEntries(
  COUNTRY_ROWS.map(([iso, cc, trunk, len, zones, name]) => {
    const [min, max] = len.split("-").map(Number);
    return [iso, { iso, callingCode: cc, trunk, minLength: min, maxLength: max, zones: zones.split("|"), name }];
  }),
);

/** Calling code → countries (first = default when the national number doesn't decide). */
const BY_CODE = new Map<string, string[]>();
for (const [iso, cc] of COUNTRY_ROWS) BY_CODE.set(cc, [...(BY_CODE.get(cc) ?? []), iso]);

const NANP_AREAS: Record<string, string> = {};
const addAreas = (iso: string, codes: string) => {
  for (const c of codes.split(" ")) NANP_AREAS[c] = iso;
};
addAreas(
  "CA",
  "204 226 236 249 250 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 600 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942",
);
addAreas("PR", "787 939");
addAreas("DO", "809 829 849");
addAreas("JM", "876 658");
addAreas("TT", "868");
addAreas("BS", "242");
addAreas("BB", "246");
addAreas("BM", "441");
addAreas("GU", "671");

/** US states with stricter calling rules, by area code (used for the state presets). */
const US_STATE_AREAS: Record<string, string> = {};
const addState = (state: string, codes: string) => {
  for (const c of codes.split(" ")) US_STATE_AREAS[c] = state;
};
addState("FL", "239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954");
addState("OK", "405 539 572 580 918");
addState("TX", "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979");
addState("AL", "205 251 256 334 483 659 938");
addState("LA", "225 318 337 504 985");
addState("MS", "228 601 662 769");
addState("RI", "401");

/** Time zones of the US states with presets (all must allow the call when the contact's zone is unknown). */
const US_STATE_ZONES: Record<string, string[]> = {
  FL: ["America/New_York", "America/Chicago"],
  OK: ["America/Chicago"],
  TX: ["America/Chicago", "America/Denver"],
  AL: ["America/Chicago"],
  LA: ["America/Chicago"],
  MS: ["America/Chicago"],
  RI: ["America/New_York"],
};

export interface PhoneInfo {
  /** "+14155550123" */
  e164: string;
  /** ISO country ("" = calling code outside the built-in table). */
  country: string;
  callingCode: string;
  /** National significant number (no trunk prefix). */
  national: string;
}

export function countryInfo(iso: unknown): CountryInfo | null {
  return typeof iso === "string" ? (COUNTRIES[iso.toUpperCase()] ?? null) : null;
}

function resolveDigits(digits: string): PhoneInfo | null {
  if (digits.length < 7 || digits.length > 15 || digits.startsWith("0")) return null;
  for (const len of [1, 2, 3]) {
    const cc = digits.slice(0, len);
    const isos = BY_CODE.get(cc);
    if (!isos) continue;
    const national = digits.slice(len);
    if (cc === "1") {
      // NANP: NXX-NXX-XXXX.
      if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;
      return { e164: `+${digits}`, country: NANP_AREAS[national.slice(0, 3)] ?? "US", callingCode: cc, national };
    }
    let iso = isos[0];
    if (cc === "7") iso = /^[67]/.test(national) ? "KZ" : "RU";
    const info = COUNTRIES[iso];
    if (national.length < info.minLength || national.length > info.maxLength) return null;
    return { e164: `+${digits}`, country: iso, callingCode: cc, national };
  }
  // A calling code outside the table: keep the number, country unknown.
  return digits.length >= 8 ? { e164: `+${digits}`, country: "", callingCode: "", national: "" } : null;
}

/**
 * Parses a phone number typed in any common way ("+44 (0)20 7946 0018", "0044…", "(415) 555-0123"
 * with defaultCountry "US", "098765 43210" with "IN") into E.164. null = not a valid number.
 * Extensions ("x12", "ext. 12") are dropped.
 */
export function parsePhone(input: unknown, defaultCountry = ""): PhoneInfo | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  let s = String(input).trim().slice(0, 40);
  s = s.replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}$/i, "");
  // "+44 (0)20…": the bracketed trunk zero is not dialed from abroad.
  s = s.replace(/\(0\)/g, "");
  if (/[a-z]/i.test(s)) return null;
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (plus) return resolveDigits(digits);
  if (digits.startsWith("00")) return resolveDigits(digits.slice(2));
  const home = countryInfo(defaultCountry);
  if (home?.callingCode === "1" && digits.startsWith("011")) return resolveDigits(digits.slice(3));
  if (!home) return digits.length >= 11 ? resolveDigits(digits) : null;
  let national = digits;
  if (home.callingCode === "1") {
    if (national.length === 11 && national.startsWith("1")) national = national.slice(1);
  } else if (home.trunk && national.startsWith(home.trunk) && national.length - home.trunk.length >= home.minLength) {
    national = national.slice(home.trunk.length);
  }
  // Typed with the calling code but without "+" ("4915112345678" with DE).
  if (national.length > home.maxLength && national.startsWith(home.callingCode)) return resolveDigits(national);
  const parsed = resolveDigits(home.callingCode + national);
  // A NANP number typed for "US" may belong to Canada etc.: resolveDigits() decides by area code.
  return parsed;
}

/** E.164 string or "" when invalid. */
export function normalizePhone(input: unknown, defaultCountry = ""): string {
  return parsePhone(input, defaultCountry)?.e164 ?? "";
}

/** True for a well-formed, valid E.164 string. */
export function isValidE164(v: unknown): v is string {
  return typeof v === "string" && /^\+[1-9]\d{6,14}$/.test(v) && parsePhone(v)?.e164 === v;
}

/** The US state (two letters) of a +1 number when it has a calling-hours preset, else "". */
export function usStateOfNumber(e164: string): string {
  const p = parsePhone(e164);
  return p && p.country === "US" ? (US_STATE_AREAS[p.national.slice(0, 3)] ?? "") : "";
}

/** "+1 415 555 0123"-style display (groups of 3–4 digits; exact national formats are not attempted). */
export function formatPhone(e164: string): string {
  const p = parsePhone(e164);
  if (!p) return e164;
  if (p.callingCode === "1") return `+1 ${p.national.slice(0, 3)} ${p.national.slice(3, 6)} ${p.national.slice(6)}`;
  if (!p.callingCode) return e164;
  const groups = p.national.replace(/(\d{3,4})(?=\d{3})/g, "$1 ");
  return `+${p.callingCode} ${groups}`;
}

/** Countries of the EU, the EEA and the UK (ePrivacy / PECR consent rules for automated calls). */
export const EU_UK_COUNTRIES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB",
];

/**
 * Zones to check calling hours in: the contact's own zone when known, else every zone of the US
 * state preset / the country (the call must be allowed in all of them), else UTC.
 */
export function zonesForContact(contact: { timezone?: string | null; country?: string | null; state?: string | null; phone?: string }): string[] {
  if (contact.timezone && isValidTimeZone(contact.timezone)) return [canonicalTimeZone(contact.timezone)];
  const parsed = contact.phone ? parsePhone(contact.phone) : null;
  const country = (contact.country || parsed?.country || "").toUpperCase();
  const state = (contact.state || (parsed && country === "US" ? usStateOfNumber(parsed.e164) : "")).toUpperCase();
  if (country === "US" && US_STATE_ZONES[state]) return US_STATE_ZONES[state];
  return COUNTRIES[country]?.zones ?? ["UTC"];
}

// ── Calling hours ──

/** Per ISO weekday window ("HH:MM"–"HH:MM", end exclusive), null = no calls that day. */
export type DayWindows = Record<number, { start: string; end: string } | null>;

export interface CallingRules {
  windows: DayWindows;
  /** Local days without calls. */
  holidays: string[];
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Stricter US state rules (research notes, verify before relying on them). Missing days = the base window. */
const US_STATE_PRESETS: Record<string, Partial<DayWindows>> = {
  FL: Object.fromEntries(ALL_DAYS.map((d) => [d, { start: "08:00", end: "20:00" }])),
  OK: Object.fromEntries(ALL_DAYS.map((d) => [d, { start: "08:00", end: "20:00" }])),
  TX: { ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, { start: "09:00", end: "21:00" }])), 7: { start: "12:00", end: "21:00" } },
  AL: { 7: null },
  LA: { 7: null },
  MS: { 7: null },
  RI: { ...Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { start: "09:00", end: "18:00" }])), 6: null, 7: null },
};

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

function intersect(a: { start: string; end: string } | null, b: { start: string; end: string } | null | undefined): { start: string; end: string } | null {
  if (!a) return null;
  if (b === undefined) return a;
  if (b === null) return null;
  const start = later(a.start, b.start);
  const end = earlier(a.end, b.end);
  return start < end ? { start, end } : null;
}

/**
 * The effective rules of one call: the workspace's calling hours, intersected with the campaign's
 * window and, for US contacts in a preset state, the state's stricter hours.
 */
export function buildCallingRules(base: CallingWindow, options: { campaign?: CallingWindow | null; usState?: string; usStatePresets?: boolean; holidays?: string[] } = {}): CallingRules {
  const windows: DayWindows = {};
  const preset = options.usStatePresets && options.usState ? US_STATE_PRESETS[options.usState.toUpperCase()] : undefined;
  for (const d of ALL_DAYS) {
    let w: { start: string; end: string } | null = base.days.includes(d) ? { start: base.start, end: base.end } : null;
    if (options.campaign) w = intersect(w, options.campaign.days.includes(d) ? { start: options.campaign.start, end: options.campaign.end } : null);
    if (preset && d in preset) w = intersect(w, preset[d]);
    windows[d] = w && w.start < w.end ? w : null;
  }
  return { windows, holidays: options.holidays ?? [] };
}

function allowedIn(tz: string, rules: CallingRules, ms: number): "ok" | "holiday" | "hours" {
  const p = zonedParts(ms, tz);
  const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (rules.holidays.includes(day)) return "holiday";
  const w = rules.windows[p.weekday];
  if (!w) return "hours";
  const t = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  return t >= w.start && t < w.end ? "ok" : "hours";
}

/**
 * True when `now` is inside the calling window in the contact's zone — or in EVERY zone given
 * (an unknown zone is checked against all zones of the country). DST is handled by Intl.
 */
export function isWithinCallingHours(contactTz: string | readonly string[], rules: CallingRules, now: number | Date = Date.now()): boolean {
  const ms = typeof now === "number" ? now : now.getTime();
  const zones = typeof contactTz === "string" ? [contactTz] : contactTz.length ? contactTz : ["UTC"];
  return zones.every((tz) => allowedIn(tz, rules, ms) === "ok");
}

/** Why a time is outside the window: "holiday" beats "hours"; null when inside. */
export function callingHoursBlock(contactTz: string | readonly string[], rules: CallingRules, now: number): "holiday" | "hours" | null {
  const zones = typeof contactTz === "string" ? [contactTz] : contactTz.length ? contactTz : ["UTC"];
  let block: "holiday" | "hours" | null = null;
  for (const tz of zones) {
    const r = allowedIn(tz, rules, now);
    if (r === "holiday") return "holiday";
    if (r === "hours") block = "hours";
  }
  return block;
}

/** The next instant (minute precision, up to 14 days ahead) the call is allowed; null when never. */
export function nextCallingTime(contactTz: string | readonly string[], rules: CallingRules, now: number): number | null {
  const step = 15 * 60_000;
  const start = Math.ceil(now / 60_000) * 60_000;
  if (isWithinCallingHours(contactTz, rules, start)) return start;
  for (let t = Math.ceil(start / step) * step, end = start + 14 * 86_400_000; t <= end; t += step) {
    if (!isWithinCallingHours(contactTz, rules, t)) continue;
    // Refine to the first allowed minute of this 15-minute step.
    for (let m = t - step + 60_000; m < t; m += 60_000) if (m >= start && isWithinCallingHours(contactTz, rules, m)) return m;
    return t;
  }
  return null;
}

// ── Compliance settings ──

export const DEFAULT_CALLING_HOURS: CallingWindow = { start: "08:00", end: "21:00", days: [1, 2, 3, 4, 5, 6, 7] };

export const DEFAULT_RECORDING_NOTICE = "This call is recorded for quality and training purposes.";

export function normalizeCallingWindow(v: unknown, fallback: CallingWindow = DEFAULT_CALLING_HOURS): CallingWindow {
  const o = asObj(v);
  const start = normalizeTime(o.start) || fallback.start;
  const end = normalizeTime(o.end) || fallback.end;
  const days = "days" in o ? normalizeDays(o.days) : [...fallback.days];
  return start < end ? { start, end, days } : { ...fallback, days: [...fallback.days] };
}

const isoList = (v: unknown) => list(v, 250, (s) => (/^[A-Za-z]{2}$/.test(s.trim()) ? s.trim().toUpperCase() : ""));

export const DEFAULT_COMPLIANCE: ComplianceSettings = {
  businessName: "",
  callbackNumber: "",
  callingHours: DEFAULT_CALLING_HOURS,
  usStatePresets: true,
  holidays: [],
  maxCallsPer24h: 3,
  maxCallsPer30d: 0,
  recordingDisclosure: true,
  recordingDisclosureText: DEFAULT_RECORDING_NOTICE,
  indiaDltRoute: "",
  euRequireConsent: true,
  blockedCountries: [],
  allowedCountries: [],
  optOutPhrases: [],
  recordingRetentionDays: 90,
  transcriptRetentionDays: 365,
};

/** compliance_settings.settings with defaults. */
export function normalizeComplianceSettings(input: unknown): ComplianceSettings {
  const o = asObj(input);
  const route = str(o.indiaDltRoute, "", 4);
  return {
    businessName: str(o.businessName, "", 120),
    callbackNumber: normalizePhone(o.callbackNumber),
    callingHours: normalizeCallingWindow(o.callingHours),
    usStatePresets: bool(o.usStatePresets, true),
    holidays: list(o.holidays, 60, normalizeDay),
    maxCallsPer24h: int(o.maxCallsPer24h, 3, 0, 50),
    maxCallsPer30d: int(o.maxCallsPer30d, 0, 0, 500),
    recordingDisclosure: bool(o.recordingDisclosure, true),
    recordingDisclosureText: str(o.recordingDisclosureText, "", 300) || DEFAULT_RECORDING_NOTICE,
    indiaDltRoute: route === "140" || route === "1600" ? route : "",
    euRequireConsent: bool(o.euRequireConsent, true),
    blockedCountries: isoList(o.blockedCountries),
    allowedCountries: isoList(o.allowedCountries),
    optOutPhrases: list(o.optOutPhrases, 50, (s) => str(s, "", 80)),
    recordingRetentionDays: int(o.recordingRetentionDays, 90, 0, 3650),
    transcriptRetentionDays: int(o.transcriptRetentionDays, 365, 0, 3650),
  };
}

export function isConsentType(v: unknown): v is ConsentType {
  return typeof v === "string" && (CONSENT_TYPES as readonly string[]).includes(v);
}

export function normalizeConsentSource(v: unknown): ConsentSource {
  return oneOf(CONSENT_SOURCES, v, "other");
}

export function normalizeCampaignPurpose(v: unknown): CampaignPurpose {
  return oneOf(CAMPAIGN_PURPOSES, v, "informational");
}

export function normalizeRetryOn(v: unknown): RetryableOutcome[] {
  if (!Array.isArray(v)) return ["no_answer", "busy"];
  return RETRYABLE_OUTCOMES.filter((o) => v.includes(o));
}

// ── Dial-time compliance check ──

/** Consent types that satisfy a purpose (research notes, PRODUCT-9-TECH.md §3). */
const CONSENT_FOR: Record<CampaignPurpose, readonly ConsentType[]> = {
  telemarketing: ["pewc", "ai_voice"],
  informational: ["pec", "pewc", "ai_voice", "marketing"],
};
const EU_MARKETING_CONSENT: readonly ConsentType[] = ["ai_voice", "marketing", "pewc"];

export interface CanDialInput {
  contact: { phone: string; timezone?: string | null; country?: string | null; state?: string | null; optedOut?: boolean };
  /** The contact's consent records (revoked and expired ones included: they explain the block). */
  consent: Consent[];
  /** DNC entries matching the number (workspace and global). */
  dnc: DncMatch[];
  /** null for a single call outside a campaign (REST API, dashboard). */
  campaign: { status: CampaignStatus; purpose: CampaignPurpose; window: CallingWindow | null } | null;
  compliance: ComplianceSettings;
  now: number;
  /** Calls already placed to this number: in the last 24 hours and the last 30 days. */
  countsToday: { last24h: number; last30d: number };
  /** Purpose of a call outside a campaign (default "informational"). */
  purpose?: CampaignPurpose;
  /** Plan allows outbound, the workspace is approved and no kill switch is on. */
  outboundAllowed?: boolean;
}

/**
 * Every rule that blocks this call right now, in a stable order. ok = no reasons. For time-based
 * blocks `retryAt` is the next allowed instant. Runs at dial time (campaign engine, API, dashboard).
 */
export function canDial(input: CanDialInput): DialCheckResult {
  const reasons: DialBlockReason[] = [];
  let retryAt: string | null = null;
  const add = (r: DialBlockReason) => {
    if (!reasons.includes(r)) reasons.push(r);
  };
  if (input.outboundAllowed === false) add("outbound_disabled");
  if (input.campaign && input.campaign.status !== "running") add("campaign_inactive");

  const phone = parsePhone(input.contact.phone);
  if (!phone) {
    add("invalid_number");
    return { ok: false, reasons, retryAt: null };
  }
  const c = input.compliance;
  const country = (input.contact.country || phone.country).toUpperCase();
  const purpose = input.campaign?.purpose ?? input.purpose ?? "informational";

  if (c.blockedCountries.includes(country) || (c.allowedCountries.length > 0 && !c.allowedCountries.includes(country))) add("country_blocked");
  if (country === "IN" && purpose === "telemarketing" && !c.indiaDltRoute) add("india_dlt_required");

  const live = (d: DncMatch) => !d.expiresAt || d.expiresAt > new Date(input.now).toISOString();
  if (input.dnc.some((d) => d.scope === "workspace" && live(d))) add("dnc_workspace");
  if (input.dnc.some((d) => d.scope === "global" && live(d))) add("dnc_global");
  if (input.contact.optedOut) add("opted_out");

  const nowIso = new Date(input.now).toISOString();
  const matching = input.consent.filter((k) => k.purpose === "any" || k.purpose === purpose);
  const valid = matching.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > nowIso));
  const covers = (types: readonly ConsentType[]) => valid.some((k) => types.includes(k.type));
  if (!covers(CONSENT_FOR[purpose])) {
    const relevant = matching.filter((k) => CONSENT_FOR[purpose].includes(k.type));
    if (relevant.some((k) => k.revokedAt)) add("consent_revoked");
    else if (relevant.some((k) => k.expiresAt && k.expiresAt <= nowIso)) add("consent_expired");
    else add("no_consent");
  }
  if (c.euRequireConsent && purpose === "telemarketing" && EU_UK_COUNTRIES.includes(country) && !covers(EU_MARKETING_CONSENT)) add("eu_consent_required");

  const zones = zonesForContact({ timezone: input.contact.timezone, country, state: input.contact.state, phone: phone.e164 });
  const state = country === "US" ? (input.contact.state || usStateOfNumber(phone.e164)).toUpperCase() : "";
  const rules = buildCallingRules(c.callingHours, { campaign: input.campaign?.window ?? null, usState: state, usStatePresets: c.usStatePresets, holidays: c.holidays });
  const block = callingHoursBlock(zones, rules, input.now);
  if (block) {
    add(block === "holiday" ? "holiday" : "outside_hours");
    const next = nextCallingTime(zones, rules, input.now);
    retryAt = next === null ? null : new Date(next).toISOString();
  }

  if (c.maxCallsPer24h > 0 && input.countsToday.last24h >= c.maxCallsPer24h) add("frequency_24h");
  if (c.maxCallsPer30d > 0 && input.countsToday.last30d >= c.maxCallsPer30d) add("frequency_30d");

  return { ok: reasons.length === 0, reasons, retryAt };
}

// ── Opt-out detection ──

/** Built-in opt-out phrases (lower case; Arabic normalised with normalizeArabic()). */
const OPT_OUT_PHRASES: Record<"en" | "hi" | "ar", string[]> = {
  en: [
    "stop calling",
    "don't call me",
    "dont call me",
    "do not call me",
    "do not call this number",
    "don't call this number",
    "never call me",
    "no more calls",
    "remove me from your list",
    "remove me from the list",
    "remove my number",
    "take me off your list",
    "take me off the list",
    "put me on your do not call list",
    "add me to your do not call list",
    "unsubscribe",
    "opt out",
    "lose my number",
  ],
  hi: [
    "मुझे कॉल मत करो",
    "मुझे कॉल मत करना",
    "कॉल मत करो",
    "कॉल मत करना",
    "फोन मत करो",
    "फ़ोन मत करो",
    "दोबारा कॉल मत",
    "दुबारा कॉल मत",
    "फिर से कॉल मत",
    "मेरा नंबर हटा दो",
    "मेरा नंबर हटाओ",
    "लिस्ट से हटा दो",
    "mujhe call mat karo",
    "mujhe call mat karna",
    "call mat karo",
    "call mat karna",
    "phone mat karo",
    "dobara call mat",
    "dubara call mat",
    "mera number hata do",
    "number hata do",
  ],
  ar: [
    "لا تتصل بي",
    "لا تتصلوا بي",
    "لا تتصل مره اخري",
    "لا تتصلوا مره اخري",
    "توقف عن الاتصال",
    "توقفوا عن الاتصال",
    "احذف رقمي",
    "احذفوا رقمي",
    "ازل رقمي",
    "امسح رقمي",
    "لا اريد مكالمات",
    "لا تعاود الاتصال",
    "لا تكلمني مره اخري",
  ],
};

/** Phrases that contain an opt-out phrase but mean the opposite. */
const OPT_OUT_EXCEPTIONS = ["don't stop calling", "do not stop calling", "not unsubscribe", "don't unsubscribe"];

/** Arabic text without diacritics and with unified letter forms (أ إ آ → ا, ى → ي, ة → ه). */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

const normalizeForMatch = (s: string) =>
  normalizeArabic(s.toLowerCase())
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;:"()،؟।]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface OptOutResult {
  optOut: boolean;
  phrase: string;
  lang: "en" | "hi" | "ar" | "custom" | "";
}

/**
 * Looks for an opt-out request in what the CALLER said (agent and tool turns are ignored). Works
 * on English, Hindi (Devanagari and romanised) and Arabic, plus the workspace's own phrases.
 */
export function detectOptOut(transcript: string | readonly TranscriptTurn[], extraPhrases: readonly string[] = []): OptOutResult {
  const said = typeof transcript === "string" ? transcript : transcript.filter((t) => t.role === "caller").map((t) => t.text).join(" \n ");
  const hay = ` ${normalizeForMatch(said)} `;
  if (!hay.trim()) return { optOut: false, phrase: "", lang: "" };
  const cleaned = OPT_OUT_EXCEPTIONS.reduce((h, e) => h.split(e).join(" "), hay);
  const groups: Array<["en" | "hi" | "ar" | "custom", readonly string[]]> = [["custom", extraPhrases], ["en", OPT_OUT_PHRASES.en], ["hi", OPT_OUT_PHRASES.hi], ["ar", OPT_OUT_PHRASES.ar]];
  for (const [lang, phrases] of groups) {
    for (const raw of phrases) {
      const phrase = normalizeForMatch(raw);
      if (!phrase) continue;
      // Latin phrases must match whole words; other scripts match as substrings.
      const found = /^[\x20-\x7e]+$/.test(phrase) ? new RegExp(`(^|[^a-z'])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z'])`).test(cleaned) : cleaned.includes(phrase);
      if (found) return { optOut: true, phrase: raw, lang };
    }
  }
  return { optOut: false, phrase: "", lang: "" };
}

// ── AI disclosure ──

const DISCLOSURE_PATTERNS: RegExp[] = [
  /\b(?:a\.?i\.?|artificial intelligence|virtual (?:assistant|receptionist|agent)|automated (?:assistant|agent|system)|digital assistant|voice assistant|ai[- ](?:assistant|agent|receptionist))\b/i,
  /एआई|ए\.आई\.|आर्टिफिशियल इंटेलिजेंस|कृत्रिम बुद्धि|वर्चुअल असिस्टेंट|स्वचालित सहायक/,
  /ذكاء اصطناعي|الذكاء الاصطناعي|مساعد افتراضي|مساعد آلي|مساعد ذكي/,
  // Spanish, Portuguese, French, Italian: "inteligencia artificial", "asistente virtual", "asistente de IA", "soy una IA", "l'IA".
  /inteligencia artificial|inteligência artificial|intelligence artificielle|intelligenza artificiale/i,
  /\b(?:asistente|assistente|assistant|assistante|agente|agent|recepcionista|receptionniste|receptionist[ae]?) (?:virtual|virtuale?|virtuel(?:le)?|automatizad[oa]|automátic[oa]|automatique|automatico|automatizzat[oa]|vocal|vocale)\b/i,
  /\b(?:asistente|assistente|assistant|assistante|agente|agent)(?: virtuel(?:le)?| virtual)? (?:de |con |com |d'|d’|à |par |basad[oa] en |basé sur )?ia\b/i,
  /\b(?:una|la|une|uma|con|com|par|por|de) ia\b|\b(?:l|d|un|dell)['’]ia\b/i,
  // German: "künstliche Intelligenz", "KI-Assistent", "virtueller Assistent", "eine KI".
  /künstliche[nrs]? intelligenz|\bki[- ]?(?:assistent|assistentin|agent|agentin|gestützt|stimme|system)|\b(?:virtuelle[nrs]?|digitale[nrs]?|automatische[nrs]?) (?:assistent|assistentin|telefonassistent|telefonassistentin)\b|\b(?:eine|einer|einem|die|der) KI\b|sprachassistent/i,
];

/** True when the text tells the caller they are talking to an AI (en / hi / ar / es / pt / fr / it / de). */
export function hasAiDisclosure(message: string): boolean {
  return DISCLOSURE_PATTERNS.some((re) => re.test(message));
}

const DISCLOSURE_PREFIX: Record<string, string> = {
  en: "Hi, you're speaking with the AI assistant of {business}. ",
  hi: "नमस्ते, आप {business} के एआई असिस्टेंट से बात कर रहे हैं। ",
  ar: "مرحبًا، أنت تتحدث مع المساعد الذكي (ذكاء اصطناعي) لدى {business}. ",
  es: "Hola, le atiende el asistente de inteligencia artificial de {business}. ",
  pt: "Olá, aqui é o assistente de inteligência artificial de {business}. ",
  fr: "Bonjour, vous parlez avec l'assistant à intelligence artificielle de {business}. ",
  it: "Salve, sta parlando con l'assistente di intelligenza artificiale di {business}. ",
  de: "Hallo, Sie sprechen mit dem KI-Assistenten von {business}. ",
};
const BUSINESS_PREFIX: Record<string, string> = {
  en: "This call is from {business}. ",
  hi: "यह कॉल {business} की ओर से है। ",
  ar: "هذه المكالمة من {business}. ",
  es: "Esta llamada es de {business}. ",
  pt: "Esta chamada é de {business}. ",
  fr: "Cet appel provient de {business}. ",
  it: "Questa chiamata è di {business}. ",
  de: "Dieser Anruf kommt von {business}. ",
};

/**
 * The first message with the AI disclosure and the business name, as the EU AI Act Art. 50,
 * California AB 2905 and 47 CFR 64.1200(b) ask. A message that already discloses keeps its own
 * wording; otherwise a short sentence in the agent's language is put in front. Editable, never
 * removable.
 */
export function ensureDisclosure(firstMessage: string, businessName: string, lang = "en"): string {
  const message = text(firstMessage, 2000);
  const business = str(businessName, "", 120) || "our team";
  const code = lang.slice(0, 2).toLowerCase();
  const disclosed = hasAiDisclosure(message);
  const named = message.toLowerCase().includes(business.toLowerCase());
  if (disclosed && named) return message;
  const prefix = (disclosed ? (BUSINESS_PREFIX[code] ?? BUSINESS_PREFIX.en) : (DISCLOSURE_PREFIX[code] ?? DISCLOSURE_PREFIX.en)).replace("{business}", business);
  return `${prefix}${message}`.trim();
}

// ── Agents ──

export const DEFAULT_WIDGET: WidgetSettings = { enabled: false, allowedDomains: [], title: "Talk to us", color: "", position: "bottom-right" };

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxDurationSec: 600,
  silenceTimeoutSec: 20,
  interruptionSensitivity: "medium",
  temperature: 0.4,
  speed: 1,
  voicemailAction: "hangup",
  voicemailMessage: "",
  endCallConditions: ["The caller says goodbye or has no more questions."],
  transferNumber: "",
  recording: true,
  businessName: "",
  successCriteria: "",
  analysisFields: [],
  widget: DEFAULT_WIDGET,
};

const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** Post-call analysis fields: valid snake_case keys, distinct, at most 25. */
export function normalizeAnalysisFields(v: unknown): AnalysisField[] {
  if (!Array.isArray(v)) return [];
  const out: AnalysisField[] = [];
  for (const raw of v) {
    const o = asObj(raw);
    const key = str(o.key, "", 40)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!FIELD_KEY.test(key) || out.some((f) => f.key === key)) continue;
    const type = oneOf(ANALYSIS_FIELD_TYPES, o.type, "string");
    const options = type === "enum" ? list(o.options, 20, (s) => str(s, "", 60)) : [];
    if (type === "enum" && options.length < 2) continue;
    out.push({ key, label: str(o.label, "", 80) || key.replace(/_/g, " "), type, description: str(o.description, "", 300), options, required: bool(o.required, false) });
    if (out.length >= 25) break;
  }
  return out;
}

export function normalizeWidget(v: unknown): WidgetSettings {
  const o = asObj(v);
  const domains = list(o.allowedDomains, 20, (s) => {
    const d = s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(d) || /^localhost(:\d{1,5})?$/.test(d) ? d : "";
  });
  return {
    enabled: bool(o.enabled, false),
    allowedDomains: domains,
    title: str(o.title, "", 60) || DEFAULT_WIDGET.title,
    color: normalizeColor(o.color),
    position: o.position === "bottom-left" ? "bottom-left" : "bottom-right",
  };
}

/** agents.settings with defaults and safe ranges. */
export function normalizeAgentSettings(input: unknown): AgentSettings {
  const o = asObj(input);
  return {
    maxDurationSec: int(o.maxDurationSec, DEFAULT_AGENT_SETTINGS.maxDurationSec, 60, 3600),
    silenceTimeoutSec: int(o.silenceTimeoutSec, DEFAULT_AGENT_SETTINGS.silenceTimeoutSec, 5, 120),
    interruptionSensitivity: oneOf(INTERRUPTION_LEVELS, o.interruptionSensitivity, "medium"),
    temperature: Math.round(num(o.temperature, DEFAULT_AGENT_SETTINGS.temperature, 0, 1) * 100) / 100,
    speed: Math.round(num(o.speed, 1, 0.7, 1.3) * 100) / 100,
    voicemailAction: oneOf(VOICEMAIL_ACTIONS, o.voicemailAction, "hangup"),
    voicemailMessage: text(o.voicemailMessage, 600),
    endCallConditions: "endCallConditions" in o ? list(o.endCallConditions, 10, (s) => str(s, "", 200)) : [...DEFAULT_AGENT_SETTINGS.endCallConditions],
    transferNumber: normalizePhone(o.transferNumber),
    recording: bool(o.recording, true),
    businessName: str(o.businessName, "", 120),
    successCriteria: text(o.successCriteria, 600),
    analysisFields: normalizeAnalysisFields(o.analysisFields),
    widget: normalizeWidget(o.widget),
  };
}

export function normalizeAgentStatus(v: unknown): AgentStatus {
  return oneOf(AGENT_STATUSES, v, "draft");
}

/** BCP-47 tag ("en-US", "hi-IN", "ar") or `fallback`. */
export function normalizeLanguageTag(v: unknown, fallback = "en-US"): string {
  const s = str(v, "", 16);
  const m = /^([a-zA-Z]{2,3})(?:-([a-zA-Z]{2}|\d{3}))?$/.exec(s);
  return m ? (m[2] ? `${m[1].toLowerCase()}-${m[2].toUpperCase()}` : m[1].toLowerCase()) : fallback;
}

// ── Tools ──

export function isToolKind(v: unknown): v is ToolKind {
  return typeof v === "string" && (TOOL_KINDS as readonly string[]).includes(v);
}

/** Function name for the LLM: snake_case, 2–40 characters. */
export function normalizeToolName(v: unknown, fallback = "tool"): string {
  const s = str(v, "", 60)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z][a-z0-9_]{1,39}$/.test(s) ? s : fallback;
}

function normalizeParameters(v: unknown): ToolParameter[] {
  if (!Array.isArray(v)) return [];
  const out: ToolParameter[] = [];
  for (const raw of v) {
    const o = asObj(raw);
    const name = normalizeToolName(o.name, "");
    if (!name || out.some((p) => p.name === name)) continue;
    out.push({ name, type: o.type === "number" || o.type === "boolean" ? o.type : "string", description: str(o.description, "", 200), required: bool(o.required, false) });
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeWeeklyHours(v: unknown): WeeklyHours {
  const w = normalizeCallingWindow(v, { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] });
  return { start: w.start, end: w.end, days: w.days };
}

function headerMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(asObj(v)).slice(0, 10)) {
    const key = str(k, "", 60);
    if (/^[A-Za-z0-9-]{1,60}$/.test(key) && !/^(host|content-length|connection|transfer-encoding)$/i.test(key)) out[key] = str(val, "", 500);
  }
  return out;
}

/** A tool's settings with defaults (decrypted tools.config). */
export function normalizeToolConfig<K extends ToolKind>(kind: K, input: unknown): ToolConfigByKind[K] {
  const o = asObj(input);
  let out: unknown;
  switch (kind) {
    case "cal_com":
      out = { apiKey: str(o.apiKey, "", 200), eventTypeId: int(o.eventTypeId, 0, 0, 2_000_000_000), timezone: normalizeTimeZone(o.timezone), apiBase: httpUrl(o.apiBase) };
      break;
    case "google_calendar":
      out = {
        calendarId: str(o.calendarId, "primary", 200) || "primary",
        refreshToken: str(o.refreshToken, "", 1000),
        accountEmail: normalizeEmail(o.accountEmail),
        durationMin: int(o.durationMin, 30, 5, 480),
        bufferMin: int(o.bufferMin, 0, 0, 240),
        timezone: normalizeTimeZone(o.timezone),
        hours: normalizeWeeklyHours(o.hours),
      };
      break;
    case "webhook":
      out = {
        url: httpUrl(o.url),
        // POST only: the signature covers the JSON body (GET tools of older versions become POST).
        method: "POST",
        headers: headerMap(o.headers),
        secret: str(o.secret, "", 200),
        timeoutMs: int(o.timeoutMs, 3000, 500, 10_000),
        parameters: normalizeParameters(o.parameters),
      };
      break;
    case "google_sheets":
      out = {
        spreadsheetId: str(o.spreadsheetId, "", 200).replace(/[^A-Za-z0-9_-]/g, ""),
        sheetName: str(o.sheetName, "Sheet1", 100) || "Sheet1",
        refreshToken: str(o.refreshToken, "", 1000),
        accountEmail: normalizeEmail(o.accountEmail),
        columns: list(o.columns, 30, (s) => str(s, "", 60)),
      };
      break;
    case "transfer":
      out = { number: normalizePhone(o.number), mode: o.mode === "warm" ? "warm" : "cold", whisper: str(o.whisper, "", 300) };
      break;
    case "end_call":
      out = { instructions: str(o.instructions, "", 500) };
      break;
  }
  return out as ToolConfigByKind[K];
}

// ── Prompt variables ──

export interface PromptContact {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  /** Custom fields (CSV columns, API). */
  fields?: Record<string, unknown> | null;
}

/** Variables used in a template ("contact.first_name", "business_name"…), distinct. */
export function promptVariableNames(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|[^}]*)?\}\}/g)].map((m) => m[1]))];
}

/**
 * Fills {{contact.first_name}}, {{contact.name}}, {{contact.phone}}, {{contact.email}},
 * {{contact.company}}, {{contact.<custom field>}} and plain {{name}} values from `extra`
 * (business_name, agent_name, today…). "{{contact.first_name|there}}" falls back to "there";
 * unknown variables become "" (never sent to the caller as braces).
 */
export function renderPromptVariables(template: string, contact: PromptContact | null, extra: Record<string, string | number> = {}): string {
  const c = contact ?? {};
  const fields = asObj(c.fields);
  const contactValue = (key: string): string => {
    switch (key) {
      case "first_name":
        return str(c.firstName);
      case "last_name":
        return str(c.lastName);
      case "name":
        return [str(c.firstName), str(c.lastName)].filter(Boolean).join(" ");
      case "phone":
        return str(c.phone);
      case "email":
        return str(c.email);
      case "company":
        return str(c.company);
      default:
        return str(fields[key], "", 500);
    }
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g, (_m, name: string, fallback?: string) => {
    const value = name.startsWith("contact.") ? contactValue(name.slice(8)) : name in extra ? String(extra[name]) : "";
    return value || (fallback ?? "").trim();
  });
}

// ── Call tags (tenant metadata on provider calls) ──

const TAG_KEYS: Record<keyof CallTags, string> = { workspaceId: "dz_workspace_id", callId: "dz_call_id", agentId: "dz_agent_id", campaignId: "dz_campaign_id", contactId: "dz_contact_id" };

export const EMPTY_TAGS: CallTags = { workspaceId: null, callId: null, agentId: null, campaignId: null, contactId: null };

/** Our tags as provider metadata (string values only; missing ids left out). */
export function encodeCallTags(tags: Partial<CallTags>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, key] of Object.entries(TAG_KEYS) as Array<[keyof CallTags, string]>) {
    const v = tags[k];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) out[key] = String(v);
  }
  return out;
}

/** Tags back from provider metadata / dynamic variables (accepts strings or numbers). */
export function decodeCallTags(raw: unknown): CallTags {
  const o = asObj(raw);
  const id = (key: string) => {
    const v = o[key];
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,10}$/.test(v) ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  return { workspaceId: id(TAG_KEYS.workspaceId), callId: id(TAG_KEYS.callId), agentId: id(TAG_KEYS.agentId), campaignId: id(TAG_KEYS.campaignId), contactId: id(TAG_KEYS.contactId) };
}

// ── Credit maths (micros) ──

/** Seconds of a call reserved before dialing: the agent's max duration, at most 5 minutes. */
export const RESERVE_CAP_SEC = 300;

/** Credits held before a call starts: min(maxDuration, 5 min), rounded up to whole minutes, × price. */
export function estimateReserveMicros(maxDurationSec: number, pricePerMinMicros: number, capSec = RESERVE_CAP_SEC): number {
  const sec = Math.max(60, Math.min(Math.max(0, Math.floor(maxDurationSec)), capSec));
  const minutes = Math.ceil(sec / 60);
  return minutes * Math.max(0, Math.round(pricePerMinMicros));
}

/** Seconds billed for a call: rounded up per second, per 6 s or per started minute, with a minimum. */
export function billableSeconds(durationSec: number, rounding: BillingRounding, minimumSec = 0): number {
  const d = Math.max(0, durationSec);
  if (d === 0) return 0;
  const step = rounding === "per_minute" ? 60 : rounding === "per_6s" ? 6 : 1;
  const rounded = Math.ceil(Math.ceil(d) / step) * step;
  return Math.max(rounded, Math.max(0, Math.floor(minimumSec)));
}

/** The charge of `billedSec` seconds at a per-minute price, rounded UP to a whole micro. */
export function priceForSeconds(billedSec: number, pricePerMinMicros: number): number {
  const sec = Math.max(0, Math.floor(billedSec));
  const price = Math.max(0, Math.round(pricePerMinMicros));
  return Math.ceil((sec * price) / 60);
}

/** Billed seconds and amount of a finished call. */
export function settleMicros(durationSec: number, pricePerMinMicros: number, rounding: BillingRounding, minimumSec = 0): { billedSec: number; amountMicros: number } {
  const billedSec = billableSeconds(durationSec, rounding, minimumSec);
  return { billedSec, amountMicros: priceForSeconds(billedSec, pricePerMinMicros) };
}

/** Splits billed seconds into the part covered by the plan's remaining included minutes and the part charged to the wallet. */
export function splitIncluded(billedSec: number, includedRemainingSec: number): { includedSec: number; chargedSec: number } {
  const included = Math.max(0, Math.min(Math.floor(billedSec), Math.floor(includedRemainingSec)));
  return { includedSec: included, chargedSec: Math.max(0, Math.floor(billedSec) - included) };
}

/** Major currency units → micros ("0.15" → 150000). */
export function toMicros(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.round(n * 1_000_000) : fallback;
}

export function normalizeAutoRecharge(v: unknown): AutoRecharge {
  const o = asObj(v);
  return { enabled: bool(o.enabled, false), thresholdMicros: int(o.thresholdMicros, 5_000_000, 0, 1e12), amountMicros: int(o.amountMicros, 20_000_000, 0, 1e12) };
}

// ── Workspaces, roles and settings ──

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export function isWorkspaceRole(v: unknown): v is WorkspaceRole {
  return typeof v === "string" && (WORKSPACE_ROLES as readonly string[]).includes(v);
}

export function isAssignableRole(v: unknown): v is AssignableRole {
  return typeof v === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(v);
}

/** True when `role` ranks at least `min` (viewer < editor < admin < owner). */
export function roleAtLeast(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

const CAPABILITIES: Record<WorkspaceCapability, readonly WorkspaceRole[]> = {
  view: ["viewer", "editor", "admin", "owner"],
  "agents.manage": ["editor", "admin", "owner"],
  "contacts.manage": ["editor", "admin", "owner"],
  "campaigns.edit": ["editor", "admin", "owner"],
  // Starting outbound calls is a compliance decision: admins only.
  "campaigns.run": ["admin", "owner"],
  "numbers.manage": ["admin", "owner"],
  "billing.manage": ["admin", "owner"],
  "compliance.manage": ["admin", "owner"],
  "members.manage": ["admin", "owner"],
  "settings.manage": ["admin", "owner"],
  "workspace.delete": ["owner"],
};

export function roleCan(role: WorkspaceRole, capability: WorkspaceCapability): boolean {
  return CAPABILITIES[capability].includes(role);
}

/** An admin can't change the owner or make someone owner; only the owner manages admins. */
export function canManageMember(actor: WorkspaceRole, member: WorkspaceRole, newRole?: WorkspaceRole): boolean {
  if (!roleCan(actor, "members.manage") || member === "owner" || newRole === "owner") return false;
  if (actor === "owner") return true;
  return member !== "admin" && newRole !== "admin";
}

function normalizeBranding(v: unknown): WorkspaceBranding {
  const o = asObj(v);
  const logo = str(o.logo, "", 500);
  return { companyName: str(o.companyName, "", 120), logo: /^(https?:\/\/|\/|[\w./-]+$)/.test(logo) ? logo : "", color: normalizeColor(o.color) };
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  defaultCountry: "US",
  defaultLanguage: "en-US",
  weekStart: 1,
  branding: { companyName: "", logo: "", color: "" },
};

/** workspaces.settings with defaults. */
export function normalizeWorkspaceSettings(input: unknown): WorkspaceSettings {
  const o = asObj(input);
  const country = str(o.defaultCountry, "", 2).toUpperCase();
  return {
    defaultCountry: COUNTRIES[country] ? country : DEFAULT_WORKSPACE_SETTINGS.defaultCountry,
    defaultLanguage: normalizeLanguageTag(o.defaultLanguage, DEFAULT_WORKSPACE_SETTINGS.defaultLanguage),
    weekStart: o.weekStart === 7 || o.weekStart === "7" ? 7 : 1,
    branding: normalizeBranding(o.branding),
  };
}

// ── Notification channels ──

export function isNotifyChannelType(v: unknown): v is NotifyChannelType {
  return typeof v === "string" && (NOTIFY_CHANNEL_TYPES as readonly string[]).includes(v);
}

export function normalizeNotifyEvents(v: unknown): NotifyEvent[] {
  if (!Array.isArray(v)) return [...DEFAULT_NOTIFY_EVENTS];
  return NOTIFY_EVENTS.filter((e) => e !== "test" && v.includes(e));
}

export function normalizeNotifyConfig<T extends NotifyChannelType>(type: T, input: unknown): NotifyConfigByType[T] {
  const o = asObj(input);
  let out: unknown;
  switch (type) {
    case "email":
      out = {
        to: str(o.to, "", 1000)
          .split(/[,;\s]+/)
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
          .slice(0, 10)
          .join(", "),
      };
      break;
    case "webhook":
      out = { url: httpUrl(o.url), secret: str(o.secret, "", 200) };
      break;
    case "slack":
    case "discord":
    case "teams":
      out = { webhookUrl: httpUrl(o.webhookUrl) };
      break;
    case "telegram":
      out = { botToken: str(o.botToken, "", 100).replace(/[^A-Za-z0-9:_-]/g, ""), chatId: str(o.chatId, "", 40).replace(/[^0-9@A-Za-z_-]/g, "") };
      break;
  }
  return out as NotifyConfigByType[T];
}

export function notifyConfigProblem(type: NotifyChannelType, config: unknown): string {
  const c = asObj(config);
  if (type === "email" && !c.to) return "Enter at least one valid email address.";
  if (type === "webhook" && !c.url) return "Enter the webhook URL (https://…).";
  if ((type === "slack" || type === "discord" || type === "teams") && !c.webhookUrl) return "Paste the incoming webhook URL.";
  if (type === "telegram" && (!c.botToken || !c.chatId)) return "Enter the bot token and the chat ID.";
  return "";
}
