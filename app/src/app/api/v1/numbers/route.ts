import { apiJson } from "@/lib/api-guard";
import { listNumbers } from "@/lib/numbers";
import { v1Guard } from "../_shared";
import { numberJson } from "../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/numbers: the workspace's phone numbers (the number_id of POST /calls and /campaigns). released=true includes released ones. */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const numbers = await listNumbers(guard.workspace.id, { includeReleased: url.searchParams.get("released") === "true" });
  return apiJson({ data: numbers.map(numberJson), total: numbers.length });
}
