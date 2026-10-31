import { apiError, apiJson } from "@/lib/api-guard";
import { pathId } from "@/lib/api-v1";
import { campaignProgress, getCampaign } from "@/lib/campaigns";
import { v1Guard } from "../../_shared";
import { campaignJson } from "../../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/campaigns/{id}: the campaign and its progress (contacts by state and last outcome). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const campaign = await getCampaign(guard.workspace.id, pathId((await params).id));
  if (!campaign) return apiError(404, "Campaign not found.");
  const progress = await campaignProgress([campaign.id]);
  return apiJson(campaignJson(campaign, progress.get(campaign.id)));
}
