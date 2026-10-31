import type { Metadata } from "next";
import Link from "next/link";
import { Crown, PhoneOutgoing, Plus } from "lucide-react";
import { RefreshOnce } from "@/components/dashboard/actions";
import { CampaignProgressBar } from "@/components/dashboard/campaign-progress";
import { DashHeader, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { campaignProgress, listCampaigns } from "@/lib/campaigns";
import { getCompliance, outboundAccess } from "@/lib/compliance";
import { formatDateTime } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { campaignStatusTone } from "@/voice/format";
import { roleCan } from "@/voice/normalize";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.campaigns") };
}

/** Campaigns of the workspace with their progress. */
export default async function CampaignsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ deleted?: string }> }) {
  const { user, workspace, role } = await requireWorkspace((await params).wid);
  const [query, t, locale, campaigns, entitlements, compliance] = await Promise.all([searchParams, getT(), getLocale(), listCampaigns(workspace.id), getWorkspaceEntitlements(workspace), getCompliance(workspace)]);
  const progress = await campaignProgress(campaigns.map((c) => c.id));
  const access = await outboundAccess(compliance, entitlements);
  const base = `/dashboard/w/${workspace.id}/campaigns`;
  const canEdit = roleCan(role, "campaigns.edit") && entitlements.allowCampaigns;
  const lc = locale.code;

  return (
    <>
      {query.deleted === "1" ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {t("dash.campaigns.deleted")}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={t("dash.nav.campaigns")}
        description={t("dash.campaigns.subtitle")}
        actions={
          canEdit ? (
            <ButtonLink href={`${base}/new`}>
              <Plus aria-hidden />
              {t("dash.campaigns.new")}
            </ButtonLink>
          ) : null
        }
      />
      {!entitlements.allowCampaigns ? (
        <Alert tone="warning" title={t("dash.campaigns.upgradeTitle")} className="mb-6">
          <p>{t("dash.campaigns.upgrade")}</p>
          {workspace.ownerId === user.id ? (
            <ButtonLink href="/pricing" size="sm" className="mt-3">
              <Crown aria-hidden />
              {t("dash.banner.cta")}
            </ButtonLink>
          ) : null}
        </Alert>
      ) : !access.ok ? (
        <Alert tone="warning" title={t("dash.campaigns.blockedTitle")} className="mb-6">
          {t(`dash.campaigns.blocked.${access.reason}`)}{" "}
          <Link href={`/dashboard/w/${workspace.id}/compliance/outbound`} className="font-medium underline underline-offset-2">
            {t("dash.campaigns.openCompliance")}
          </Link>
        </Alert>
      ) : null}

      <Panel padded={false}>
        {campaigns.length ? (
          <ul className="divide-y divide-line">
            {campaigns.map((c) => {
              const p = progress.get(c.id)!;
              return (
                <li key={c.id} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,280px)] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`${base}/${c.id}`} className="font-medium hover:text-primary" dir="auto">
                        {c.name}
                      </Link>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", campaignStatusTone(c.status))}>{t(`dash.campaigns.status.${c.status}` as MessageKey)}</span>
                      <span className="rounded-full bg-line/70 px-2 py-0.5 text-xs text-muted">{t(`dash.campaigns.purpose.${c.purpose}`)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {c.pausedReason ? t(`dash.campaigns.pausedReason.${c.pausedReason}` as MessageKey) : c.status === "completed" || c.status === "canceled" ? t("dash.campaigns.endedOn", { date: formatDateTime(c.completedAt, lc) }) : t("dash.campaigns.window", { start: c.window.start, end: c.window.end })}
                    </p>
                  </div>
                  <CampaignProgressBar progress={p} t={t} locale={lc} compact />
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty
            icon={<PhoneOutgoing />}
            title={t("dash.campaigns.emptyTitle")}
            action={
              canEdit ? (
                <ButtonLink href={`${base}/new`} size="sm">
                  <Plus aria-hidden />
                  {t("dash.campaigns.new")}
                </ButtonLink>
              ) : null
            }
          >
            {t("dash.campaigns.emptyText")}
          </Empty>
        )}
      </Panel>
    </>
  );
}
