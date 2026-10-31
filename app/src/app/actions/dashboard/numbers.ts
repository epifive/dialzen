"use server";

import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/messages";
import { getNumber } from "@/lib/numbers";
import { rateLimit } from "@/lib/rate-limit";
import { buyNumberFor, importNumberFor, releaseNumberFor, saveNumberOptions, setNumberInboundAgent, type NumberActionResult } from "@/lib/voice/numbers";
import { simulateInboundCall } from "@/lib/voice/sim-store";
import { formatPhone } from "@/voice/normalize";
import type { FormState } from "../types";
import { idOf, intOf, str } from "./helpers";

/** Phone numbers of a workspace (Workspace → Numbers). Managing them needs numbers.manage (admin). */

function resultError(r: Extract<NumberActionResult, { ok: false }>, t: Translator): string {
  switch (r.error) {
    case "limit":
      return t("dash.numbers.err.limit");
    case "invalid":
      return t("dash.numbers.err.invalid");
    case "taken":
      return t("dash.numbers.err.taken");
    case "credits":
      return t("dash.numbers.err.credits");
    case "not_found":
      return t("dash.numbers.err.notFound");
    case "unsupported":
      return t("dash.numbers.err.unsupported");
    default:
      return t("dash.numbers.err.provider", { error: r.message });
  }
}

export async function buyNumberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "numbers.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-number-buy:${guard.user.id}`, 5, 60_000)) return { error: t("dash.numbers.err.rate") };
  const result = await buyNumberFor(
    guard.workspace,
    guard.entitlements,
    { provider: str(formData.get("provider")), country: str(formData.get("country")) === "CA" ? "CA" : "US", areaCode: str(formData.get("area_code")).replace(/\D/g, "").slice(0, 3), tollFree: formData.get("toll_free") === "on", label: str(formData.get("label")).trim() },
    guard.user.id,
  );
  if (!result.ok) return { error: resultError(result, t) };
  return { success: t("dash.numbers.bought", { number: formatPhone(result.number.e164) }) };
}

export async function importNumberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "numbers.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-number-import:${guard.user.id}`, 10, 60_000)) return { error: t("dash.numbers.err.rate") };
  const carrier = str(formData.get("carrier"));
  const result = await importNumberFor(
    guard.workspace,
    guard.entitlements,
    {
      provider: str(formData.get("provider")),
      carrier,
      e164: str(formData.get("e164")),
      label: str(formData.get("label")).trim(),
      twilio: { accountSid: str(formData.get("twilio_sid")), authToken: str(formData.get("twilio_token")) },
      sip: { terminationUri: str(formData.get("sip_uri")), username: str(formData.get("sip_user")), password: str(formData.get("sip_pass")) },
    },
    guard.user.id,
  );
  if (!result.ok) return { error: result.error === "twilio" ? t("dash.numbers.err.twilio", { error: result.message }) : resultError(result, t) };
  return { success: t("dash.numbers.imported", { number: formatPhone(result.number.e164) }) };
}

export async function saveNumberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "numbers.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const number = await getNumber(guard.workspace.id, idOf(formData.get("number_id")));
  if (!number || number.status === "released") return { error: t("dash.numbers.err.notFound") };
  const agentRaw = str(formData.get("inbound_agent_id"));
  const agentId = agentRaw ? idOf(agentRaw) : null;
  if (agentId !== number.inboundAgentId) {
    const routed = await setNumberInboundAgent(guard.workspace, number.id, agentId && Number.isInteger(agentId) ? agentId : null);
    if (!routed.ok) return { error: resultError(routed, t) };
  }
  const outbound = formData.get("outbound_enabled") === "on";
  if (outbound && !number.outboundEnabled && !guard.entitlements.allowOutbound) return { error: t("dash.numbers.err.outboundPlan") };
  const cap = intOf(formData.get("daily_dial_cap"), 1, 10_000);
  if (formData.has("daily_dial_cap") && Number.isNaN(cap)) return { error: t("dash.numbers.err.cap") };
  await saveNumberOptions(guard.workspace.id, number.id, { label: str(formData.get("label")).trim(), outboundEnabled: outbound, ...(Number.isNaN(cap) ? {} : { dailyDialCap: cap }) }, guard.user.id);
  return { success: t("dash.numbers.saved") };
}

export async function releaseNumberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "numbers.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const result = await releaseNumberFor(guard.workspace, guard.entitlements, idOf(formData.get("number_id")), guard.user.id);
  if (!result.ok) return { error: result.error === "taken" ? t("dash.numbers.err.inCampaign") : resultError(result, t) };
  return { success: t("dash.numbers.released") };
}

/** Demo / testing: a simulated inbound call to one of the workspace's simulated numbers. */
export async function simulateInboundAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "numbers.manage", allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-sim-inbound:${guard.user.id}`, 6, 60_000)) return { error: t("dash.numbers.err.rate") };
  const number = await getNumber(guard.workspace.id, idOf(formData.get("number_id")));
  if (!number || number.status !== "active") return { error: t("dash.numbers.err.notFound") };
  const result = await simulateInboundCall(number.e164);
  if (!result.ok) return { error: result.error === "agent" ? t("dash.numbers.err.noAgent") : t("dash.numbers.err.notSimulated") };
  return { success: t("dash.numbers.testInboundStarted", { number: formatPhone(number.e164) }) };
}
