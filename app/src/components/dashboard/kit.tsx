import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Server-safe building blocks of the customer dashboard (no client JS). */

/** A grouped number, isolated for RTL text. */
export function Num({ value, locale, className }: { value: number; locale: string; className?: string }) {
  let text: string;
  try {
    text = value.toLocaleString(locale);
  } catch {
    text = value.toLocaleString("en");
  }
  return <bdi className={cn("tabular-nums", className)}>{text}</bdi>;
}

/** Coloured initial of a name (stable colour per name). */
export function Initial({ name, className }: { name: string; className?: string }) {
  const palette = ["bg-rose-100 text-rose-700", "bg-sky-100 text-sky-700", "bg-amber-100 text-amber-800", "bg-emerald-100 text-emerald-700", "bg-violet-100 text-violet-700", "bg-teal-100 text-teal-700"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase dark:bg-line dark:text-ink", palette[h % palette.length], className)} aria-hidden>
      {(name.trim() || "?").slice(0, 1)}
    </span>
  );
}

/** Change against the previous period: ↑ 12% (green) / ↓ 8% (red). */
export function Delta({ current, previous, label }: { current: number; previous: number; label: string }) {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (!Number.isFinite(pct)) return null;
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title={label}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap tabular-nums",
        pct === 0 ? "text-muted" : up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
      )}
    >
      {pct !== 0 ? <Icon className="size-3.5" aria-hidden /> : null}
      <bdi>{Math.abs(pct)}%</bdi>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** One cell of a KPI strip. */
export function Kpi({ label, value, hint, delta, accent }: { label: string; value: ReactNode; hint?: ReactNode; delta?: ReactNode; accent?: string }) {
  return (
    <div className="bg-surface px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted uppercase">
        {accent ? <span className={cn("size-2 rounded-full", accent)} aria-hidden /> : null}
        {label}
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-display text-xl font-bold whitespace-nowrap tabular-nums sm:text-2xl">{value}</span>
        {delta}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Grid of Kpi cells separated by hairlines. */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-px overflow-hidden rounded-xl border border-line bg-line", className)}>{children}</div>;
}

/** Setup checklist row. */
export function CheckItem({ done, title, text, action }: { done: boolean; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
          done ? "bg-emerald-500 text-white" : "border-2 border-dashed border-line text-transparent",
        )}
        aria-hidden
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : <Circle className="size-2" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", done && "text-muted line-through decoration-1")}>{title}</p>
        {text && !done ? <div className="mt-0.5 text-xs text-muted">{text}</div> : null}
      </div>
      {action && !done ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/** Numbered step heading used by setup guides. */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="group/step relative flex gap-4 pb-6 last:pb-0">
      <span className="absolute start-[13px] top-8 bottom-0 w-px bg-line group-last/step:hidden" aria-hidden />
      <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{n}</span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold">{title}</p>
        <div className="mt-2 space-y-3 text-sm text-muted">{children}</div>
      </div>
    </li>
  );
}
