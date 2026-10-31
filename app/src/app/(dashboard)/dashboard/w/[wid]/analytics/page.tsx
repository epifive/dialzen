import type { Metadata } from "next";
import { Download } from "lucide-react";
import { AnswerHeatmap, DailyCallsChart, DistributionBars } from "@/components/dashboard/analytics-charts";
import { Kpi, KpiGrid } from "@/components/dashboard/kit";
import { DashHeader, DTable, DTd, DTh, LinkTabs, Panel } from "@/components/dashboard/ui";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { listAgents } from "@/lib/agents";
import { lastDays, loadAnalytics, type Breakdown } from "@/lib/analytics";
import { listCampaigns } from "@/lib/campaigns";
import { formatNumber } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { listNumbers } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { formatDuration, formatMicros } from "@/voice/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.analytics") };
}

const RANGES = [7, 30, 90] as const;
const OUTCOME_TONES: Record<string, string> = { booked: "bg-emerald-500", completed: "bg-primary", transferred: "bg-sky-500", opted_out: "bg-red-500", no_answer: "bg-amber-400", busy: "bg-amber-500", voicemail: "bg-violet-400", failed: "bg-red-400", canceled: "bg-line" };
const SENTIMENT_TONES: Record<string, string> = { positive: "bg-emerald-500", neutral: "bg-slate-400", negative: "bg-red-500", unknown: "bg-line" };

function pct(v: number | null): string {
  return v === null ? "–" : `${Math.round(v * 100)}%`;
}

/** Calls, minutes, answer rate, outcomes, bookings, sentiment and credits, per agent / campaign / number. */
export default async function AnalyticsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ days?: string; agent?: string; campaign?: string; direction?: string }> }) {
  const { workspace } = await requireWorkspace((await params).wid);
  const query = await searchParams;
  const range = RANGES.find((r) => String(r) === query.days) ?? 30;
  const direction = query.direction === "inbound" || query.direction === "outbound" || query.direction === "web" ? query.direction : undefined;
  const agentId = Number(query.agent) || undefined;
  const campaignId = Number(query.campaign) || undefined;
  const days = lastDays(range, workspace.timezone);
  const [t, locale, settings, data, agents, campaigns, numbers] = await Promise.all([getT(), getLocale(), getSettings(), loadAnalytics(workspace.id, workspace.timezone, days, { agentId, campaignId, direction }), listAgents(workspace.id), listCampaigns(workspace.id), listNumbers(workspace.id, { includeReleased: true })]);
  const lc = locale.code;
  const num = (n: number) => formatNumber(n, lc);
  const money = (m: number) => formatMicros(m, settings.currency || "USD", lc);
  const base = `/dashboard/w/${workspace.id}/analytics`;
  const qs = (patch: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(Object.entries({ days: String(range), agent: agentId ? String(agentId) : undefined, campaign: campaignId ? String(campaignId) : undefined, direction, ...patch }).filter((e): e is [string, string] => Boolean(e[1])));
    return `${base}?${sp}`;
  };
  const tot = data.totals;
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const numberName = new Map(numbers.map((n) => [n.id, n.e164]));
  const dayLabels = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, t(`dash.campaigns.day.${d}` as MessageKey)]));

  return (
    <>
      <DashHeader
        title={t("dash.nav.analytics")}
        description={t("dash.analytics.subtitle")}
        actions={
          <a href={`${base}/export?${new URLSearchParams(qs({}).split("?")[1])}`} className={buttonClass("outline", "md")}>
            <Download aria-hidden />
            {t("dash.analytics.export")}
          </a>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <LinkTabs label={t("dash.analytics.range")} items={RANGES.map((r) => ({ href: qs({ days: String(r) }), label: t("dash.analytics.lastDays", { n: r }), active: r === range }))} />
        <form method="get" className="grid w-full gap-2 sm:grid-cols-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center">
          <input type="hidden" name="days" value={range} />
          <Select name="agent" defaultValue={agentId ? String(agentId) : ""} aria-label={t("dash.analytics.agent")} className="h-9 lg:w-44">
            <option value="">{t("dash.analytics.allAgents")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select name="campaign" defaultValue={campaignId ? String(campaignId) : ""} aria-label={t("dash.analytics.campaign")} className="h-9 lg:w-44">
            <option value="">{t("dash.analytics.allCampaigns")}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select name="direction" defaultValue={direction ?? ""} aria-label={t("dash.analytics.direction")} className="h-9 lg:w-44">
            <option value="">{t("dash.analytics.allDirections")}</option>
            <option value="inbound">{t("dash.call.dir.inbound")}</option>
            <option value="outbound">{t("dash.call.dir.outbound")}</option>
            <option value="web">{t("dash.call.dir.web")}</option>
          </Select>
          <button type="submit" className={buttonClass("outline", "sm", "h-9")}>
            {t("dash.contacts.filter")}
          </button>
        </form>
      </div>

      <KpiGrid className="mb-6 grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label={t("dash.analytics.calls")} value={num(tot.calls)} />
        <Kpi label={t("dash.analytics.answerRate")} value={pct(tot.answerRate)} hint={t("dash.analytics.answeredN", { n: num(tot.answered) })} />
        <Kpi label={t("dash.analytics.minutes")} value={num(Math.round(tot.billedSeconds / 60))} hint={tot.includedSeconds ? t("dash.analytics.includedN", { n: num(Math.round(tot.includedSeconds / 60)) }) : undefined} />
        <Kpi label={t("dash.analytics.avgDuration")} value={<bdi>{tot.avgDuration === null ? "–" : formatDuration(tot.avgDuration)}</bdi>} />
        <Kpi label={t("dash.analytics.bookings")} value={num(tot.bookings)} hint={tot.answered ? t("dash.analytics.bookingRate", { pct: Math.round((tot.bookings / tot.answered) * 100) }) : undefined} />
        <Kpi label={t("dash.analytics.optOuts")} value={num(tot.optOuts)} />
        <Kpi label={t("dash.analytics.credits")} value={<bdi>{money(tot.creditsMicros)}</bdi>} />
        <Kpi label={t("dash.analytics.perCall")} value={<bdi>{tot.calls ? money(Math.round(tot.creditsMicros / tot.calls)) : "–"}</bdi>} />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t("dash.analytics.daily")}>
          <DailyCallsChart data={data.daily} locale={lc} labels={{ calls: t("dash.analytics.calls"), answered: t("dash.analytics.answered"), chart: t("dash.analytics.daily") }} />
        </Panel>
        <Panel title={t("dash.analytics.outcomes")}>
          <DistributionBars items={Object.entries(data.outcomes).map(([k, v]) => ({ key: k, label: t(`dash.analytics.outcome.${k}` as MessageKey), value: v, tone: OUTCOME_TONES[k] }))} locale={lc} empty={t("dash.analytics.noData")} />
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t("dash.analytics.heatmap")} description={t("dash.analytics.heatmapText", { tz: workspace.timezone.replaceAll("_", " ") })}>
          <AnswerHeatmap heatmap={data.heatmap} dayLabels={dayLabels} weekStart={workspace.settings.weekStart} locale={lc} labels={{ title: t("dash.analytics.heatmap"), calls: t("dash.analytics.calls"), rate: t("dash.analytics.answerRate"), none: t("dash.analytics.noOutbound") }} />
        </Panel>
        <Panel title={t("dash.analytics.sentiment")}>
          <DistributionBars items={Object.entries(data.sentiment).map(([k, v]) => ({ key: k, label: t(`dash.analytics.sentiment.${k}` as MessageKey), value: v, tone: SENTIMENT_TONES[k] }))} locale={lc} empty={t("dash.analytics.noAnswered")} />
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <BreakdownPanel title={t("dash.analytics.byAgent")} rows={data.byAgent} name={(id) => (id ? (agentName.get(id) ?? `#${id}`) : t("dash.analytics.noAgent"))} t={t} num={num} money={money} />
        <BreakdownPanel title={t("dash.analytics.byCampaign")} rows={data.byCampaign} name={(id) => campaignName.get(id ?? 0) ?? `#${id}`} t={t} num={num} money={money} />
        <BreakdownPanel className="xl:col-span-2" title={t("dash.analytics.byNumber")} rows={data.byNumber} name={(id) => numberName.get(id ?? 0) ?? `#${id}`} t={t} num={num} money={money} ltr />
      </div>
    </>
  );
}

function BreakdownPanel({ title, rows, name, t, num, money, ltr = false, className }: { className?: string; title: string; rows: Breakdown[]; name: (id: number | null) => string; t: Translator; num: (n: number) => string; money: (m: number) => string; ltr?: boolean }) {
  return (
    <Panel title={title} padded={false} className={className}>
      {rows.length ? (
        <DTable minWidth={460} label={title} dense>
          <thead>
            <tr>
              <DTh>{t("dash.analytics.name")}</DTh>
              <DTh className="text-end">{t("dash.analytics.calls")}</DTh>
              <DTh className="text-end">{t("dash.analytics.answerRate")}</DTh>
              <DTh className="text-end">{t("dash.analytics.minutes")}</DTh>
              <DTh className="text-end">{t("dash.analytics.bookings")}</DTh>
              <DTh className="text-end">{t("dash.analytics.credits")}</DTh>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={String(r.id)}>
                <DTd className="max-w-40 truncate">{ltr ? <bdi dir="ltr" className="font-mono text-[12px]">{name(r.id)}</bdi> : <span dir="auto">{name(r.id)}</span>}</DTd>
                <DTd className="text-end tabular-nums">{num(r.calls)}</DTd>
                <DTd className="text-end tabular-nums">{pct(r.answerRate)}</DTd>
                <DTd className="text-end tabular-nums">{num(Math.round(r.billedSeconds / 60))}</DTd>
                <DTd className="text-end tabular-nums">{num(r.bookings)}</DTd>
                <DTd className="text-end tabular-nums">
                  <bdi>{money(r.creditsMicros)}</bdi>
                </DTd>
              </tr>
            ))}
          </tbody>
        </DTable>
      ) : (
        <p className="px-5 py-4 text-sm text-muted">{t("dash.analytics.noData")}</p>
      )}
    </Panel>
  );
}
