import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Page title row used by every dashboard page. */
export function DashHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 dir="auto" className="text-2xl font-bold">{title}</h1>
        {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 rounded-xl border border-line bg-surface", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title ? <h2 className="font-sans text-sm font-semibold tracking-normal">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Table wrapper that scrolls horizontally on small screens. RTL-safe alignment. The first and
 * last cells get the panel's 20px inset so the columns line up with the panel header.
 */
/** `dense` tightens the inner cell padding for tables in narrow columns (next to a sidebar card). */
export function DTable({ children, minWidth = 640, label, dense = false }: { children: ReactNode; minWidth?: number; label?: string; dense?: boolean }) {
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      <table className={cn("w-full text-start text-sm", dense && "[&_td]:px-3 [&_th]:px-3")} style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function DTh({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("border-b border-line bg-paper px-4 py-2.5 first:ps-5 last:pe-5 text-xs font-medium whitespace-nowrap text-muted", /\btext-(end|center|right|left)\b/.test(className ?? "") ? undefined : "text-start", className)}
    >
      {children}
    </th>
  );
}

export function DTd({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle first:ps-5 last:pe-5", className)}>{children}</td>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      {icon ? <div className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-primary-soft text-primary [&_svg]:size-5">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Pager({
  page,
  pages,
  href,
  labels,
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  labels: { summary: string; previous: string; next: string; nav: string };
}) {
  if (pages <= 1) return null;
  const link = "inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 hover:border-primary-line hover:text-primary";
  return (
    <nav aria-label={labels.nav} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-muted">{labels.summary}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={link} rel="prev">
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
            {labels.previous}
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={link} rel="next">
            {labels.next}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** Horizontal usage bar. `limit` -1 = unlimited, 0 = none allowed. */
export function Meter({
  label,
  used,
  limit,
  usedText,
  limitText,
  critical = false,
}: {
  label: string;
  used: number;
  limit: number;
  usedText: string;
  limitText: string;
  /** Reaching the limit stops something (e.g. monthly views): show it in red instead of amber. */
  critical?: boolean;
}) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : limit === 0 && used > 0 ? 1 : 0;
  const over = limit >= 0 && (used > limit || (critical && used >= limit && used > 0));
  const tone = over ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-primary";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">
          <span className="font-medium text-ink">{usedText}</span> / {limitText}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-line/70"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit >= 0 ? limit : Math.max(used, 1)}
        aria-valuenow={used}
        aria-valuetext={`${usedText} / ${limitText}`}
      >
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: limit >= 0 ? `${Math.max(ratio * 100, used > 0 ? 2 : 0)}%` : "0%" }} />
      </div>
    </div>
  );
}

/** Pill-shaped link tabs (filters, ranges, moderation tabs). */
export function LinkTabs({ items, label }: { items: Array<{ href: string; label: ReactNode; active: boolean; count?: number }>; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-line bg-paper p-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          scroll={false}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            item.active ? "bg-surface text-primary shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", item.active ? "bg-primary-soft" : "bg-line/70")}>{item.count}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

/** Monospace code block (copy button is placed by the caller). Long lines scroll sideways instead of breaking mid-word. */
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      dir="ltr"
      className={cn("overflow-x-auto rounded-lg border border-line bg-paper px-4 py-3 text-start font-mono text-[13px] leading-relaxed whitespace-pre", className)}
    >
      <code>{children}</code>
    </pre>
  );
}
