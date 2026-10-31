import { apiError, apiJson } from "@/lib/api-guard";
import { pathId } from "@/lib/api-v1";
import { getCall } from "@/lib/calls";
import { eraseCall } from "@/lib/erasure";
import { v1Guard } from "../../_shared";
import { callJson } from "../../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/calls/{id}: one call with its transcript, summary, sentiment and extracted data. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const call = await getCall(guard.workspace.id, pathId((await params).id));
  if (!call) return apiError(404, "Call not found.");
  return apiJson(callJson(call, { transcript: true }));
}

/**
 * DELETE /api/v1/calls/{id}: erases a finished call (erasure requests): its recording, transcript,
 * summary, extracted data and phone numbers. An anonymous record of the duration and cost stays for
 * billing. Admin keys only; 409 while the call is in progress.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request, { capability: "compliance.manage", write: true });
  if (!guard.ok) return guard.response;
  const res = await eraseCall(guard.workspace.id, pathId((await params).id), { type: "api", id: guard.user.id });
  if (res === "not_found") return apiError(404, "Call not found.");
  if (res === "live") return apiError(409, "The call is still in progress. Erase it once it has ended.");
  return apiJson({ id: pathId((await params).id), erased: true });
}
