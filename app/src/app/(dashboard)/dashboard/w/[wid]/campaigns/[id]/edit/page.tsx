import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/dashboard/campaign-form";
import { DashHeader } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getCampaign } from "@/lib/campaigns";
import { campaignFormOptions, campaignFormValues } from "@/lib/campaigns/view";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { getWorkspaceEntitlements } from "@/lib/workspaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.campaigns.edit") };
}

export default async function EditCampaignPage({ params }: { params: Promise<{ wid: string; id: string }> }) {
  const p = await params;
  const { workspace } = await requireWorkspace(p.wid, "editor");
  const campaign = await getCampaign(workspace.id, Number(p.id));
  if (!campaign) notFound();
  const [t, entitlements] = await Promise.all([getT(), getWorkspaceEntitlements(workspace)]);
  const back = `/dashboard/w/${workspace.id}/campaigns/${campaign.id}`;
  const editable = ["draft", "scheduled", "paused"].includes(campaign.status);
  return (
    <>
      <DashHeader
        title={t("dash.campaigns.edit")}
        description={campaign.name}
        actions={
          <ButtonLink href={back} variant="outline">
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
            {t("dash.campaigns.back")}
          </ButtonLink>
        }
      />
      <div className="max-w-3xl">
        {editable ? <CampaignForm workspaceId={workspace.id} values={campaignFormValues(campaign, workspace)} options={await campaignFormOptions(workspace, entitlements)} /> : <Alert tone="warning">{t("dash.campaigns.notEditable")}</Alert>}
      </div>
    </>
  );
}
