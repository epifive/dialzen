import "server-only";
import crypto from "node:crypto";
import { auditSafe, type AuditActorType } from "./audit";
import { getCall, type CallRecord } from "./calls";
import { getContact } from "./contacts";
import { getDb, now } from "./db";
import { callAccountContext, getProvider } from "./providers";
import { getWorkspace } from "./workspaces";
import { recordLeftovers } from "./voice/cleanup";
import { deleteRecording } from "./voice/recordings";
import { isProvider } from "@/voice/normalize";
import { LIVE_CALL_STATUSES, ProviderError } from "@/voice/types";

/**
 * Erasure requests (GDPR and similar): a single call's recording, a whole call, or everything a
 * workspace holds about one contact.
 *
 * Erasing a call deletes its recording (from storage) and its personal data — phone numbers,
 * transcript, summary, extracted data, tool calls and the simulated provider's scheduled events —
 * but keeps an anonymous row with the duration, status and cost, so billing, the ledger and the
 * admin's P&L still add up. The audit log records every erasure (without the erased data).
 *
 * The provider's copy of the call (its transcript and audio at ElevenLabs or Retell) is deleted
 * too, best effort, in the account the call was made in. When that fails (provider down, own keys
 * removed) the erasure still goes ahead; the failure is written to the audit log and listed in
 * Admin → Voice providers → "Provider cleanup failed" for a retry or a manual deletion.
 */

type Actor = { type: AuditActorType; id: number | null };

const isLive = (c: Pick<CallRecord, "status">) => (LIVE_CALL_STATUSES as readonly string[]).includes(c.status);
const phoneHash = (phone: string) => (phone ? crypto.createHash("sha256").update(phone).digest("hex").slice(0, 16) : "");

/** Deletes a call's recording (copy in storage and the provider link). false when the call doesn't exist. */
export async function eraseCallRecording(workspaceId: number, callId: number, actor: Actor): Promise<boolean> {
  const call = await getCall(workspaceId, callId);
  if (!call) return false;
  await deleteRecording(call);
  await auditSafe({ workspaceId, actor, action: "call.recording_deleted", entityType: "call", entityId: call.id });
  return true;
}

export type EraseCallResult = "erased" | "not_found" | "live";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Deletes the provider's copy of a finished call (best effort). "deleted", "none" (nothing there:
 * simulated, never reached the provider) or "failed" (recorded as a provider cleanup leftover).
 */
export async function deleteProviderCall(call: CallRecord, actor: Actor): Promise<"deleted" | "none" | "failed"> {
  if (!call.providerCallId || !isProvider(call.provider) || call.provider === "simulated") return "none";
  const adapter = getProvider(call.provider);
  if (!adapter?.deleteCall) return "none";
  let error = "";
  const resolved = await callAccountContext(call, 10_000);
  if (!resolved) error = call.keySource === "byo" ? "The workspace's own keys of this provider were removed." : "The provider is not configured.";
  else {
    try {
      await resolved.provider.deleteCall!(resolved.ctx, call.providerCallId);
    } catch (e) {
      if (!(e instanceof ProviderError && e.kind === "not_found")) error = errText(e);
    }
  }
  if (!error) return "deleted";
  const workspace = await getWorkspace(call.workspaceId);
  await recordLeftovers(
    { id: call.workspaceId, name: workspace?.name ?? "" },
    actor,
    // No personal data in the label: the call's id only.
    [{ provider: call.provider, kind: "call", ref: call.providerCallId, meta: {}, label: `Call #${call.id}`, error, keySource: call.keySource }],
    "call.provider_delete_failed",
  );
  return "failed";
}

/** Erases a finished call's personal data and recording; the anonymous billing row stays. */
export async function eraseCall(workspaceId: number, callId: number, actor: Actor, options: { audit?: boolean } = {}): Promise<EraseCallResult> {
  const call = await getCall(workspaceId, callId);
  if (!call) return "not_found";
  if (isLive(call)) return "live";
  const providerCopy = await deleteProviderCall(call, actor);
  await deleteRecording(call);
  const db = await getDb();
  if (call.providerCallId) await db.deleteFrom("voice_sim_events").where("provider_call_id", "=", call.providerCallId).execute();
  const ts = now();
  await db
    .updateTable("calls")
    .set({
      from_e164: "",
      to_e164: "",
      contact_id: null,
      transcript: null,
      summary: null,
      extracted: null,
      tool_calls: null,
      sentiment: "unknown",
      error: null,
      recording_url: null,
      metadata: JSON.stringify({ ...call.tags, erased_at: ts }),
      updated_at: ts,
    })
    .where("id", "=", call.id)
    .execute();
  if (options.audit !== false) await auditSafe({ workspaceId, actor, action: "call.erased", entityType: "call", entityId: call.id, data: { direction: call.direction, created_at: call.createdAt, provider_copy: providerCopy } });
  return "erased";
}

export interface EraseContactResult {
  calls: number;
  /** A do-not-call entry of the number was kept. */
  dncKept: boolean;
}

/**
 * Erases everything about a contact: their calls (as eraseCall, matched by contact or number, with
 * the providers' copies),
 * consent records, list memberships, campaign rows and the contact itself. A do-not-call entry of
 * the number is kept, so they are never called again. null when the contact doesn't exist; live
 * calls are left (erase again once they ended).
 */
export async function eraseContactData(workspaceId: number, contactId: number, actor: Actor): Promise<EraseContactResult | null> {
  const contact = await getContact(workspaceId, contactId);
  if (!contact) return null;
  const db = await getDb();
  const phone = contact.phone;
  let q = db.selectFrom("calls").select("id").where("workspace_id", "=", workspaceId);
  q = q.where((eb) => eb.or([eb("contact_id", "=", contactId), ...(phone ? [eb("from_e164", "=", phone), eb("to_e164", "=", phone)] : [])]));
  const calls = await q.execute();
  let erased = 0;
  for (const c of calls) if ((await eraseCall(workspaceId, c.id, actor, { audit: false })) === "erased") erased++;
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("consents").where("workspace_id", "=", workspaceId).where("contact_id", "=", contactId).execute();
    await trx.deleteFrom("list_members").where("workspace_id", "=", workspaceId).where("contact_id", "=", contactId).execute();
    await trx.deleteFrom("campaign_contacts").where("workspace_id", "=", workspaceId).where("contact_id", "=", contactId).where("state", "not in", ["dialing", "in_call"]).execute();
    await trx.deleteFrom("contacts").where("id", "=", contactId).where("workspace_id", "=", workspaceId).execute();
  });
  const dnc = phone
    ? await db
        .selectFrom("dnc_entries")
        .select("id")
        .where("phone_e164", "=", phone)
        .where((eb) => eb.or([eb("workspace_id", "=", workspaceId), eb("scope", "=", "global")]))
        .executeTakeFirst()
    : undefined;
  await auditSafe({ workspaceId, actor, action: "contact.erased", entityType: "contact", entityId: contactId, data: { calls: erased, phone_sha256: phoneHash(phone), dnc_kept: Boolean(dnc) } });
  return { calls: erased, dncKept: Boolean(dnc) };
}
