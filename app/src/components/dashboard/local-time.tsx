"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

function format(iso: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Date(iso).toLocaleString(locale, options);
  } catch {
    return new Date(iso).toLocaleString("en", options);
  }
}

const OPTIONS: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };

/**
 * A date and time in the visitor's own time zone. The server renders UTC (it can't
 * know the browser's zone); the browser swaps in local time right after hydration.
 */
export function LocalTime({ iso, locale, end }: { iso: string; locale: string; end?: string }) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  const options = client ? OPTIONS : { ...OPTIONS, timeZone: "UTC", timeZoneName: "short" as const };
  let text = format(iso, locale, options);
  if (end) {
    const sameDay = new Date(iso).toDateString() === new Date(end).toDateString();
    const endOptions: Intl.DateTimeFormatOptions = sameDay ? { hour: "2-digit", minute: "2-digit" } : OPTIONS;
    text += ` – ${format(end, locale, client ? endOptions : { ...endOptions, timeZone: "UTC", timeZoneName: "short" })}`;
  }
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
