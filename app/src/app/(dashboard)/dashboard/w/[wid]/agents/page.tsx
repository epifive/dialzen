import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Copy, Hash, Languages, Mic, Pencil, PhoneCall, Plus, Trash } from "lucide-react";
import { deleteAgentAction, duplicateAgentAction } from "@/app/actions/dashboard/agents";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { SyncBadge } from "@/components/dashboard/agent-badges";
import { DashHeader, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { countOwnerAgents, listAgents } from "@/lib/agents";
import { formatNumber, formatRelative } from "@/lib/dash-format";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { atLimit } from "@/lib/plans";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { agentStatusTone, languageName, providerName } from "@/voice/format";
import { roleCan } from "@/voice/normalize";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.agents") };
}

function weekAgoIso(): string {
  return new Date(Date.now() - 7 * 86_400_000).toISOString();
}

/** Agents of the workspace as cards: provider, language, voice, sync state, numbers and recent calls. */
export default async function AgentsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ deleted?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [query, t, locale, agents, entitlements, used] = await Promise.all([searchParams, getT(), getLocale(), listAgents(workspace.id), getWorkspaceEntitlements(workspace), countOwnerAgents(workspace.ownerId)]);
  const lc = locale.code;
  const db = await getDb();
  const since = weekAgoIso();
  const [numberRows, callRows] = await Promise.all([
    db.selectFrom("phone_numbers").select(["inbound_agent_id", "outbound_agent_id"]).where("workspace_id", "=", workspace.id).where("status", "!=", "released").execute(),
    db
      .selectFrom("calls")
      .select(["agent_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("workspace_id", "=", workspace.id)
      .where("created_at", ">=", since)
      .groupBy("agent_id")
      .execute(),
  ]);
  const numbers = new Map<number, number>();
  for (const r of numberRows) {
    for (const id of new Set([r.inbound_agent_id, r.outbound_agent_id])) if (id) numbers.set(id, (numbers.get(id) ?? 0) + 1);
  }
  const calls = new Map(callRows.map((r) => [Number(r.agent_id), Number(r.n)]));
  const base = `/dashboard/w/${workspace.id}/agents`;
  const canManage = roleCan(role, "agents.manage");
  const full = atLimit(used, entitlements.maxAgents);
  const limitText = entitlements.maxAgents < 0 ? t("pricing.unlimited") : formatNumber(entitlements.maxAgents, lc);

  return (
    <>
      {query.deleted === "1" ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {t("dash.agents.deleted")}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={t("dash.nav.agents")}
        description={
          <>
            {t("dash.agents.subtitle")} <span className="whitespace-nowrap">{entitlements.maxAgents < 0 ? t("dash.agents.usageUnlimited", { used: formatNumber(used, lc) }) : t("dash.agents.usage", { used: formatNumber(used, lc), limit: limitText })}</span>
          </>
        }
        actions={
          canManage ? (
            full ? (
              <ButtonLink href="/pricing" variant="secondary">
                {t("dash.agents.upgrade")}
              </ButtonLink>
            ) : (
              <ButtonLink href={`${base}/new`}>
                <Plus aria-hidden />
                {t("dash.agents.new")}
              </ButtonLink>
            )
          ) : null
        }
      />
      {full && canManage ? (
        <Alert tone="warning" className="mb-6">
          {t("dash.agents.limitReached", { limit: limitText })}
        </Alert>
      ) : null}
      {agents.length ? (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li key={agent.id} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface">
              <div className="flex items-start gap-3 p-5 pb-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Bot className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`${base}/${agent.id}`} dir="auto" className="block truncate font-semibold hover:text-primary">
                    {agent.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", agentStatusTone(agent.status))}>{t(`dash.agent.status.${agent.status}`)}</span>
                    <SyncBadge status={agent.syncStatus} error={agent.syncError} />
                  </div>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 pb-4 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted">{t("dash.agents.provider")}</dt>
                  <dd className="truncate">{providerName(agent.provider, t)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="flex items-center gap-1 text-xs text-muted">
                    <Languages className="size-3" aria-hidden />
                    {t("dash.agents.language")}
                  </dt>
                  <dd className="truncate">{languageName(agent.language)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="flex items-center gap-1 text-xs text-muted">
                    <Mic className="size-3" aria-hidden />
                    {t("dash.agents.voice")}
                  </dt>
                  <dd className="truncate" dir="auto">
                    {agent.voiceName || agent.voiceId || <span className="text-muted">{t("dash.agents.defaultVoice")}</span>}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="flex items-center gap-1 text-xs text-muted">
                    <Hash className="size-3" aria-hidden />
                    {t("dash.agents.numbers")}
                  </dt>
                  <dd className="tabular-nums">{formatNumber(numbers.get(agent.id) ?? 0, lc)}</dd>
                </div>
                <div className="col-span-2 min-w-0">
                  <dt className="flex items-center gap-1 text-xs text-muted">
                    <PhoneCall className="size-3" aria-hidden />
                    {t("dash.agents.calls7d")}
                  </dt>
                  <dd>
                    <Link href={`/dashboard/w/${workspace.id}/calls?agent=${agent.id}`} className="tabular-nums hover:text-primary">
                      {formatNumber(calls.get(agent.id) ?? 0, lc)}
                    </Link>
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-2 px-5 pb-3 text-xs text-muted">
                {agent.template ? <Badge>{t(`dash.tpl.${agent.template}.name` as Parameters<typeof t>[0])}</Badge> : null}
                <span>{t("dash.agents.updated", { when: formatRelative(agent.updatedAt, lc) })}</span>
              </div>
              <div className="mt-auto flex flex-wrap items-start gap-2 border-t border-line px-5 py-3">
                <ButtonLink href={`${base}/${agent.id}`} variant="outline" size="sm">
                  <Pencil aria-hidden />
                  {canManage ? t("dash.agents.edit") : t("dash.agents.view")}
                </ButtonLink>
                <ButtonLink href={`${base}/${agent.id}?tab=test`} variant="outline" size="sm">
                  <PhoneCall aria-hidden />
                  {t("dash.agents.test")}
                </ButtonLink>
                {canManage ? (
                  <>
                    {!full ? (
                      <ActionButton action={duplicateAgentAction} fields={{ wid: workspace.id, agent_id: agent.id }} label={t("dash.agents.duplicate")}>
                        <Copy aria-hidden />
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      action={deleteAgentAction}
                      fields={{ wid: workspace.id, agent_id: agent.id }}
                      confirmText={t("dash.agents.deleteConfirm", { name: agent.name })}
                      label={t("dash.agents.delete")}
                      buttonClassName="hover:border-red-300 hover:text-red-600"
                    >
                      <Trash aria-hidden />
                    </ActionButton>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Panel>
          <Empty icon={<Bot />} title={t("dash.agents.emptyTitle")} action={canManage ? <ButtonLink href={`${base}/new`}>{t("dash.agents.new")}</ButtonLink> : null}>
            {t("dash.agents.emptyText")}
          </Empty>
        </Panel>
      )}
    </>
  );
}
