import type { DayPoint } from "@/lib/analytics";
import { formatDay } from "@/lib/dash-format";
import { cn } from "@/lib/utils";

/**
 * Server-rendered charts of the analytics page (HTML/CSS only, no client JS): daily calls with
 * the answered share, horizontal distribution bars and the weekday × hour heatmap. Every chart
 * has a text alternative; exact values show on hover.
 */

export function DailyCallsChart({ data, locale, labels }: { data: DayPoint[]; locale: string; labels: { calls: string; answered: string; chart: string } }) {
  const max = Math.max(1, ...data.map((d) => d.calls));
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const niceMax = Math.ceil(max / magnitude) * magnitude;
  const num = (n: number) => n.toLocaleString(locale);
  const ticks = data.length > 1 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [0];
  return (
    <figure aria-label={labels.chart}>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary-line" />
          {labels.calls}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary" />
          {labels.answered}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex h-44 flex-col justify-between text-end text-[11px] text-muted tabular-nums" aria-hidden>
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
          <ul className={cn("relative flex h-44 items-end", data.length > 45 ? "gap-px" : "gap-0.5")}>
            {data.map((d, i) => {
              const h = (d.calls / niceMax) * 100;
              const a = d.calls ? (d.answered / d.calls) * 100 : 0;
              const align = i < 3 ? "start-0" : i >= data.length - 3 ? "end-0" : "left-1/2 -translate-x-1/2";
              return (
                <li key={d.day} className="group relative flex h-full flex-1 items-end">
                  <span className="sr-only">
                    {formatDay(d.day, locale, true)}: {labels.calls} {num(d.calls)}, {labels.answered} {num(d.answered)}
                  </span>
                  <div className="absolute inset-0 rounded-sm group-hover:bg-primary-soft" aria-hidden />
                  <div className="relative w-full rounded-t-[3px] bg-primary-line" style={{ height: `${h}%`, minHeight: d.calls ? 2 : 0 }} aria-hidden>
                    {d.answered ? <div className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-primary" style={{ height: `${a}%`, minHeight: 2 }} /> : null}
                  </div>
                  <div className={cn("pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg group-hover:block", align)} aria-hidden>
                    <p className="font-medium">{formatDay(d.day, locale, true)}</p>
                    <p className="text-muted">
                      {labels.calls}: <span className="font-medium text-ink tabular-nums">{num(d.calls)}</span>
                    </p>
                    <p className="text-muted">
                      {labels.answered}: <span className="font-medium text-ink tabular-nums">{num(d.answered)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-[11px] text-muted" aria-hidden>
            {ticks.map((i) => (data[i] ? <span key={i}>{formatDay(data[i].day, locale)}</span> : null))}
          </div>
        </div>
      </div>
    </figure>
  );
}

/** Horizontal bars of a distribution (outcomes, sentiment), largest first. */
export function DistributionBars({ items, locale, empty }: { items: Array<{ key: string; label: string; value: number; tone?: string }>; locale: string; empty: string }) {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items
        .filter((i) => i.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((i) => (
          <li key={i.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{i.label}</span>
              <span className="text-muted tabular-nums">
                <bdi className="font-medium text-ink">{i.value.toLocaleString(locale)}</bdi> · <bdi>{Math.round((i.value / total) * 100)}%</bdi>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-line/60" aria-hidden>
              <div className={cn("h-full rounded-full", i.tone ?? "bg-primary")} style={{ width: `${(i.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
    </ul>
  );
}

/** Weekday × hour grid: colour = answer rate of outbound calls, empty = no calls. */
export function AnswerHeatmap({ heatmap, dayLabels, weekStart, locale, labels }: { heatmap: Record<number, Array<{ calls: number; answered: number }>>; dayLabels: Record<number, string>; weekStart: 1 | 7; locale: string; labels: { title: string; calls: string; rate: string; none: string } }) {
  const days = weekStart === 7 ? [7, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7];
  const any = days.some((d) => heatmap[d].some((c) => c.calls > 0));
  if (!any) return <p className="text-sm text-muted">{labels.none}</p>;
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={labels.title} tabIndex={0}>
      <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} scope="col" className="font-normal text-muted tabular-nums">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <th scope="row" className="pe-1 text-start font-normal text-muted">
                {dayLabels[d]}
              </th>
              {heatmap[d].map((c, h) => {
                const rate = c.calls ? c.answered / c.calls : 0;
                const title = c.calls ? `${dayLabels[d]} ${String(h).padStart(2, "0")}:00 · ${labels.calls} ${c.calls.toLocaleString(locale)} · ${labels.rate} ${Math.round(rate * 100)}%` : `${dayLabels[d]} ${String(h).padStart(2, "0")}:00 · ${labels.none}`;
                return (
                  <td key={h} title={title} className={cn("h-6 rounded-[3px]", c.calls ? "bg-primary" : "bg-line/40")} style={c.calls ? { opacity: 0.15 + rate * 0.85 } : undefined}>
                    <span className="sr-only">{title}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
