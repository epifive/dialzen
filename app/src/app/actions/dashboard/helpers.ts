import "server-only";

/** Shared helpers for the dashboard Server Actions (not an action module itself). */

export const idOf = (v: FormDataEntryValue | null) => Number(typeof v === "string" && v.trim() ? v : NaN);
export const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");
export const ids = (values: FormDataEntryValue[]) => [...new Set(values.map((v) => idOf(v)).filter((n) => Number.isInteger(n) && n > 0))];

export function parseJsonField(v: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(str(v) || "{}");
  } catch {
    return {};
  }
}

/** A decimal number typed by a person ("12.5", "12,5", "1 234.50"); NaN when not a number. */
export function decimalOf(v: FormDataEntryValue | null): number {
  let s = str(v).trim().replace(/\s/g, "");
  if (!s) return NaN;
  // "12,5" (comma decimal) → "12.5"; "1,234.50" (grouping) → "1234.50".
  if (/^\d+,\d{1,3}$/.test(s) && !s.includes(".")) s = s.replace(",", ".");
  s = s.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** Whole number in [min, max] or NaN. */
export function intOf(v: FormDataEntryValue | null, min: number, max: number): number {
  const n = decimalOf(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}
