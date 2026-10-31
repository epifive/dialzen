import type { Metadata } from "next";
import Link from "next/link";
import { Download, Globe, PhoneCall, PhoneIncoming, PhoneOutgoing, Search, X } from "lucide-react";
import { callFilterFromQuery, contactNames, KNOWN_OUTCOMES, type CallQuery } from "@/components/dashboard/call-query";
import { LocalTime } from "@/components/dashboard/local-time";
import { DashHeader, DTable, DTd, DTh, Empty, Pager, Panel } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { listAgents } from "@/lib/agents";
import { listCalls } from "@/lib/calls";
import { formatNumber } from "@/lib/dash-format";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/dashboard";
import type { MessageKey } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { callStatusTone, formatDuration, formatMicros, sentimentTone } from "@/voice/format";
import { formatPhone } from "@/voice/normalize";
import { CALL_DIRECTIONS, CALL_STATUSES, SENTIMENTS } from "@/voice/types";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.calls") };
}

const PER_PAGE = 25;

/** Where a web call came from ("widget" or "test"). */
function webSource(metadata: Record<string, unknown>): string {
  return String(metadata.web_source ?? metadata.source ?? "");
}
const DIRECTION_ICON = { inbound: PhoneIncoming, outbound: PhoneOutgoing, web: Globe } as const;

/** The workspace's calls with filters, search, CSV export and pages. */
export default async function CallsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<CallQuery> }) {
  const { workspace } = await requireWorkspace((await params).wid);
  const [query, t, locale, settings, agents] = await Promise.all([searchParams, getT(), getLocale(), getSettings(), listAgents(workspace.id)]);
  const lc = locale.code;
  const db = await getDb();
  const campaigns = await db.selectFrom("campaigns").select(["id", "name"]).where("workspace_id", "=", workspace.id).orderBy("id", "desc").limit(200).execute();
  const { filter, clean, none } = await callFilterFromQuery(workspace.id, query);
  const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
  const { calls, total } = none ? { calls: [], total: 0 } : await listCalls(workspace.id, { ...filter, limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
  const names = await contactNames(workspace.id, calls.map((c) => c.contactId));
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const base = `/dashboard/w/${workspace.id}/calls`;
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...clean, ...extra });
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = Object.keys(clean).length > 0;
  const currency = settings.currency || "USD";
  const outcomeLabel = (o: string | null) => (o ? ((KNOWN_OUTCOMES as readonly string[]).includes(o) ? t(`dash.call.outcome.${o}` as MessageKey) : o.replace(/_/g, " ")) : "");

  return (
    <>
      <DashHeader
        title={t("dash.nav.calls")}
        description={t("dash.calls.subtitle")}
        actions={
          total ? (
            <ButtonLink href={`${base}/export${qs({})}`} variant="outline" prefetch={false}>
              <Download aria-hidden />
              {t("dash.calls.export")}
            </ButtonLink>
          ) : null
        }
      />
      <Panel padded={false}>
        <form method="get" action={base} className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label={t("dash.calls.filters")}>
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={clean.q ?? ""} placeholder={t("dash.calls.search")} aria-label={t("dash.calls.search")} className="ps-9" dir="auto" />
          </div>
          <Select name="agent" defaultValue={clean.agent ?? ""} aria-label={t("dash.calls.fAgent")}>
            <option value="">{t("dash.calls.allAgents")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={clean.status ?? ""} aria-label={t("dash.calls.fStatus")}>
            <option value="">{t("dash.calls.allStatuses")}</option>
            {CALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`dash.call.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select name="dir" defaultValue={clean.dir ?? ""} aria-label={t("dash.calls.fDirection")}>
            <option value="">{t("dash.calls.allDirections")}</option>
            {CALL_DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {t(`dash.call.dir.${d}`)}
              </option>
            ))}
          </Select>
          <Select name="sentiment" defaultValue={clean.sentiment ?? ""} aria-label={t("dash.calls.fSentiment")}>
            <option value="">{t("dash.calls.allSentiments")}</option>
            {SENTIMENTS.map((s) => (
              <option key={s} value={s}>
                {t(`dash.call.sentiment.${s}`)}
              </option>
            ))}
          </Select>
          {campaigns.length ? (
            <Select name="campaign" defaultValue={clean.campaign ?? ""} aria-label={t("dash.calls.fCampaign")}>
              <option value="">{t("dash.calls.allCampaigns")}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : null}
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="booked" value="1" defaultChecked={clean.booked === "1"} className="size-4 rounded border-line accent-[var(--primary)]" />
            {t("dash.calls.fBooked")}
          </label>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
            <label className="min-w-0 flex-1 text-xs text-muted sm:max-w-48">
              {t("dash.calls.fFrom")}
              <Input type="date" name="from" defaultValue={clean.from ?? ""} className="mt-1" dir="ltr" />
            </label>
            <label className="min-w-0 flex-1 text-xs text-muted sm:max-w-48">
              {t("dash.calls.fTo")}
              <Input type="date" name="to" defaultValue={clean.to ?? ""} className="mt-1" dir="ltr" />
            </label>
            <div className="flex w-full gap-2 sm:ms-auto sm:w-auto">
              {filtered ? (
                <Link href={base} className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-3 text-sm hover:border-primary-line hover:text-primary">
                  <X className="size-4" aria-hidden />
                  {t("dash.calls.clear")}
                </Link>
              ) : null}
              <button type="submit" className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-white hover:bg-primary-strong sm:flex-none">
                {t("dash.calls.apply")}
              </button>
            </div>
          </div>
        </form>
        {calls.length ? (
          <>
            <DTable minWidth={860} label={t("dash.nav.calls")}>
              <thead>
                <tr>
                  <DTh>{t("dash.calls.cTime")}</DTh>
                  <DTh>{t("dash.calls.cContact")}</DTh>
                  <DTh>{t("dash.calls.cAgent")}</DTh>
                  <DTh>{t("dash.calls.cDirection")}</DTh>
                  <DTh className="text-end">{t("dash.calls.cDuration")}</DTh>
                  <DTh>{t("dash.calls.cOutcome")}</DTh>
                  <DTh className="text-end">{t("dash.calls.cCost")}</DTh>
                  <DTh>{t("dash.calls.cSentiment")}</DTh>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => {
                  const Icon = DIRECTION_ICON[c.direction];
                  const other = c.direction === "inbound" ? c.from : c.to;
                  const name = c.contactId ? names.get(c.contactId) : "";
                  return (
                    <tr key={c.id} className="hover:bg-paper">
                      <DTd className="text-sm whitespace-nowrap">
                        <Link href={`${base}/${c.id}`} className="hover:text-primary">
                          <LocalTime iso={c.startedAt ?? c.createdAt} locale={lc} />
                        </Link>
                      </DTd>
                      <DTd>
                        <Link href={`${base}/${c.id}`} className="block max-w-56 hover:text-primary">
                          <span className="block truncate font-medium" dir="auto">
                            {name || (other ? <bdi dir="ltr">{formatPhone(other)}</bdi> : webSource(c.metadata) === "widget" ? t("dash.calls.webWidget") : t("dash.calls.webTest"))}
                          </span>
                          {name && other ? (
                            <bdi dir="ltr" className="block truncate text-xs text-muted">
                              {formatPhone(other)}
                            </bdi>
                          ) : null}
                        </Link>
                      </DTd>
                      <DTd className="max-w-44 truncate text-sm">{c.agentId ? <span dir="auto">{agentName.get(c.agentId) ?? `#${c.agentId}`}</span> : <span className="text-muted">—</span>}</DTd>
                      <DTd className="text-sm whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className="size-4 text-muted" aria-hidden />
                          {t(`dash.call.dir.${c.direction}`)}
                        </span>
                      </DTd>
                      <DTd className="text-end text-sm tabular-nums">
                        <bdi>{formatDuration(c.durationSec)}</bdi>
                      </DTd>
                      <DTd>
                        <span className="flex flex-wrap items-center gap-1">
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", callStatusTone(c.status))}>{t(`dash.call.status.${c.status}`)}</span>
                          {c.outcome && c.outcome !== c.status ? <span className="rounded-full bg-line/70 px-2 py-0.5 text-xs whitespace-nowrap text-muted">{outcomeLabel(c.outcome)}</span> : null}
                        </span>
                      </DTd>
                      <DTd className="text-end text-sm tabular-nums whitespace-nowrap">
                        <bdi>{c.creditsSettledMicros ? formatMicros(c.creditsSettledMicros, currency, lc) : c.includedSeconds ? t("dash.calls.included") : "—"}</bdi>
                      </DTd>
                      <DTd>{c.sentiment !== "unknown" ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", sentimentTone(c.sentiment))}>{t(`dash.call.sentiment.${c.sentiment}`)}</span> : <span className="text-muted">—</span>}</DTd>
                    </tr>
                  );
                })}
              </tbody>
            </DTable>
            <Pager
              page={page}
              pages={pages}
              href={(p) => `${base}${qs(p > 1 ? { page: String(p) } : {})}`}
              labels={{ summary: t("dash.calls.pageSummary", { page: formatNumber(page, lc), pages: formatNumber(pages, lc), total: formatNumber(total, lc) }), previous: t("dash.calls.previous"), next: t("dash.calls.next"), nav: t("dash.calls.pages") }}
            />
          </>
        ) : (
          <Empty icon={<PhoneCall />} title={filtered ? t("dash.calls.noMatch") : t("dash.calls.emptyTitle")}>
            {filtered ? t("dash.calls.noMatchText") : t("dash.calls.emptyText")}
          </Empty>
        )}
      </Panel>
    </>
  );
}
