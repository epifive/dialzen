import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/dashboard/campaign-form";
import { DashHeader } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { campaignFormOptions, campaignFormValues } from "@/lib/campaigns/view";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { getWorkspaceEntitlements } from "@/lib/workspaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.campaigns.new") };
}

export default async function NewCampaignPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ list?: string }> }) {
  const { workspace } = await requireWorkspace((await params).wid, "editor");
  const [query, t, entitlements] = await Promise.all([searchParams, getT(), getWorkspaceEntitlements(workspace)]);
  if (!entitlements.allowCampaigns) notFound();
  const options = await campaignFormOptions(workspace, entitlements);
  const list = Number(query.list);
  const values = campaignFormValues(null, workspace, {
    agentId: options.agents[0]?.id ?? null,
    numberIds: options.numbers.filter((n) => n.active && n.outboundEnabled).slice(0, 1).map((n) => n.id),
    listIds: Number.isInteger(list) && options.lists.some((l) => l.id === list) ? [list] : [],
  });
  return (
    <>
      <DashHeader
        title={t("dash.campaigns.new")}
        description={t("dash.campaigns.newText")}
        actions={
          <ButtonLink href={`/dashboard/w/${workspace.id}/campaigns`} variant="outline">
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
            {t("dash.nav.campaigns")}
          </ButtonLink>
        }
      />
      <div className="max-w-3xl">
        <CampaignForm workspaceId={workspace.id} values={values} options={options} />
      </div>
    </>
  );
}
