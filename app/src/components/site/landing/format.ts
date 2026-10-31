/** Formatting helpers and the example data of the landing page illustrations (fictional businesses). */

import { formatCurrency } from "@/voice/format";

/** A grouped number in the visitor's locale. */
export function num(n: number, locale: string, options?: Intl.NumberFormatOptions): string {
  try {
    return n.toLocaleString(locale, options);
  } catch {
    return n.toLocaleString("en", options);
  }
}

/** 12400 → "12K" in the visitor's locale. */
export function compact(n: number, locale: string): string {
  return num(n, locale, { notation: "compact", maximumFractionDigits: 1 });
}

/** A percentage ("38.4%") in the visitor's locale; `value` is 0–100. */
export function pct(value: number, locale: string, digits = 1): string {
  return num(value / 100, locale, { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/**
 * An example amount in US dollars ("$48.20", "$0.15"). The illustrations use dollars whatever the
 * site currency is, so the per-minute prices stay realistic.
 */
export function usd(value: number, locale: string, digits = 2): string {
  try {
    // Same "$" as the dashboard in every language (Arabic would spell it "US$").
    return formatCurrency(value, "USD", locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    return `$${value.toFixed(digits)}`;
  }
}

/** Monday 19 October 2026 (UTC): the reference week of every illustration. */
const MONDAY = Date.UTC(2026, 9, 19);

/** Weekday name of an ISO weekday (1 = Monday … 7 = Sunday). */
export function weekdayName(day: number, locale: string, style: "narrow" | "short" | "long" = "short"): string {
  const at = new Date(MONDAY + (day - 1) * 86_400_000);
  try {
    return at.toLocaleDateString(locale, { weekday: style, timeZone: "UTC" });
  } catch {
    return at.toLocaleDateString("en", { weekday: style, timeZone: "UTC" });
  }
}

/** A wall-clock time, 24 h ("09:00"), in the visitor's digits. */
export function clock(hour: number, minute: number, locale: string): string {
  const at = new Date(Date.UTC(2026, 9, 19, hour, minute));
  try {
    return at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
  } catch {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
}

/** A date of the reference week ("22 October"), in the visitor's locale. */
export function dateLabel(day: number, locale: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }): string {
  const at = new Date(MONDAY + (day - 1) * 86_400_000);
  try {
    return at.toLocaleDateString(locale, { ...options, timeZone: "UTC" });
  } catch {
    return at.toLocaleDateString("en", { ...options, timeZone: "UTC" });
  }
}

/** The reference month ("October 2026"). */
export function monthLabel(locale: string): string {
  try {
    return new Date(MONDAY).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return "October 2026";
  }
}

/** A call duration ("2:14"), with the visitor's digits. */
export function duration(totalSec: number, locale: string): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${num(m, locale)}:${num(s, locale, { minimumIntegerDigits: 2 })}`;
}

/** The fictional clinic of every illustration, and the agency that runs its phone agents. */
export const EXAMPLE_BUSINESS = { name: "Brightline Dental", initial: "B", domain: "brightline-dental.example" } as const;
export const EXAMPLE_AGENCY = { name: "Northwind Voice Studio", initial: "N" } as const;

/** Example phone numbers (the 555-01xx range is reserved for fiction). */
export const EXAMPLE_PHONE = { line: "+1 415 555 0100", caller: "+1 415 555 0142", contact: "+1 512 555 0188" } as const;

/**
 * Heights (0–1) of a deterministic voice waveform: syllable-like bursts with pauses, so every
 * render is the same (no Math.random).
 */
export function waveform(count: number, seed = 1): number[] {
  return Array.from({ length: count }, (_, i) => {
    const x = i + seed * 7;
    const envelope = 0.55 + 0.45 * Math.sin(x / 3.1) * Math.sin(x / 7.3 + seed);
    const detail = 0.5 + 0.5 * Math.abs(Math.sin(x * 1.7 + seed * 0.6));
    const pause = Math.sin(x / 5.2 + seed) < -0.82 ? 0.15 : 1;
    return Math.max(0.12, Math.min(1, Math.abs(envelope) * detail * pause + 0.08));
  });
}

/** Deterministic daily series for sparklines (gentle growth with a weekly rhythm). */
export function exampleSeries(length: number, base: number, seed = 1): number[] {
  return Array.from({ length }, (_, i) => {
    const weekly = (i + seed) % 7 === 5 || (i + seed) % 7 === 6 ? 0.72 : 1;
    const trend = 1 + i / (length * 2.4);
    const wave = 1 + 0.07 * Math.sin(i / 2.1 + seed) + 0.05 * Math.sin(i * 1.6 + seed * 2);
    return Math.round(base * weekly * trend * wave);
  });
}

/** Smooth SVG paths (line + filled area) for a series. */
export function areaPaths(values: number[], width: number, height: number, pad = 4) {
  const max = Math.max(1, ...values);
  const min = Math.min(...values) * 0.85;
  const span = Math.max(1, max - min);
  const pts: Array<[number, number]> = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * width, height - pad - ((v - min) / span) * (height - pad * 2)]);
  let line = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    line += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { line, area: `${line} L${width} ${height} L0 ${height} Z`, last: pts[pts.length - 1] };
}
