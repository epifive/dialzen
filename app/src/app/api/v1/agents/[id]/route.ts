import { apiError, apiJson } from "@/lib/api-guard";
import { getAgent } from "@/lib/agents";
import { pathId } from "@/lib/api-v1";
import { v1Guard } from "../../_shared";
import { agentJson } from "../../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/agents/{id} */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const agent = await getAgent(guard.workspace.id, pathId((await params).id));
  if (!agent) return apiError(404, "Agent not found.");
  return apiJson(agentJson(agent));
}
