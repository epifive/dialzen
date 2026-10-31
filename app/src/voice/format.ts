/**
 * Display helpers shared by server and client components (dashboard, emails, exports): call
 * durations, money in micros, status tones, provider and language names, limits. Dependency-free.
 */

import type { AgentStatus, CallDirection, CallStatus, CampaignContactState, CampaignStatus, EndReason, KycStatus, NumberStatus, OutboundState, ProviderId, Sentiment, SyncStatus } from "./types";

// ── Providers and languages ──

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  elevenlabs: "ElevenLabs Agents",
  retell: "Retell AI",
  simulated: "Simulated (demo)",
};

/** Translator shape for provider names (server getT() and client useT() both fit). */
type ProviderT = (key: "dash.provider.simulated") => string;

/**
 * Display name of a voice provider. Brand names stay as they are; pass `t` where the reader's
 * language applies (the dashboard) so the simulated provider's label is translated.
 */
export function providerName(id: string, t?: ProviderT): string {
  if (id === "simulated" && t) return t("dash.provider.simulated");
  return PROVIDER_NAMES[id as ProviderId] ?? id;
}

/** Spoken languages offered in the agent builder (both v1 providers support these). */
export const AGENT_LANGUAGES: ReadonlyArray<{ tag: string; name: string }> = [
  { tag: "en-US", name: "English (US)" },
  { tag: "en-GB", name: "English (UK)" },
  { tag: "en-AU", name: "English (Australia)" },
  { tag: "en-IN", name: "English (India)" },
  { tag: "hi-IN", name: "Hindi" },
  { tag: "ar-SA", name: "Arabic" },
  { tag: "es-ES", name: "Spanish (Spain)" },
  { tag: "es-MX", name: "Spanish (Mexico)" },
  { tag: "fr-FR", name: "French" },
  { tag: "de-DE", name: "German" },
  { tag: "it-IT", name: "Italian" },
  { tag: "pt-BR", name: "Portuguese (Brazil)" },
  { tag: "pt-PT", name: "Portuguese (Portugal)" },
  { tag: "nl-NL", name: "Dutch" },
  { tag: "pl-PL", name: "Polish" },
  { tag: "tr-TR", name: "Turkish" },
  { tag: "ja-JP", name: "Japanese" },
  { tag: "ko-KR", name: "Korean" },
  { tag: "zh-CN", name: "Chinese (Mandarin)" },
];

export function languageName(tag: string): string {
  return AGENT_LANGUAGES.find((l) => l.tag === tag)?.name ?? AGENT_LANGUAGES.find((l) => l.tag.startsWith(`${tag.slice(0, 2)}-`))?.name ?? tag;
}

// ── Durations and money ──

/** "0:42", "4:05", "1:02:03". */
export function formatDuration(totalSec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(totalSec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Seconds → whole minutes, rounded up ("billed minutes"). */
export function minutesOf(sec: number): number {
  return Math.ceil(Math.max(0, sec) / 60);
}

/** Seconds as minutes with one decimal ("12.5"), for usage meters. */
export function formatMinutes(sec: number, locale = "en-US"): string {
  const min = Math.max(0, sec) / 60;
  return min.toLocaleString(locale, { maximumFractionDigits: min < 10 ? 1 : 0 });
}

const plainSymbols = new Map<string, string>();

/**
 * The sign English shows for a currency when it is a plain, unambiguous sign ($, €, £, ¥, ₹ …),
 * else "". CA$, A$ or CN¥ stay as they are, and so do letter codes (AED).
 */
function plainSymbol(currency: string): string {
  const code = currency.toUpperCase();
  let symbol = plainSymbols.get(code);
  if (symbol === undefined) {
    try {
      const sign = (currencyDisplay: "narrowSymbol" | "symbol") =>
        new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay }).formatToParts(1).find((p) => p.type === "currency")?.value ?? "";
      const narrow = sign("narrowSymbol");
      symbol = narrow === sign("symbol") && !/[A-Za-z]/.test(narrow) ? narrow : "";
    } catch {
      symbol = "";
    }
    plainSymbols.set(code, symbol);
  }
  return symbol;
}

/**
 * Intl currency formatting in the reader's language with the plain sign where there is one
 * (some languages spell even common signs out, "US$" in Arabic). Throws like Intl.NumberFormat
 * on an unknown currency.
 */
export function formatCurrency(value: number, currency: string, locale: string, options: Intl.NumberFormatOptions = {}): string {
  const symbol = plainSymbol(currency);
  const nf = new Intl.NumberFormat(locale, { style: "currency", currency, ...(symbol ? { currencyDisplay: "narrowSymbol" } : {}), ...options });
  if (!symbol) return nf.format(value);
  return nf
    .formatToParts(value)
    .map((p) => (p.type === "currency" ? symbol : p.value))
    .join("");
}

/**
 * Money stored in micros: "$12.50", per-minute prices with up to 4 decimals ("$0.1450").
 * `precise` keeps sub-cent amounts (prices per minute, provider costs).
 */
export function formatMicros(micros: number, currency: string, locale = "en-US", precise = false): string {
  const value = (Number(micros) || 0) / 1_000_000;
  const fraction = precise ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try {
    return formatCurrency(value, currency, locale, fraction);
  } catch {
    return `${value.toFixed(precise ? 4 : 2)} ${currency}`;
  }
}

/** Translator shape accepted by these helpers (server getT() and client useT() both fit). */
type LimitT = (key: "pricing.unlimited") => string;

/** A plan limit: -1 → "Unlimited", otherwise a grouped number (0 shows as 0). */
export function formatLimit(value: number, t: LimitT, locale?: string): string {
  return value < 0 ? t("pricing.unlimited") : value.toLocaleString(locale);
}

// ── Status tones (Tailwind classes of badges) ──

export const TONE = {
  neutral: "bg-line/70 text-muted",
  info: "bg-primary-soft text-primary",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

export function callStatusTone(status: CallStatus): string {
  switch (status) {
    case "completed":
      return TONE.good;
    case "queued":
    case "ringing":
    case "in_progress":
      return TONE.info;
    case "no_answer":
    case "busy":
    case "voicemail":
      return TONE.warn;
    case "failed":
      return TONE.bad;
    default:
      return TONE.neutral;
  }
}

export function sentimentTone(sentiment: Sentiment): string {
  return sentiment === "positive" ? TONE.good : sentiment === "negative" ? TONE.bad : TONE.neutral;
}

export function agentStatusTone(status: AgentStatus): string {
  return status === "active" ? TONE.good : status === "paused" ? TONE.warn : TONE.neutral;
}

export function syncStatusTone(status: SyncStatus): string {
  return status === "synced" ? TONE.good : status === "error" ? TONE.bad : TONE.warn;
}

export function numberStatusTone(status: NumberStatus): string {
  return status === "active" ? TONE.good : status === "error" ? TONE.bad : status === "pending" ? TONE.warn : TONE.neutral;
}

export function kycStatusTone(status: KycStatus | OutboundState): string {
  if (status === "approved") return TONE.good;
  if (status === "rejected" || status === "suspended") return TONE.bad;
  if (status === "pending") return TONE.warn;
  return TONE.neutral;
}

export function campaignStatusTone(status: CampaignStatus): string {
  switch (status) {
    case "running":
      return TONE.good;
    case "scheduled":
      return TONE.info;
    case "paused":
      return TONE.warn;
    case "canceled":
      return TONE.bad;
    default:
      return TONE.neutral;
  }
}

export function campaignContactTone(state: CampaignContactState): string {
  if (state === "completed") return TONE.good;
  if (state === "failed") return TONE.bad;
  if (state === "dialing" || state === "in_call") return TONE.info;
  if (state === "retry") return TONE.warn;
  return TONE.neutral;
}

/** Final statuses that count as "answered" in analytics. */
export function isAnswered(status: CallStatus): boolean {
  return status === "completed";
}

export function directionArrow(direction: CallDirection): "in" | "out" | "web" {
  return direction === "inbound" ? "in" : direction === "outbound" ? "out" : "web";
}

/** English label of an end reason (exports and notifications; the dashboard translates its own). */
export const END_REASON_LABELS: Record<EndReason, string> = {
  caller_hangup: "Caller hung up",
  agent_hangup: "Agent ended the call",
  transferred: "Transferred to a person",
  voicemail: "Reached voicemail",
  no_answer: "No answer",
  busy: "Busy",
  max_duration: "Maximum duration reached",
  silence_timeout: "Silence timeout",
  opt_out: "Caller opted out",
  rejected: "Rejected",
  canceled: "Canceled",
  error: "Error",
  unknown: "Unknown",
};
