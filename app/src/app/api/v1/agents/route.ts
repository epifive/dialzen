import { apiJson } from "@/lib/api-guard";
import { listAgents } from "@/lib/agents";
import { v1Guard } from "../_shared";
import { agentJson } from "../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/agents: the workspace's agents. */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const agents = await listAgents(guard.workspace.id);
  return apiJson({ data: agents.map(agentJson), total: agents.length });
}
