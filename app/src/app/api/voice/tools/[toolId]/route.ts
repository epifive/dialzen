import { headerMap } from "@/lib/voice/ingest";
import { handleToolRequest } from "@/lib/tools/execute";

/**
 * Tool endpoint the voice providers call during a call: POST /api/voice/tools/<toolId>?agent=<id>
 * with the per agent-and-tool secret in X-Dialzen-Tool-Secret. Answers within ~5 s.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request, { params }: { params: Promise<{ toolId: string }> }): Promise<Response> {
  const { toolId } = await params;
  const url = new URL(request.url);
  const raw = (await request.text()).slice(0, 200_000);
  const result = await handleToolRequest({
    toolId: /^\d{1,10}$/.test(toolId) ? Number(toolId) : NaN,
    agentId: /^\d{1,10}$/.test(url.searchParams.get("agent") ?? "") ? Number(url.searchParams.get("agent")) : NaN,
    headers: headerMap(request.headers),
    rawBody: raw,
    query: url.searchParams,
  });
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
