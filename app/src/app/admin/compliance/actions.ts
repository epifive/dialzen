"use server";

import { auditSafe } from "@/lib/audit";
import { reviewKyc, setKillSwitch, setOutboundState } from "@/lib/compliance";
import { removeDnc } from "@/lib/contacts";
import { getDb } from "@/lib/db";
import { addDncBulk, parsePhoneList } from "@/lib/dnc";
import { guardAdmin } from "@/lib/admin";
import { buildNotifyPayload, notifyWorkspace, workspaceDashboardPath } from "@/lib/notify";
import { updateSettings } from "@/lib/settings";
import { getWorkspace } from "@/lib/workspaces";
import type { FormState } from "@/app/actions/types";

/** Admin → Compliance: KYC review, kill switches, outbound suspension and the global DNC list. */

const s = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function reviewKycAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const id = Number(s(fd.get("request_id")));
  const decision = s(fd.get("decision")) === "approved" ? "approved" : "rejected";
  const note = s(fd.get("note")).trim();
  if (decision === "rejected" && note.length < 5) return { error: "Tell the workspace why (at least 5 characters): they see this note." };
  const db = await getDb();
  const req = await db.selectFrom("kyc_requests").select(["workspace_id", "business_name"]).where("id", "=", id).executeTakeFirst();
  if (!req) return { error: "This request no longer exists." };
  const ok = await reviewKyc(id, decision, note, guard.user.id);
  if (!ok) return { error: "This request was already reviewed." };
  const ws = await getWorkspace(req.workspace_id);
  if (ws) {
    const message = decision === "approved" ? `Outbound calling was approved for ${ws.name}. You can start campaigns and outbound API calls.` : `Outbound calling was not approved for ${ws.name}.${note ? ` Note from the administrator: ${note}` : ""}`;
    const payload = await buildNotifyPayload(ws, "outbound_decided", message, { decision, note }, workspaceDashboardPath(ws.id, "compliance/outbound"));
    await notifyWorkspace(ws.id, payload, { ownerFallback: true });
  }
  return { success: decision === "approved" ? `${req.business_name} approved.` : `${req.business_name} declined.` };
}

export async function setGlobalKillAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const on = s(fd.get("on")) === "1";
  await updateSettings({ outbound_kill_switch: on });
  await auditSafe({ workspaceId: null, actor: { type: "admin", id: guard.user.id }, action: on ? "kill_switch.global_on" : "kill_switch.global_off", entityType: "platform", entityId: "outbound" });
  return { success: on ? "All outbound calls are stopped." : "Outbound calls are allowed again." };
}

export async function setWorkspaceKillAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const ws = await getWorkspace(Number(s(fd.get("workspace_id"))));
  if (!ws) return { error: "Workspace not found." };
  const on = s(fd.get("on")) === "1";
  const reason = s(fd.get("reason")).trim();
  if (on && reason.length < 3) return { error: "Give a reason (the workspace's audit log keeps it)." };
  await setKillSwitch(ws.id, on, reason, guard.user.id);
  return { success: on ? `Outbound calls of ${ws.name} stopped.` : `Kill switch of ${ws.name} turned off.` };
}

export async function setOutboundStateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const ws = await getWorkspace(Number(s(fd.get("workspace_id"))));
  if (!ws) return { error: "Workspace not found." };
  const state = s(fd.get("state")) === "approved" ? "approved" : "suspended";
  await setOutboundState(ws.id, state, guard.user.id, s(fd.get("reason")));
  const payload = await buildNotifyPayload(ws, "outbound_decided", state === "approved" ? `Outbound calling of ${ws.name} is allowed again.` : `Outbound calling of ${ws.name} was suspended by the administrator.`, { decision: state }, workspaceDashboardPath(ws.id, "compliance/outbound"));
  await notifyWorkspace(ws.id, payload, { ownerFallback: true });
  return { success: state === "approved" ? `${ws.name} can call again.` : `${ws.name} suspended.` };
}

export async function uploadGlobalDncAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  let text = s(fd.get("numbers"));
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) return { error: "The file is too large (up to 4 MB)." };
    text = `${text}\n${await file.text()}`;
  }
  const parsed = parsePhoneList(text, s(fd.get("country")) || "US");
  if (!parsed.phones.length) return { error: "No valid phone numbers found." };
  const res = await addDncBulk({ scope: "global", workspaceId: 0, phones: parsed.phones, reason: "admin", source: "admin", listRef: s(fd.get("list_ref")), note: s(fd.get("note")), actor: { type: "admin", id: guard.user.id } });
  return { success: `${res.added} numbers added to the global list, ${res.existing} were already on it, ${parsed.invalid} invalid.` };
}

export async function removeGlobalDncAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const ok = await removeDnc("global", 0, s(fd.get("phone")), { type: "admin", id: guard.user.id });
  return ok ? { success: "Number removed from the global list." } : { error: "This number isn't on the global list." };
}
