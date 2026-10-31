/** UTC day helpers for dashboard periods and charts. Dependency-free. */

const DAY_MS = 86_400_000;

/** UTC day (YYYY-MM-DD) of an instant. */
export function dayOf(at: Date | number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** The last `days` UTC days, oldest first (today included). */
export function periodDays(days: number, nowMs = Date.now()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayOf(nowMs - i * DAY_MS));
  return out;
}

/** First / last day (and ISO bounds) of the last `days` days; `offset` periods back for comparisons. */
export function periodRange(days: number, offset = 0, nowMs = Date.now()): { fromDay: string; toDay: string; fromIso: string; toIso: string } {
  const end = nowMs - offset * days * DAY_MS;
  const fromDay = dayOf(end - (days - 1) * DAY_MS);
  const toDay = dayOf(end);
  return { fromDay, toDay, fromIso: `${fromDay}T00:00:00.000Z`, toIso: `${toDay}T23:59:59.999Z` };
}
