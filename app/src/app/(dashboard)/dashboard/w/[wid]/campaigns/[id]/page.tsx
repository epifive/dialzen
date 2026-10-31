import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pause, Pencil, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { deleteCampaignAction, pauseCampaignAction, resumeCampaignAction, startCampaignAction, stopCampaignAction, syncCampaignAction } from "@/app/actions/dashboard/campaigns";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { LiveRefresh } from "@/components/dashboard/campaign-live";
import { CampaignProgressBar } from "@/components/dashboard/campaign-progress";
import { Kpi, KpiGrid } from "@/components/dashboard/kit";
import { DashHeader, DTable, DTd, DTh, Empty, LinkTabs, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getAgent } from "@/lib/agents";
import { campaignProgress, getCampaign, listCampaignContacts } from "@/lib/campaigns";
import { abandonmentRate } from "@/lib/campaigns/outcomes";
import { consentCoverage } from "@/lib/campaigns/view";
import { getCompliance, outboundAccess } from "@/lib/compliance";
import { listContactLists } from "@/lib/contacts";
import { formatDateTime, formatNumber, formatRelative, formatTime } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { dayBoundsIso, localDay } from "@/lib/jobs/shared";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { listNumbers } from "@/lib/numbers";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { campaignContactTone, campaignStatusTone } from "@/voice/format";
import { asObj, formatPhone, parseJson, roleCan } from "@/voice/normalize";
import { CAMPAIGN_CONTACT_STATES, type CampaignContactState } from "@/voice/types";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.campaigns") };
}

/** Start of today in a zone (outside the component: render must stay pure). */
function todayStartIso(tz: string): string {
  return dayBoundsIso(localDay(Date.now(), tz), tz).start;
}

const OUTCOMES = ["completed", "no_answer", "busy", "voicemail", "failed", "opt_out", "blocked"] as const;

/** One campaign: controls, progress by state and outcome, the live view of its contacts, and its settings. */
export default async function CampaignPage({ params, searchParams }: { params: Promise<{ wid: string; id: string }>; searchParams: Promise<{ saved?: string; state?: string }> }) {
  const p = await params;
  const { workspace, role } = await requireWorkspace(p.wid);
  const campaign = await getCampaign(workspace.id, Number(p.id));
  if (!campaign) notFound();
  const query = await searchParams;
  const filter = (CAMPAIGN_CONTACT_STATES as readonly string[]).includes(query.state ?? "") ? (query.state as CampaignContactState) : undefined;
  const [t, locale, progressMap, rows, entitlements, compliance, agent, numbers, lists, coverage, abandon] = await Promise.all([
    getT(),
    getLocale(),
    campaignProgress([campaign.id]),
    listCampaignContacts(campaign.id, { state: filter, limit: 50 }),
    getWorkspaceEntitlements(workspace),
    getCompliance(workspace),
    getAgent(workspace.id, campaign.agentId),
    listNumbers(workspace.id),
    listContactLists(workspace.id),
    consentCoverage(workspace.id, campaign.listIds, campaign.purpose),
    abandonmentRate(campaign.id),
  ]);
  const progress = progressMap.get(campaign.id)!;
  const access = await outboundAccess(compliance, entitlements);
  const db = await getDb();
  const statsRow = await db.selectFrom("campaigns").select("stats").where("id", "=", campaign.id).executeTakeFirst();
  const stats = asObj(parseJson(statsRow?.stats));
  const start = todayStartIso(workspace.timezone);
  const today = Number((await db.selectFrom("calls").select((eb) => eb.fn.countAll<number>().as("n")).where("campaign_id", "=", campaign.id).where("created_at", ">=", start).executeTakeFirst())?.n ?? 0);
  const lc = locale.code;
  const num = (n: number) => formatNumber(n, lc);
  const wbase = `/dashboard/w/${workspace.id}`;
  const base = `${wbase}/campaigns/${campaign.id}`;
  const canRun = roleCan(role, "campaigns.run");
  const canEdit = roleCan(role, "campaigns.edit");
  const s = campaign.status;
  const fields = { wid: workspace.id, campaign_id: campaign.id };
  const waiting = typeof stats.waiting === "string" ? stats.waiting : null;
  const numberById = new Map(numbers.map((n) => [n.id, n]));
  const listById = new Map(lists.map((l) => [l.id, l]));
  const live = s === "running";

  return (
    <>
      {query.saved === "1" ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {t("dash.campaigns.saved")}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", campaignStatusTone(s))}>{t(`dash.campaigns.status.${s}` as MessageKey)}</span>
            <span className="rounded-full bg-line/70 px-2 py-0.5 text-xs">{t(`dash.campaigns.purpose.${campaign.purpose}`)}</span>
            <LiveRefresh enabled={live || s === "scheduled"} />
          </span>
        }
        actions={
          <>
            <ButtonLink href={`${wbase}/campaigns`} variant="outline">
              <ArrowLeft className="rtl:rotate-180" aria-hidden />
              {t("dash.nav.campaigns")}
            </ButtonLink>
            {canRun && s === "draft" ? (
              <ActionButton action={startCampaignAction} fields={fields} variant="primary" size="md" confirmText={t("dash.campaigns.startConfirm", { n: num(coverage.total) })} showSuccess>
                <Play aria-hidden />
                {t("dash.campaigns.start")}
              </ActionButton>
            ) : null}
            {canEdit && (s === "running" || s === "scheduled") ? (
              <ActionButton action={pauseCampaignAction} fields={fields} size="md">
                <Pause aria-hidden />
                {t("dash.campaigns.pause")}
              </ActionButton>
            ) : null}
            {canRun && s === "paused" ? (
              <ActionButton action={resumeCampaignAction} fields={fields} variant="primary" size="md">
                <Play aria-hidden />
                {t("dash.campaigns.resume")}
              </ActionButton>
            ) : null}
            {canEdit && ["draft", "scheduled", "paused"].includes(s) ? (
              <ButtonLink href={`${base}/edit`} variant="outline">
                <Pencil aria-hidden />
                {t("dash.campaigns.edit")}
              </ButtonLink>
            ) : null}
            {canEdit && (s === "running" || s === "paused" || s === "scheduled") ? (
              <ActionButton action={syncCampaignAction} fields={fields} variant="ghost" size="md" showSuccess>
                <RefreshCw aria-hidden />
                {t("dash.campaigns.sync")}
              </ActionButton>
            ) : null}
            {canRun && ["running", "paused", "scheduled"].includes(s) ? (
              <ActionButton action={stopCampaignAction} fields={fields} variant="ghost" size="md" confirmText={t("dash.campaigns.stopConfirm")}>
                <Square aria-hidden />
                {t("dash.campaigns.stop")}
              </ActionButton>
            ) : null}
            {canRun && ["draft", "completed", "canceled"].includes(s) ? (
              <ActionButton action={deleteCampaignAction} fields={fields} variant="ghost" size="md" confirmText={t("dash.campaigns.deleteConfirm")}>
                <Trash2 aria-hidden />
                {t("dash.campaigns.delete")}
              </ActionButton>
            ) : null}
          </>
        }
      />

      <div className="mb-6 space-y-3">
        {campaign.pausedReason ? <Alert tone="warning">{t(`dash.campaigns.pausedReason.${campaign.pausedReason}` as MessageKey)}</Alert> : null}
        {(s === "running" || s === "draft") && !access.ok ? (
          <Alert tone="warning" title={t("dash.campaigns.blockedTitle")}>
            {t(`dash.campaigns.blocked.${access.reason}`)}{" "}
            <Link href={`${wbase}/compliance/outbound`} className="font-medium underline underline-offset-2">
              {t("dash.campaigns.openCompliance")}
            </Link>
          </Alert>
        ) : null}
        {live && waiting ? <Alert tone="info">{t(`dash.campaigns.waiting.${waiting}` as MessageKey)}</Alert> : null}
        {typeof stats.lastError === "string" && stats.lastError ? <Alert tone="error">{t("dash.campaigns.lastError", { error: stats.lastError })}</Alert> : null}
        {coverage.total > 0 && coverage.covered < coverage.total && s !== "completed" && s !== "canceled" ? (
          <Alert tone={coverage.covered === 0 ? "error" : "warning"} title={t("dash.campaigns.consentTitle")}>
            {t(campaign.purpose === "telemarketing" ? "dash.campaigns.consentTele" : "dash.campaigns.consentInfo", { covered: num(coverage.covered), total: num(coverage.total) })}
          </Alert>
        ) : null}
      </div>

      <KpiGrid className="mb-6 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        <Kpi label={t("dash.campaigns.kpi.contacts")} value={num(progress.total)} />
        <Kpi label={t("dash.campaigns.kpi.queued")} value={num(progress.states.pending + progress.states.retry)} hint={progress.nextAttemptAt && progress.nextAttemptAt > new Date().toISOString() ? t("dash.campaigns.kpi.next", { when: formatRelative(progress.nextAttemptAt, lc) }) : undefined} />
        <Kpi label={t("dash.campaigns.kpi.live")} value={num(progress.states.dialing + progress.states.in_call)} accent={live ? "bg-emerald-500" : undefined} />
        <Kpi label={t("dash.campaigns.kpi.reached")} value={num(progress.states.completed)} />
        <Kpi label={t("dash.campaigns.kpi.notReached")} value={num(progress.states.failed)} />
        <Kpi label={t("dash.campaigns.kpi.skipped")} value={num(progress.states.skipped)} />
        <Kpi label={t("dash.campaigns.kpi.today")} value={num(today)} hint={campaign.dailyCap ? t("dash.campaigns.kpi.cap", { n: num(campaign.dailyCap) }) : undefined} />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Panel title={t("dash.campaigns.progress")}>
            <CampaignProgressBar progress={progress} t={t} locale={lc} />
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              {OUTCOMES.map((o) => (
                <div key={o} className="flex items-baseline justify-between gap-2 border-b border-line/70 pb-1.5">
                  <dt className="text-muted">{t(`dash.campaigns.outcome.${o}`)}</dt>
                  <dd className="font-medium tabular-nums">
                    <bdi>{num(progress.outcomes[o] ?? 0)}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted">
              {t("dash.campaigns.attemptsTotal", { n: num(progress.attempts) })} ·{" "}
              {abandon.answered ? (campaign.abandonMaxPct ? t("dash.campaigns.abandonRate", { pct: abandon.pct, n: num(abandon.answered), max: campaign.abandonMaxPct }) : t("dash.campaigns.abandonRateNoLimit", { pct: abandon.pct, n: num(abandon.answered) })) : t("dash.campaigns.abandonNone")}
            </p>
          </Panel>

          <Panel title={t("dash.campaigns.liveView")} description={t("dash.campaigns.liveViewText")} padded={false}>
            <div className="overflow-x-auto border-b border-line px-3 py-2">
              <LinkTabs
                label={t("dash.campaigns.liveView")}
                items={[
                  { href: base, label: t("dash.campaigns.allRows"), active: !filter },
                  ...(["in_call", "pending", "retry", "completed", "failed", "skipped"] as const).map((st) => ({ href: `${base}?state=${st}`, label: t(`dash.campaigns.row.${st}`), active: filter === st, count: progress.states[st] })),
                ]}
              />
            </div>
            {rows.rows.length ? (
              <DTable minWidth={640} label={t("dash.campaigns.liveView")} dense>
                <thead>
                  <tr>
                    <DTh>{t("dash.contacts.name")}</DTh>
                    <DTh>{t("dash.contacts.phone")}</DTh>
                    <DTh>{t("dash.campaigns.col.state")}</DTh>
                    <DTh>{t("dash.campaigns.col.attempts")}</DTh>
                    <DTh>{t("dash.campaigns.col.last")}</DTh>
                    <DTh>{t("dash.campaigns.col.next")}</DTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.rows.map((r) => (
                    <tr key={r.id}>
                      <DTd>
                        <Link href={`${wbase}/contacts/${r.contactId}`} className="whitespace-nowrap hover:text-primary" dir="auto">
                          {r.name || t("dash.contacts.noName")}
                        </Link>
                      </DTd>
                      <DTd className="whitespace-nowrap">
                        <bdi dir="ltr" className="font-mono text-[13px]">
                          {formatPhone(r.phone)}
                        </bdi>
                      </DTd>
                      <DTd>
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", campaignContactTone(r.state))}>{t(`dash.campaigns.row.${r.state}`)}</span>
                        {r.skipReason ? (
                          <span className="mt-0.5 block text-xs text-muted">
                            {r.skipReason
                              .split(",")
                              .map((x) => t(`dash.dial.reason.${x}` as MessageKey))
                              .join(", ")}
                          </span>
                        ) : null}
                      </DTd>
                      <DTd className="tabular-nums">{r.attempts}</DTd>
                      <DTd className="text-muted">
                        {r.lastOutcome ? (
                          r.lastCallId ? (
                            <Link href={`${wbase}/calls/${r.lastCallId}`} className="hover:text-primary">
                              {t(`dash.campaigns.outcome.${r.lastOutcome}` as MessageKey)}
                            </Link>
                          ) : (
                            t(`dash.campaigns.outcome.${r.lastOutcome}` as MessageKey)
                          )
                        ) : (
                          "—"
                        )}
                      </DTd>
                      <DTd className="whitespace-nowrap text-muted">
                        {(r.state === "retry" || r.state === "pending") && r.nextAttemptAt ? (
                          <time dateTime={r.nextAttemptAt} title={formatDateTime(r.nextAttemptAt, lc)}>
                            {formatTime(r.nextAttemptAt, lc, true)}
                          </time>
                        ) : (
                          "—"
                        )}
                      </DTd>
                    </tr>
                  ))}
                </tbody>
              </DTable>
            ) : (
              <Empty title={s === "draft" ? t("dash.campaigns.noRowsDraft") : t("dash.campaigns.noRows")} />
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("dash.campaigns.settings")}>
            <dl className="space-y-3 text-sm">
              <Row label={t("dash.campaigns.f.agent")}>{agent ? <Link href={`${wbase}/agents/${agent.id}`} className="hover:text-primary" dir="auto">{agent.name}</Link> : "—"}</Row>
              <Row label={t("dash.campaigns.f.numbers")}>
                {campaign.numberIds.map((id) => (
                  <bdi key={id} dir="ltr" className="block font-mono text-[13px]">
                    {numberById.get(id)?.e164 ?? `#${id}`}
                  </bdi>
                ))}
              </Row>
              <Row label={t("dash.campaigns.f.lists")}>
                {campaign.listIds.map((id) => (
                  <span key={id} className="block" dir="auto">
                    {listById.get(id)?.name ?? `#${id}`}
                  </span>
                ))}
              </Row>
              <Row label={t("dash.campaigns.f.window")}>
                <bdi dir="ltr">
                  {campaign.window.start}–{campaign.window.end}
                </bdi>
                <span className="block text-xs text-muted">
                  {campaign.window.days.map((d) => t(`dash.campaigns.day.${d}` as MessageKey)).join(", ")} · {campaign.timezoneMode === "contact" ? t("dash.campaigns.f.tzContact") : campaign.timezone.replaceAll("_", " ")}
                </span>
              </Row>
              {campaign.startsAt || campaign.endsAt ? (
                <Row label={t("dash.campaigns.f.dates")}>
                  {campaign.startsAt ? formatDateTime(campaign.startsAt, lc) : "—"} → {campaign.endsAt ? formatDateTime(campaign.endsAt, lc) : "—"}
                </Row>
              ) : null}
              <Row label={t("dash.campaigns.f.retries")}>
                {t("dash.campaigns.attemptsMax", { n: campaign.maxAttempts })}
                <span className="block text-xs text-muted">{campaign.retryOn.length ? campaign.retryOn.map((o) => `${t(`dash.campaigns.outcome.${o}`)} +${campaign.retryDelays[o]} ${t("dash.campaigns.f.minutes")}`).join(", ") : t("dash.campaigns.noRetries")}</span>
              </Row>
              <Row label={t("dash.campaigns.f.pacing")}>
                {t("dash.campaigns.concurrencyN", { n: campaign.concurrency })}
                <span className="block text-xs text-muted">
                  {campaign.dailyCap ? t("dash.campaigns.kpi.cap", { n: num(campaign.dailyCap) }) : t("dash.campaigns.noDailyCap")} · {campaign.abandonMaxPct ? t("dash.campaigns.abandonMax", { n: campaign.abandonMaxPct }) : t("dash.campaigns.abandonOff")}
                </span>
              </Row>
            </dl>
          </Panel>
          <Alert tone="info">{t("dash.campaigns.checksNote")}</Alert>
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
