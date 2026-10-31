import { apiError, apiJson } from "@/lib/api-guard";
import { pathId } from "@/lib/api-v1";
import { deleteNotifyChannel, getNotifyChannel } from "@/lib/notify-channels";
import { v1Guard } from "../../_shared";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/webhooks/{id} */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await v1Guard(request, { capability: "settings.manage", write: true });
  if (!guard.ok) return guard.response;
  const channel = await getNotifyChannel(guard.workspace.id, pathId((await params).id));
  if (!channel || channel.type !== "webhook") return apiError(404, "Webhook not found.");
  await deleteNotifyChannel(channel);
  return apiJson({ id: channel.id, deleted: true });
}
