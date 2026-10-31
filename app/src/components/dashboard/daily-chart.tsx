import { listSeparator } from "@/lib/dash-format";
import { cn } from "@/lib/utils";

export interface DailyPoint {
  day: string;
  impressions: number;
  clicks: number;
}

/**
 * Daily impressions as bars with clicks drawn inside each bar (same scale, one axis).
 * Pure HTML/CSS: hover a bar for the exact numbers; a data table is rendered by the page.
 */
export function DailyChart({
  data,
  locale,
  labels,
}: {
  data: DailyPoint[];
  locale: string;
  labels: { views: string; clicks: string; chart: string };
}) {
  const max = Math.max(1, ...data.map((d) => d.impressions), ...data.map((d) => d.clicks));
  // Round the axis maximum up to a "nice" number.
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const niceMax = Math.ceil(max / magnitude) * magnitude;
  const fmtDay = (day: string, long = false) => {
    const d = new Date(`${day}T00:00:00Z`);
    const options: Intl.DateTimeFormatOptions = long ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
    try {
      return d.toLocaleDateString(locale, options);
    } catch {
      return d.toLocaleDateString("en", options);
    }
  };
  const num = (n: number) => n.toLocaleString(locale);
  const edge = Math.max(2, Math.round(data.length * 0.15));
  const tickIndexes = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [0];

  return (
    <figure aria-label={labels.chart}>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary-line" />
          {labels.views}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" />
          {labels.clicks}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex h-52 flex-col justify-between pb-0 text-end text-[11px] text-muted tabular-nums" aria-hidden>
          <span className="-translate-y-1/2">{num(niceMax)}</span>
          <span>{num(Math.round(niceMax / 2))}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            <div className="border-t border-dashed border-line" />
            <div className="border-t border-dashed border-line" />
            <div className="border-t border-line" />
          </div>
          <ul className={cn("relative flex h-52 items-end", data.length > 45 ? "gap-px" : "gap-0.5")}>
            {data.map((d, i) => {
              const vh = (d.impressions / niceMax) * 100;
              const ch = (d.clicks / niceMax) * 100;
              const align = i < edge ? "start-0" : i >= data.length - edge ? "end-0" : "left-1/2 -translate-x-1/2";
              return (
                <li key={d.day} className="group relative flex h-full flex-1 items-end">
                  <span className="sr-only">
                    {fmtDay(d.day, true)}: {labels.views} {num(d.impressions)}
                    {listSeparator(locale)}
                    {labels.clicks} {num(d.clicks)}
                  </span>
                  <div className="absolute inset-0 rounded-sm group-hover:bg-primary-soft" aria-hidden />
                  <div
                    className="relative w-full rounded-t-[4px] bg-primary-line transition-colors group-hover:bg-primary/40"
                    style={{ height: `${vh}%`, minHeight: d.impressions > 0 ? 2 : 0 }}
                    aria-hidden
                  >
                    {d.clicks > 0 ? (
                      <div className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-primary" style={{ height: `${vh > 0 ? Math.min(100, (ch / vh) * 100) : 0}%`, minHeight: 2 }} />
                    ) : null}
                  </div>
                  <div
                    className={cn(
                      "pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg group-hover:block",
                      align,
                    )}
                    aria-hidden
                  >
                    <p className="font-medium">{fmtDay(d.day, true)}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-muted">
                      <span className="size-2 rounded-sm bg-primary-line" />
                      {labels.views}: <span className="font-medium text-ink tabular-nums">{num(d.impressions)}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-muted">
                      <span className="size-2 rounded-sm bg-primary" />
                      {labels.clicks}: <span className="font-medium text-ink tabular-nums">{num(d.clicks)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-[11px] text-muted" aria-hidden>
            {tickIndexes.map((i) => (
              <span key={i}>{fmtDay(data[i].day)}</span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
