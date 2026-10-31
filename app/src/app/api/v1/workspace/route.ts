import { apiJson } from "@/lib/api-guard";
import { v1Guard } from "../_shared";

export const dynamic = "force-dynamic";

/** GET /api/v1/workspace: the key's workspace, the key owner's role and the plan's limits (a quick key check). */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const e = guard.entitlements;
  return apiJson({
    id: guard.workspace.id,
    name: guard.workspace.name,
    timezone: guard.workspace.timezone,
    role: guard.role,
    plan: {
      name: e.plan?.name ?? null,
      max_agents: e.maxAgents,
      max_numbers: e.maxNumbers,
      max_concurrent_calls: e.maxConcurrentCalls,
      included_minutes_monthly: e.includedMinutesMonthly,
      allow_outbound: e.allowOutbound,
      allow_campaigns: e.allowCampaigns,
    },
  });
}
