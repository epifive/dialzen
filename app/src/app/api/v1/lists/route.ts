import { apiJson } from "@/lib/api-guard";
import { apiCreated, readApiJson } from "@/lib/api-v1";
import { auditSafe } from "@/lib/audit";
import { createContactList, listContactLists } from "@/lib/contacts";
import { str } from "@/voice/normalize";
import { v1Guard } from "../_shared";
import { listJson, unprocessable } from "../_serialize";

export const dynamic = "force-dynamic";

/** GET /api/v1/lists: the workspace's contact lists with their member counts (the list_ids of POST /campaigns). */
export async function GET(request: Request) {
  const guard = await v1Guard(request);
  if (!guard.ok) return guard.response;
  const lists = await listContactLists(guard.workspace.id);
  return apiJson({ data: lists.map(listJson), total: lists.length });
}

/** POST /api/v1/lists {name, description?}: creates a contact list (add contacts with POST /contacts list_ids). */
export async function POST(request: Request) {
  const guard = await v1Guard(request, { capability: "contacts.manage", write: true });
  if (!guard.ok) return guard.response;
  const body = await readApiJson(request);
  if (body instanceof Response) return body;
  const name = str(body.name, "", 120).trim();
  if (!name) return unprocessable("name is required (at most 120 characters).");
  const id = await createContactList(guard.workspace.id, name, str(body.description, "", 500));
  await auditSafe({ workspaceId: guard.workspace.id, actor: { type: "api", id: guard.user.id }, action: "contacts.list_created", entityType: "list", entityId: id, data: { name } });
  const list = (await listContactLists(guard.workspace.id)).find((l) => l.id === id);
  return apiCreated(list ? listJson(list) : { id, name });
}
