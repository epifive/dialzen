import type { CampaignProgress } from "@/lib/campaigns";
import type { Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/** Stacked bar of a campaign's contacts: reached, not reached, skipped, in progress, waiting. */
export function CampaignProgressBar({ progress, t, locale, compact = false }: { progress: CampaignProgress; t: Translator; locale: string; compact?: boolean }) {
  const s = progress.states;
  const parts = [
    { key: "completed", n: s.completed, cls: "bg-emerald-500", label: t("dash.campaigns.bar.reached") },
    { key: "failed", n: s.failed, cls: "bg-red-400", label: t("dash.campaigns.bar.notReached") },
    { key: "skipped", n: s.skipped + s.canceled, cls: "bg-amber-400", label: t("dash.campaigns.bar.skipped") },
    { key: "live", n: s.dialing + s.in_call, cls: "bg-primary", label: t("dash.campaigns.bar.live") },
    { key: "waiting", n: s.pending + s.retry, cls: "bg-line", label: t("dash.campaigns.bar.waiting") },
  ];
  const total = Math.max(1, progress.total);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const num = (n: number) => n.toLocaleString(locale);
  return (
    <div className={cn("min-w-0", compact ? "space-y-1" : "space-y-2")}>
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
        <span>{t("dash.campaigns.bar.done", { done: num(progress.done), total: num(progress.total) })}</span>
        <span className="font-medium text-ink tabular-nums">
          <bdi>{pct}%</bdi>
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-line/60" role="img" aria-label={parts.map((p) => `${p.label}: ${num(p.n)}`).join(", ")}>
        {parts.map((p) => (p.n > 0 ? <span key={p.key} className={cn("h-full", p.cls)} style={{ width: `${(p.n / total) * 100}%` }} /> : null))}
      </div>
      {compact ? null : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {parts.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-sm", p.cls)} aria-hidden />
              {p.label} <bdi className="font-medium text-ink tabular-nums">{num(p.n)}</bdi>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
