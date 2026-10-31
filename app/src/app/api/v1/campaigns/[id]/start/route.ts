import { after } from "next/server";
import { apiError, apiJson } from "@/lib/api-guard";
import { pathId } from "@/lib/api-v1";
import { campaignProgress, getCampaign, resumeCampaign, startCampaign } from "@/lib/campaigns";
import { runCampaignEngine } from "@/lib/campaigns/engine";
import { getCompliance, outboundAccess } from "@/lib/compliance";
import { v1Guard } from "../../../_shared";
import { campaignJson, unprocessable } from "../../../_serialize";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/campaigns/{id}/start: starts a draft campaign (or resumes a paused one). 403 when
 * outbound calls aren't allowed (plan, approval, kill switch), 409 in another status, 422 when its
 * lists are empty.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request, { capability: "campaigns.run", write: true });
  if (!guard.ok) return guard.response;
  const ws = guard.workspace;
  const campaign = await getCampaign(ws.id, pathId((await params).id));
  if (!campaign) return apiError(404, "Campaign not found.");
  if (!guard.entitlements.allowCampaigns) return apiError(403, "This workspace's plan does not include campaigns.");
  const access = await outboundAccess(await getCompliance(ws), guard.entitlements);
  if (!access.ok) return apiError(403, `Outbound calls are not allowed for this workspace right now (${access.reason}).`);
  const actor = { type: "api" as const, id: guard.user.id };
  if (campaign.status === "paused") {
    const res = await resumeCampaign(ws.id, campaign.id, actor, guard.entitlements.allowCampaigns);
    if (!res.ok) return apiError(409, "The campaign can't be resumed in its current status.");
  } else {
    const res = await startCampaign(ws.id, campaign.id, actor, guard.entitlements.allowCampaigns);
    if (!res.ok) return res.error === "empty" ? unprocessable("The campaign's lists have no contacts.") : apiError(409, `The campaign is ${campaign.status}; only draft or paused campaigns can be started.`);
  }
  const fresh = (await getCampaign(ws.id, campaign.id))!;
  if (fresh.status === "running") {
    after(async () => {
      try {
        await runCampaignEngine({ deadline: Date.now() + 8_000, campaignId: fresh.id, maxDials: fresh.concurrency });
      } catch (error) {
        console.error("[dialzen] campaign kick failed:", error);
      }
    });
  }
  const progress = await campaignProgress([fresh.id]);
  return apiJson(campaignJson(fresh, progress.get(fresh.id)));
}
