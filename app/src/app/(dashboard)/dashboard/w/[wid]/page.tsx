import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Globe, PhoneIncoming, PhoneOutgoing, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { RefreshOnce } from "@/components/dashboard/actions";
import { CampaignProgressBar } from "@/components/dashboard/campaign-progress";
import { CheckItem, Kpi, KpiGrid } from "@/components/dashboard/kit";
import { DashHeader, Empty, Meter, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { countOwnerAgents, listAgents } from "@/lib/agents";
import { activeCampaigns, campaignProgress } from "@/lib/campaigns";
import { callStats, countLiveCalls, listCalls } from "@/lib/calls";
import { getCompliance, outboundAccess } from "@/lib/compliance";
import { formatNumber, formatRelative } from "@/lib/dash-format";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/dashboard";
import { dayBoundsIso, localDay } from "@/lib/jobs/shared";
import type { MessageKey } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { countOwnerNumbers } from "@/lib/numbers";
import { getSettings } from "@/lib/settings";
import { getUsage } from "@/lib/usage";
import { getWallet } from "@/lib/wallet";
import { countSeats, getWorkspaceEntitlements } from "@/lib/workspaces";
import { callStatusTone, campaignStatusTone, formatDuration, formatMicros, kycStatusTone } from "@/voice/format";
import { formatPhone, hasAiDisclosure, roleCan } from "@/voice/normalize";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.home") };
}

/** ISO time `n` days ago (outside the component: render must stay pure). */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Start of today in a zone. */
function todayStartIso(tz: string): string {
  return dayBoundsIso(localDay(Date.now(), tz), tz).start;
}

const DIRECTION_ICON = { inbound: PhoneIncoming, outbound: PhoneOutgoing, web: Globe } as const;
const OUTCOME_KEYS = new Set(["booked", "transferred", "opted_out"]);

/** Workspace home: today at a glance, live calls, credits, campaigns, compliance status and the setup checklist. */
export default async function WorkspaceHome({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ created?: string }> }) {
  const { user, workspace, role } = await requireWorkspace((await params).wid);
  const todayStart = todayStartIso(workspace.timezone);
  const [query, t, locale, settings, entitlements, agents, recent, today, week, live, wallet, usage, seats, agentsUsed, numbersUsed, compliance, campaigns] = await Promise.all([
    searchParams,
    getT(),
    getLocale(),
    getSettings(),
    getWorkspaceEntitlements(workspace),
    listAgents(workspace.id),
    listCalls(workspace.id, { limit: 6 }),
    callStats(workspace.id, todayStart),
    callStats(workspace.id, daysAgoIso(7)),
    countLiveCalls([workspace.id]),
    getWallet(workspace.id),
    getUsage(workspace.ownerId),
    countSeats(workspace.ownerId),
    countOwnerAgents(workspace.ownerId),
    countOwnerNumbers(workspace.ownerId),
    getCompliance(workspace),
    activeCampaigns(workspace.id),
  ]);
  const db = await getDb();
  const [webCall, contact, campaignAny, progress, access] = await Promise.all([
    db.selectFrom("calls").select("id").where("workspace_id", "=", workspace.id).where("direction", "=", "web").executeTakeFirst(),
    db.selectFrom("contacts").select("id").where("workspace_id", "=", workspace.id).executeTakeFirst(),
    db.selectFrom("campaigns").select("id").where("workspace_id", "=", workspace.id).executeTakeFirst(),
    campaignProgress(campaigns.map((c) => c.id)),
    outboundAccess(compliance, entitlements),
  ]);
  const lc = locale.code;
  const base = `/dashboard/w/${workspace.id}`;
  const num = (n: number) => formatNumber(n, lc);
  const limitText = (n: number) => (n < 0 ? t("pricing.unlimited") : num(n));
  const currency = settings.currency || "USD";
  const isOwner = workspace.ownerId === user.id;
  const canAgents = roleCan(role, "agents.manage");
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  const minutesUsed = Math.floor(usage.secondsUsed / 60);
  const included = entitlements.includedMinutesMonthly;
  const steps = {
    agent: agents.length > 0,
    test: Boolean(webCall),
    number: numbersUsed > 0,
    contacts: Boolean(contact),
    campaign: Boolean(campaignAny),
  };
  const setupDone = Object.values(steps).every(Boolean);
  const warnings: string[] = [];
  if (!compliance.settings.callbackNumber) warnings.push(t("dash.home.warnCallback"));
  if (agents.some((a) => !hasAiDisclosure(a.firstMessage))) warnings.push(t("dash.home.warnDisclosure"));
  if (wallet.lowBalanceMicros > 0 && wallet.balanceMicros < wallet.lowBalanceMicros) warnings.push(t("dash.home.warnBalance"));

  return (
    <div className="space-y-6">
      {query.created === "1" ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success">{t("dash.ws.created")}</Alert>
        </>
      ) : null}
      <DashHeader
        title={workspace.name}
        description={t("dash.home.subtitle", { timezone: workspace.timezone.replaceAll("_", " ") })}
        actions={
          canAgents ? (
            <ButtonLink href={`${base}/agents`}>
              <Plus aria-hidden />
              {t("dash.home.newAgent")}
            </ButtonLink>
          ) : null
        }
      />

      <KpiGrid className="grid-cols-2 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <Kpi label={t("dash.home.kpiToday")} value={num(today.calls)} hint={t("dash.home.kpiWeek", { n: num(week.calls) })} />
        <Kpi label={t("dash.home.kpiLive")} value={num(live)} accent={live ? "bg-emerald-500" : undefined} />
        <Kpi label={t("dash.home.kpiAnswered")} value={week.calls ? `${Math.round((week.completed / week.calls) * 100)}%` : "–"} hint={t("dash.home.kpi7d")} />
        <Kpi label={t("dash.home.kpiMinutesMonth")} value={num(minutesUsed)} hint={included < 0 ? t("pricing.unlimited") : t("dash.home.kpiIncludedOf", { n: num(included) })} />
        <Kpi label={t("dash.home.kpiBalance")} value={<bdi>{formatMicros(wallet.balanceMicros, currency, lc)}</bdi>} hint={wallet.reservedMicros > 0 ? t("dash.home.kpiReserved", { amount: formatMicros(wallet.reservedMicros, currency, lc) }) : undefined} />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel
            title={t("dash.home.recentCalls")}
            padded={false}
            actions={
              recent.total ? (
                <Link href={`${base}/calls`} className="text-sm font-medium text-primary hover:underline">
                  {t("dash.home.viewCalls")}
                </Link>
              ) : null
            }
          >
            {recent.calls.length ? (
              <ul className="divide-y divide-line">
                {recent.calls.map((c) => {
                  const Icon = DIRECTION_ICON[c.direction];
                  const other = c.direction === "inbound" ? c.from : c.to;
                  const outcome = c.outcome && OUTCOME_KEYS.has(c.outcome) ? c.outcome : null;
                  return (
                    <li key={c.id}>
                      <Link href={`${base}/calls/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary" title={t(`dash.call.dir.${c.direction}` as MessageKey)}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            <bdi dir="ltr">{other ? formatPhone(other) : t(`dash.call.dir.${c.direction}` as MessageKey)}</bdi>
                            {c.agentId && agentName.get(c.agentId) ? <span className="text-muted"> · {agentName.get(c.agentId)}</span> : null}
                          </span>
                          <span className="block truncate text-xs text-muted">{c.summary || formatRelative(c.createdAt, lc)}</span>
                        </span>
                        <span className="hidden text-xs text-muted tabular-nums sm:inline">{formatDuration(c.durationSec)}</span>
                        {outcome ? <span className="hidden rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 sm:inline dark:bg-emerald-950 dark:text-emerald-300">{t(`dash.analytics.outcome.${outcome}` as MessageKey)}</span> : null}
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", callStatusTone(c.status))}>{t(`dash.call.status.${c.status}` as MessageKey)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty
                icon={<Bot className="size-6" aria-hidden />}
                title={t("dash.home.noCalls")}
                action={
                  canAgents && !agents.length ? (
                    <ButtonLink href={`${base}/agents`} size="sm">
                      <Plus aria-hidden />
                      {t("dash.home.newAgent")}
                    </ButtonLink>
                  ) : null
                }
              >
                {t("dash.home.noCallsText")}
              </Empty>
            )}
          </Panel>

          {campaigns.length ? (
            <Panel
              title={t("dash.home.campaigns")}
              padded={false}
              actions={
                <Link href={`${base}/campaigns`} className="text-sm font-medium text-primary hover:underline">
                  {t("dash.home.allCampaigns")}
                </Link>
              }
            >
              <ul className="divide-y divide-line">
                {campaigns.map((c) => (
                  <li key={c.id} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)] sm:items-center">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link href={`${base}/campaigns/${c.id}`} className="truncate text-sm font-medium hover:text-primary" dir="auto">
                        {c.name}
                      </Link>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", campaignStatusTone(c.status))}>{t(`dash.campaigns.status.${c.status}` as MessageKey)}</span>
                    </div>
                    <CampaignProgressBar progress={progress.get(c.id)!} t={t} locale={lc} compact />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Panel
            title={t("dash.home.compliance")}
            actions={
              <Link href={`${base}/compliance`} className="text-sm font-medium text-primary hover:underline">
                {t("dash.home.open")}
              </Link>
            }
          >
            <div className="flex items-start gap-3">
              {access.ok ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-500" aria-hidden /> : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden />}
              <div className="min-w-0 text-sm">
                <p className="font-medium">{access.ok ? t("dash.home.outboundOn") : t("dash.home.outboundOff")}</p>
                <p className="mt-0.5 text-xs text-muted">{access.ok ? t("dash.home.outboundOnText") : t(`dash.campaigns.blocked.${access.reason}`)}</p>
                <span className={cn("mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium", kycStatusTone(compliance.outboundState))}>{t(`dash.compliance.state.${compliance.outboundState}` as MessageKey)}</span>
              </div>
            </div>
            {warnings.length ? (
              <ul className="mt-4 list-disc space-y-1 border-t border-line ps-5 pt-3 text-xs text-amber-800 dark:text-amber-300">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Panel>

          {!setupDone ? (
            <Panel title={t("dash.home.gettingStarted")}>
              <ul>
                <CheckItem done={steps.agent} title={t("dash.home.step1")} text={t("dash.home.step1Text")} action={<StepLink href={`${base}/agents`} label={t("dash.home.go")} />} />
                <CheckItem done={steps.test} title={t("dash.home.stepTest")} text={t("dash.home.stepTestText")} action={<StepLink href={`${base}/agents`} label={t("dash.home.go")} />} />
                <CheckItem done={steps.number} title={t("dash.home.step4")} text={t("dash.home.step4Text")} action={<StepLink href={`${base}/numbers`} label={t("dash.home.go")} />} />
                <CheckItem done={steps.contacts} title={t("dash.home.stepContacts")} text={t("dash.home.stepContactsText")} action={<StepLink href={`${base}/contacts/import`} label={t("dash.home.go")} />} />
                <CheckItem done={steps.campaign} title={t("dash.home.stepCampaign")} text={t("dash.home.stepCampaignText")} action={<StepLink href={`${base}/campaigns`} label={t("dash.home.go")} />} />
              </ul>
            </Panel>
          ) : null}

          <Panel title={t("dash.home.usage")} description={isOwner ? t("dash.home.usageOwn") : t("dash.home.usageOwner")}>
            <div className="space-y-4">
              <Meter label={t("dash.home.meterAgents")} used={agentsUsed} limit={entitlements.maxAgents} usedText={num(agentsUsed)} limitText={limitText(entitlements.maxAgents)} />
              {entitlements.maxNumbers === 0 ? (
                <p className="text-xs text-muted">{t("dash.home.noNumbers")}</p>
              ) : (
                <Meter label={t("dash.home.meterNumbers")} used={numbersUsed} limit={entitlements.maxNumbers} usedText={num(numbersUsed)} limitText={limitText(entitlements.maxNumbers)} />
              )}
              <Meter label={t("dash.home.meterMinutes")} used={minutesUsed} limit={included} usedText={num(minutesUsed)} limitText={limitText(included)} />
              <Meter label={t("dash.home.meterSeats")} used={seats} limit={entitlements.maxMembers} usedText={num(seats)} limitText={limitText(entitlements.maxMembers)} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-xs font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}
