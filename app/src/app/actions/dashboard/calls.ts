"use server";

import { redirect } from "next/navigation";
import { getCall } from "@/lib/calls";
import { addDnc } from "@/lib/contacts";
import { guardWorkspace } from "@/lib/dashboard";
import { eraseCall, eraseCallRecording } from "@/lib/erasure";
import { getT } from "@/lib/i18n/server";
import type { FormState } from "../types";
import { idOf } from "./helpers";

/** Call detail actions. Adding a caller to the do-not-call list needs contacts.manage; deleting a recording or a call (erasure requests) compliance.manage (admins). */

/** "Add to do-not-call": the other party of the call goes on the workspace's DNC list. */
export async function addCallerToDncAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "contacts.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const call = await getCall(guard.workspace.id, idOf(formData.get("call_id")));
  if (!call) return { error: t("dash.call.err.notFound") };
  const phone = call.direction === "inbound" ? call.from : call.to;
  if (!phone) return { error: t("dash.call.err.noPhone") };
  const ok = await addDnc(
    { scope: "workspace", workspaceId: guard.workspace.id, phone, reason: "manual", source: `call:${call.id}`, note: "Added from the call detail page", createdBy: guard.user.id },
    { type: "user", id: guard.user.id },
  );
  return ok ? { success: t("dash.call.dncAdded") } : { error: t("dash.call.err.noPhone") };
}

/** "Delete recording": the audio is deleted from storage and the provider link forgotten (audited). */
export async function deleteCallRecordingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await eraseCallRecording(guard.workspace.id, idOf(formData.get("call_id")), { type: "user", id: guard.user.id });
  return ok ? { success: t("dash.call.recordingDeleted") } : { error: t("dash.call.err.notFound") };
}

/** "Delete call": recording and personal data are erased; an anonymous row keeps the duration and cost for billing (audited). */
export async function eraseCallAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const res = await eraseCall(guard.workspace.id, idOf(formData.get("call_id")), { type: "user", id: guard.user.id });
  if (res === "not_found") return { error: t("dash.call.err.notFound") };
  if (res === "live") return { error: t("dash.call.err.live") };
  redirect(`/dashboard/w/${guard.workspace.id}/calls?erased=1`);
}
