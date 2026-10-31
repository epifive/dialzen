import { apiError, apiJson } from "@/lib/api-guard";
import { pathId } from "@/lib/api-v1";
import { campaignProgress, getCampaign, pauseCampaign } from "@/lib/campaigns";
import { v1Guard } from "../../../_shared";
import { campaignJson } from "../../../_serialize";

export const dynamic = "force-dynamic";

/** POST /api/v1/campaigns/{id}/pause: pauses a running or scheduled campaign (calls in progress finish). 409 otherwise. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request, { capability: "campaigns.edit", write: true });
  if (!guard.ok) return guard.response;
  const campaign = await getCampaign(guard.workspace.id, pathId((await params).id));
  if (!campaign) return apiError(404, "Campaign not found.");
  const ok = await pauseCampaign(guard.workspace.id, campaign.id, { type: "api", id: guard.user.id });
  if (!ok) return apiError(409, `The campaign is ${campaign.status}; only running or scheduled campaigns can be paused.`);
  const fresh = (await getCampaign(guard.workspace.id, campaign.id))!;
  const progress = await campaignProgress([fresh.id]);
  return apiJson(campaignJson(fresh, progress.get(fresh.id)));
}
