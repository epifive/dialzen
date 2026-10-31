/**
 * Formatting helpers for the customer dashboard. Dependency-free so they work
 * in Server Components and client components alike.
 */

export function formatNumber(n: number, locale: string, options?: Intl.NumberFormatOptions): string {
  try {
    return n.toLocaleString(locale, options);
  } catch {
    return n.toLocaleString("en", options);
  }
}

/** "PayPal and Bank transfer" / "PayPal وتحويل بنكي": a list in the reader's language. */
export function formatList(items: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  } catch {
    return items.join(listSeparator(locale));
  }
}

/** Languages written in Arabic script, which use the Arabic comma "،". */
const ARABIC_COMMA = /^(ar|fa|ur|ps|ckb|sd|ug)(-|$)/i;

/** Separator between the parts of one line (tooltips, screen-reader text): "، " in Arabic, ", " in English. */
export function listSeparator(locale: string): string {
  return ARABIC_COMMA.test(locale) ? "، " : ", ";
}

export function formatDateTime(iso: string | null | undefined, locale: string, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) };
  try {
    return d.toLocaleString(locale, options);
  } catch {
    return d.toLocaleString("en", options);
  }
}

/** Short time of day ("14:05") for chart axes. */
export function formatTime(iso: string, locale: string, withDay = false): string {
  const d = new Date(iso);
  const options: Intl.DateTimeFormatOptions = withDay ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" };
  try {
    return d.toLocaleString(locale, options);
  } catch {
    return d.toLocaleString("en", options);
  }
}

/** "Mon, Oct 12" for a YYYY-MM-DD day (UTC). */
export function formatDay(day: string, locale: string, long = false): string {
  const d = new Date(`${day}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions = long
    ? { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }
    : { month: "short", day: "numeric", timeZone: "UTC" };
  try {
    return d.toLocaleDateString(locale, options);
  } catch {
    return d.toLocaleDateString("en", options);
  }
}

/** "3 minutes ago" / "in 2 days" in the visitor's language. */
export function formatRelative(iso: string | null | undefined, locale: string, nowMs = Date.now()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const seconds = Math.round((at - nowMs) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ];
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  if (Math.abs(seconds) < 45) return rtf.format(0, "second");
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

/** Positive integer from a query-string value (page numbers). */
export function intParam(value: string | string[] | undefined, fallback: number, max = 100_000): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}
