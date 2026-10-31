"use server";

import { acceptAup, getCompliance, saveComplianceSettings, setOutboundPaused, submitKyc } from "@/lib/compliance";
import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizeDay, normalizePhone, normalizeTime } from "@/voice/normalize";
import type { ComplianceSettings } from "@/voice/types";
import type { FormState } from "../types";
import { str } from "./helpers";

/**
 * The compliance center (Workspace → Compliance): calling rules, recording notice and retention,
 * the outbound access request (acceptable use + KYC) and the workspace's own outbound stop
 * switch. All of it needs compliance.manage (admins); every change is audited by src/lib/compliance.ts.
 */

const list = (v: string) =>
  v
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

async function save(fd: FormData, patch: (current: ComplianceSettings) => Partial<ComplianceSettings> | string): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const current = (await getCompliance(guard.workspace)).settings;
  const p = patch(current);
  if (typeof p === "string") return { error: t(p as Parameters<typeof t>[0]) };
  await saveComplianceSettings(guard.workspace.id, { ...current, ...p }, guard.user.id);
  return { success: t("dash.compliance.saved") };
}

export async function saveCallingRulesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => {
    const start = normalizeTime(str(fd.get("hours_start")));
    const end = normalizeTime(str(fd.get("hours_end")));
    const days = fd.getAll("days").map(Number).filter((d) => d >= 1 && d <= 7);
    if (!start || !end || start >= end) return "dash.compliance.err.hours";
    if (!days.length) return "dash.compliance.err.days";
    const holidays = list(str(fd.get("holidays")));
    if (holidays.some((h) => !normalizeDay(h))) return "dash.compliance.err.holidays";
    const callback = str(fd.get("callback_number")).trim();
    if (callback && !normalizePhone(callback)) return "dash.compliance.err.callback";
    return {
      businessName: str(fd.get("business_name")),
      callbackNumber: callback,
      callingHours: { start, end, days },
      usStatePresets: fd.get("us_state_presets") === "on",
      holidays,
      maxCallsPer24h: Number(str(fd.get("max_24h")) || 0),
      maxCallsPer30d: Number(str(fd.get("max_30d")) || 0),
    };
  });
}

export async function saveCountryRulesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => {
    const route = str(fd.get("india_dlt_route"));
    return {
      indiaDltRoute: route === "140" || route === "1600" ? route : "",
      euRequireConsent: fd.get("eu_require_consent") === "on",
      blockedCountries: list(str(fd.get("blocked_countries")).toUpperCase()),
      allowedCountries: list(str(fd.get("allowed_countries")).toUpperCase()),
      optOutPhrases: list(str(fd.get("opt_out_phrases"))),
    };
  });
}

export async function saveRecordingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => {
    const text = str(fd.get("recording_text")).trim();
    if (fd.get("recording_disclosure") === "on" && text.length < 10) return "dash.compliance.err.notice";
    return {
      recordingDisclosure: fd.get("recording_disclosure") === "on",
      recordingDisclosureText: text,
      recordingRetentionDays: Number(str(fd.get("recording_days")) || 0),
      transcriptRetentionDays: Number(str(fd.get("transcript_days")) || 0),
    };
  });
}

/** The workspace's own stop switch for outbound calls. */
export async function setOutboundPausedAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const on = str(fd.get("on")) === "1";
  await setOutboundPaused(guard.workspace.id, on, guard.user.id);
  return { success: on ? t("dash.compliance.pausedOn") : t("dash.compliance.pausedOff") };
}

/** Acceptable use + KYC form → the admin's review queue. */
export async function requestOutboundAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "compliance.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-kyc:${guard.workspace.id}`, 5, 60 * 60_000)) return { error: t("dash.compliance.err.rate") };
  const state = await getCompliance(guard.workspace);
  if (!state.aupAcceptedAt) {
    if (fd.get("aup") !== "on") return { error: t("dash.compliance.err.aup") };
    await acceptAup(guard.workspace.id, guard.user.id, await clientIp());
  }
  const res = await submitKyc(
    guard.workspace.id,
    {
      businessName: str(fd.get("business_name")),
      address: str(fd.get("address")),
      website: str(fd.get("website")),
      country: str(fd.get("country")),
      useCase: str(fd.get("use_case")),
      consentMethod: str(fd.get("consent_method")),
      expectedVolume: str(fd.get("expected_volume")),
      sampleScript: str(fd.get("sample_script")),
    },
    guard.user.id,
  );
  if (!res.ok) return { error: res.error === "pending" ? t("dash.compliance.err.pending") : res.error === "aup" ? t("dash.compliance.err.aup") : t("dash.compliance.err.kyc") };
  return { success: t("dash.compliance.kycSent") };
}
