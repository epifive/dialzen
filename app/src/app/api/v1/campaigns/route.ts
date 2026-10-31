import { apiError, apiJson } from "@/lib/api-guard";
import { apiCreated, readApiJson } from "@/lib/api-v1";
import { campaignProgress, createCampaign, listCampaigns, type CampaignError } from "@/lib/campaigns";
import { asObj, idList, str } from "@/voice/normalize";
import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/voice/types";
import { timestampFrom, v1Guard } from "../_shared";
import { campaignJson, unprocessable } from "../_serialize";

export const dynamic = "force-dynamic";

const ERRORS: Record<CampaignError, string> = {
  name: "name is required (up to 120 characters).",
  agent: "agent_id must be an agent of this workspace.",
  number: "number_ids must contain at least one phone number of this workspace.",
  list: "list_ids must contain at least one contact list of this workspace.",
  dates: "ends_at must be after starts_at.",
  window: "calling_window needs start < end (HH:MM) and at least one day (1 = Monday … 7 = Sunday).",
  timezone: "timezone must be a valid IANA zone when timezone_mode is campaign.",
  concurrency: "concurrency is higher than the plan allows.",
  status: "The campaign can't be changed in its current status.",
  not_found: "Campaign not found.",
  plan: "This workspace's plan does not include campaigns.",
};

/** GET /api/v1/campaigns: every campaign with its progress. Filter: status. */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const status = new URL(request.url).searchParams.get("status");
  const campaigns = await listCampaigns(guard.workspace.id, { status: (CAMPAIGN_STATUSES as readonly string[]).includes(status ?? "") ? (status as CampaignStatus) : undefined });
  const progress = await campaignProgress(campaigns.map((c) => c.id));
  return apiJson({ data: campaigns.map((c) => campaignJson(c, progress.get(c.id))), total: campaigns.length });
}

/**
 * POST /api/v1/campaigns: creates a draft campaign. Body: { name, agent_id, number_ids | number_id,
 * list_ids | list_id, purpose, starts_at?, ends_at?, calling_window?: { start, end, days },
 * timezone_mode?: contact | campaign, timezone?, max_attempts?, retry_on?, retry_delays_min?,
 * concurrency?, daily_cap?, variables?, abandon_max_pct? }. Start it with POST /campaigns/{id}/start.
 */
export async function POST(request: Request) {
  const guard = await v1Guard(request, { capability: "campaigns.edit", write: true });
  if (!guard.ok) return guard.response;
  if (!guard.entitlements.allowCampaigns) return apiError(403, ERRORS.plan);
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const startsAt = timestampFrom(body.starts_at);
  const endsAt = timestampFrom(body.ends_at);
  if (startsAt === "invalid" || endsAt === "invalid") return unprocessable("starts_at / ends_at must be ISO-8601 times with a time zone.");
  const res = await createCampaign(
    guard.workspace.id,
    {
      name: str(body.name, "", 120),
      agentId: Number(body.agent_id),
      numberIds: idList(body.number_ids ?? (body.number_id !== undefined ? [body.number_id] : [])),
      listIds: idList(body.list_ids ?? (body.list_id !== undefined ? [body.list_id] : [])),
      purpose: str(body.purpose, "informational"),
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      window: body.calling_window !== undefined ? asObj(body.calling_window) : { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5] },
      timezoneMode: str(body.timezone_mode, "contact"),
      timezone: str(body.timezone, guard.workspace.timezone),
      maxAttempts: body.max_attempts === undefined ? 3 : Number(body.max_attempts),
      retryOn: Array.isArray(body.retry_on) ? body.retry_on : undefined,
      retryDelays: asObj(body.retry_delays_min),
      concurrency: body.concurrency === undefined ? 1 : Number(body.concurrency),
      dailyCap: body.daily_cap === undefined ? 0 : Number(body.daily_cap),
      variables: asObj(body.variables),
      abandonMaxPct: body.abandon_max_pct === undefined ? 3 : Number(body.abandon_max_pct),
    },
    { maxConcurrency: guard.entitlements.maxConcurrentCalls, userId: guard.user.id, actor: "api" },
  );
  if (!res.ok) return unprocessable(ERRORS[res.error], { field: res.error });
  return apiCreated(campaignJson(res.campaign));
}
