import "server-only";
import { auditSafe } from "./audit";
import { getDb, now } from "./db";
import type { ComplianceSettingsRow, KycRequestRow } from "./db/schema";
import type { Entitlements } from "./plans";
import { getSettings } from "./settings";
import { canDial, normalizeComplianceSettings, parseJson, parsePhone, type CanDialInput } from "@/voice/normalize";
import type { CampaignPurpose, CampaignStatus, CallingWindow, ComplianceSettings, Consent, DialCheckResult, DncMatch, OutboundState } from "@/voice/types";

/**
 * The compliance center of a workspace: its settings (calling hours, frequency caps, recording
 * notice, country rules, retention), the outbound approval (acceptable-use acceptance + KYC
 * request reviewed by the admin), the admin's kill switches, and the dial-time check that the
 * campaign engine, the REST API and the dashboard run before EVERY outbound call (checkDial).
 *
 * These are tools, not legal advice: tenants stay responsible for the rules that apply to them.
 */

export interface ComplianceState {
  settings: ComplianceSettings;
  outboundState: OutboundState;
  aupAcceptedAt: string | null;
  aupAcceptedBy: number | null;
  killSwitch: boolean;
  killReason: string | null;
  /** The workspace's own stop switch (set by its admins, unlike the admin's kill switch). */
  outboundPaused: boolean;
}

function toState(row: ComplianceSettingsRow | undefined, workspaceName: string): ComplianceState {
  const settings = normalizeComplianceSettings(parseJson(row?.settings));
  if (!settings.businessName) settings.businessName = workspaceName;
  return {
    settings,
    outboundState: row?.outbound_state ?? "not_requested",
    aupAcceptedAt: row?.aup_accepted_at ?? null,
    aupAcceptedBy: row?.aup_accepted_by ?? null,
    killSwitch: row?.kill_switch === 1,
    killReason: row?.kill_reason ?? null,
    outboundPaused: row?.outbound_paused === 1,
  };
}

/** The workspace's compliance state (defaults when nothing was saved; business name = workspace name). */
export async function getCompliance(workspace: { id: number; name: string }): Promise<ComplianceState> {
  const db = await getDb();
  const row = await db.selectFrom("compliance_settings").selectAll().where("workspace_id", "=", workspace.id).executeTakeFirst();
  return toState(row, workspace.name);
}

async function ensureRow(workspaceId: number): Promise<void> {
  const db = await getDb();
  const exists = await db.selectFrom("compliance_settings").select("workspace_id").where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (exists) return;
  try {
    await db
      .insertInto("compliance_settings")
      .values({ workspace_id: workspaceId, settings: "{}", outbound_state: "not_requested", aup_accepted_at: null, aup_accepted_by: null, kill_switch: 0, kill_reason: null, updated_at: now() })
      .execute();
  } catch {
    // Created concurrently.
  }
}

export async function saveComplianceSettings(workspaceId: number, input: unknown, userId: number | null): Promise<ComplianceSettings> {
  const settings = normalizeComplianceSettings(input);
  await ensureRow(workspaceId);
  const db = await getDb();
  await db.updateTable("compliance_settings").set({ settings: JSON.stringify(settings), updated_at: now() }).where("workspace_id", "=", workspaceId).execute();
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "compliance.updated", entityType: "workspace", entityId: workspaceId, data: { settings } });
  return settings;
}

/** Records the acceptance of the acceptable-use terms (needed before asking for outbound access). */
export async function acceptAup(workspaceId: number, userId: number, ip = ""): Promise<void> {
  await ensureRow(workspaceId);
  const db = await getDb();
  const ts = now();
  await db.updateTable("compliance_settings").set({ aup_accepted_at: ts, aup_accepted_by: userId, updated_at: ts }).where("workspace_id", "=", workspaceId).execute();
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "aup.accepted", entityType: "workspace", entityId: workspaceId, ip });
}

// ── Outbound approval (KYC) ──

export interface KycInput {
  businessName: string;
  address: string;
  website: string;
  country: string;
  useCase: string;
  consentMethod: string;
  expectedVolume: string;
  /** What the agent says on outbound calls (optional). */
  sampleScript?: string;
}

export type KycResult = { ok: true; id: number } | { ok: false; error: "aup" | "pending" | "invalid" };

/** A workspace asks for outbound calling. Needs the AUP accepted; one open request at a time. */
export async function submitKyc(workspaceId: number, input: KycInput, userId: number): Promise<KycResult> {
  const clean = {
    business_name: input.businessName.trim().slice(0, 190),
    address: input.address.trim().slice(0, 500),
    website: input.website.trim().slice(0, 500),
    country: input.country.trim().toUpperCase().slice(0, 2),
    use_case: input.useCase.trim().slice(0, 5000),
    consent_method: input.consentMethod.trim().slice(0, 5000),
    expected_volume: input.expectedVolume.trim().slice(0, 120),
    sample_script: (input.sampleScript ?? "").trim().slice(0, 5000) || null,
  };
  if (!clean.business_name || !clean.address || clean.use_case.length < 20 || clean.consent_method.length < 20) return { ok: false, error: "invalid" };
  await ensureRow(workspaceId);
  const db = await getDb();
  const row = await db.selectFrom("compliance_settings").select(["aup_accepted_at"]).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (!row?.aup_accepted_at) return { ok: false, error: "aup" };
  const open = await db.selectFrom("kyc_requests").select("id").where("workspace_id", "=", workspaceId).where("status", "=", "pending").executeTakeFirst();
  if (open) return { ok: false, error: "pending" };
  const ts = now();
  const id = await db.transaction().execute(async (trx) => {
    const res = await trx
      .insertInto("kyc_requests")
      .values({ workspace_id: workspaceId, ...clean, status: "pending", review_note: null, reviewed_by: null, reviewed_at: null, submitted_by: userId, created_at: ts, updated_at: ts })
      .executeTakeFirstOrThrow();
    await trx.updateTable("compliance_settings").set({ outbound_state: "pending", updated_at: ts }).where("workspace_id", "=", workspaceId).execute();
    return Number(res.insertId);
  });
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: "outbound.requested", entityType: "kyc_request", entityId: id, data: { business: clean.business_name, country: clean.country } });
  return { ok: true, id };
}

export async function listKycRequests(filter: { status?: KycRequestRow["status"]; workspaceId?: number; limit?: number } = {}): Promise<KycRequestRow[]> {
  const db = await getDb();
  let q = db.selectFrom("kyc_requests").selectAll();
  if (filter.status) q = q.where("status", "=", filter.status);
  if (filter.workspaceId) q = q.where("workspace_id", "=", filter.workspaceId);
  return q.orderBy("id", "desc").limit(Math.min(filter.limit ?? 100, 500)).execute();
}

/** The admin approves or rejects a request; the workspace's outbound state follows. Returns false when the request isn't pending. */
export async function reviewKyc(requestId: number, decision: "approved" | "rejected", note: string, adminId: number): Promise<boolean> {
  const db = await getDb();
  const ts = now();
  const req = await db.selectFrom("kyc_requests").selectAll().where("id", "=", requestId).executeTakeFirst();
  if (!req || req.status !== "pending") return false;
  const updated = await db.transaction().execute(async (trx) => {
    const res = await trx
      .updateTable("kyc_requests")
      .set({ status: decision, review_note: note.trim().slice(0, 1000) || null, reviewed_by: adminId, reviewed_at: ts, updated_at: ts })
      .where("id", "=", requestId)
      .where("status", "=", "pending")
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) !== 1) return false;
    await trx.updateTable("compliance_settings").set({ outbound_state: decision, updated_at: ts }).where("workspace_id", "=", req.workspace_id).execute();
    return true;
  });
  if (updated) await auditSafe({ workspaceId: req.workspace_id, actor: { type: "admin", id: adminId }, action: `outbound.${decision}`, entityType: "kyc_request", entityId: requestId, data: { note } });
  return updated;
}

/** Admin: suspend (or restore to approved) a workspace's outbound access. */
export async function setOutboundState(workspaceId: number, state: OutboundState, adminId: number, reason = ""): Promise<void> {
  await ensureRow(workspaceId);
  const db = await getDb();
  await db.updateTable("compliance_settings").set({ outbound_state: state, updated_at: now() }).where("workspace_id", "=", workspaceId).execute();
  await auditSafe({ workspaceId, actor: { type: "admin", id: adminId }, action: `outbound.${state}`, entityType: "workspace", entityId: workspaceId, data: { reason } });
}

/** Admin kill switch of one workspace: no outbound calls at all while on. */
export async function setKillSwitch(workspaceId: number, on: boolean, reason: string, adminId: number): Promise<void> {
  await ensureRow(workspaceId);
  const db = await getDb();
  await db.updateTable("compliance_settings").set({ kill_switch: on ? 1 : 0, kill_reason: on ? reason.trim().slice(0, 500) || null : null, updated_at: now() }).where("workspace_id", "=", workspaceId).execute();
  await auditSafe({ workspaceId, actor: { type: "admin", id: adminId }, action: on ? "kill_switch.on" : "kill_switch.off", entityType: "workspace", entityId: workspaceId, data: { reason } });
}

/** The workspace's admins stop (or resume) all outbound calls of their workspace themselves. */
export async function setOutboundPaused(workspaceId: number, on: boolean, userId: number): Promise<void> {
  await ensureRow(workspaceId);
  const db = await getDb();
  await db.updateTable("compliance_settings").set({ outbound_paused: on ? 1 : 0, updated_at: now() }).where("workspace_id", "=", workspaceId).execute();
  await auditSafe({ workspaceId, actor: { type: "user", id: userId }, action: on ? "outbound.paused" : "outbound.resumed", entityType: "workspace", entityId: workspaceId });
}

export type OutboundBlock = "plan" | "global_kill" | "kill_switch" | "paused" | "approval";

/**
 * Whether the workspace may place outbound calls at all right now (before any per-call check):
 * the owner's plan, the platform-wide kill switch, the workspace's kill switch, the workspace's
 * own stop switch and the admin's
 * approval (when Admin → Voice requires it).
 */
export async function outboundAccess(state: Pick<ComplianceState, "outboundState" | "killSwitch"> & Partial<Pick<ComplianceState, "outboundPaused">>, entitlements: Pick<Entitlements, "allowOutbound">): Promise<{ ok: true } | { ok: false; reason: OutboundBlock }> {
  if (!entitlements.allowOutbound) return { ok: false, reason: "plan" };
  const settings = await getSettings();
  if (settings.outbound_kill_switch) return { ok: false, reason: "global_kill" };
  if (state.killSwitch) return { ok: false, reason: "kill_switch" };
  if (state.outboundPaused) return { ok: false, reason: "paused" };
  if (settings.outbound_requires_approval && state.outboundState !== "approved") return { ok: false, reason: "approval" };
  return { ok: true };
}

// ── Dial-time check ──

/** Consent records of a contact, as the contract's Consent objects. */
export async function contactConsents(workspaceId: number, contactId: number | null, phone: string): Promise<Consent[]> {
  const db = await getDb();
  let q = db.selectFrom("consents").selectAll().where("workspace_id", "=", workspaceId);
  q = contactId ? q.where((eb) => eb.or([eb("contact_id", "=", contactId), eb("phone_e164", "=", phone)])) : q.where("phone_e164", "=", phone);
  const rows = await q.orderBy("id").limit(200).execute();
  return rows.map((r) => ({
    id: r.id,
    type: r.type as Consent["type"],
    purpose: (r.purpose === "informational" || r.purpose === "telemarketing" ? r.purpose : "any") as Consent["purpose"],
    source: r.source as Consent["source"],
    sourceUrl: r.source_url,
    capturedAt: r.captured_at,
    ip: r.ip,
    textSnapshot: r.text_snapshot,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  }));
}

/** DNC entries of the workspace and the platform for a number. */
export async function dncMatches(workspaceId: number, phone: string): Promise<DncMatch[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("dnc_entries")
    .select(["scope", "reason", "expires_at"])
    .where("phone_e164", "=", phone)
    .where((eb) => eb.or([eb.and([eb("scope", "=", "workspace"), eb("workspace_id", "=", workspaceId)]), eb("scope", "=", "global")]))
    .execute();
  return rows.map((r) => ({ scope: r.scope, reason: r.reason as DncMatch["reason"], expiresAt: r.expires_at }));
}

/** Outbound calls to a number from this workspace in the last 24 hours and 30 days (frequency caps). */
export async function callCounts(workspaceId: number, phone: string, nowMs = Date.now()): Promise<{ last24h: number; last30d: number }> {
  const db = await getDb();
  const since30 = new Date(nowMs - 30 * 86_400_000).toISOString();
  const since24 = new Date(nowMs - 86_400_000).toISOString();
  const rows = await db
    .selectFrom("calls")
    .select("created_at")
    .where("workspace_id", "=", workspaceId)
    .where("to_e164", "=", phone)
    .where("direction", "=", "outbound")
    .where("created_at", ">=", since30)
    .where("status", "!=", "canceled")
    .execute();
  return { last24h: rows.filter((r) => r.created_at >= since24).length, last30d: rows.length };
}

export interface DialRequest {
  workspace: { id: number; name: string };
  entitlements: Pick<Entitlements, "allowOutbound">;
  phone: string;
  contact: { id: number; timezone: string; country: string; state: string; optedOut: boolean } | null;
  campaign: { id: number; status: CampaignStatus; purpose: CampaignPurpose; window: CallingWindow | null } | null;
  /** Purpose of a single call outside a campaign. */
  purpose?: CampaignPurpose;
  now?: number;
}

/**
 * Loads everything canDial() needs from the database (compliance settings, consent, DNC, call
 * counts, outbound access) and runs it. Blocks are written to the audit log by the caller once
 * it decides (so a retried check doesn't flood the log).
 */
export async function checkDial(req: DialRequest): Promise<DialCheckResult & { phone: string }> {
  const parsed = parsePhone(req.phone);
  const phone = parsed?.e164 ?? req.phone;
  const nowMs = req.now ?? Date.now();
  const [state, consent, dnc, counts] = await Promise.all([getCompliance(req.workspace), contactConsents(req.workspace.id, req.contact?.id ?? null, phone), dncMatches(req.workspace.id, phone), callCounts(req.workspace.id, phone, nowMs)]);
  const access = await outboundAccess(state, req.entitlements);
  const input: CanDialInput = {
    contact: { phone, timezone: req.contact?.timezone || null, country: req.contact?.country || null, state: req.contact?.state || null, optedOut: req.contact?.optedOut ?? false },
    consent,
    dnc,
    campaign: req.campaign ? { status: req.campaign.status, purpose: req.campaign.purpose, window: req.campaign.window } : null,
    compliance: state.settings,
    now: nowMs,
    countsToday: counts,
    purpose: req.purpose,
    outboundAllowed: access.ok,
  };
  return { ...canDial(input), phone };
}
