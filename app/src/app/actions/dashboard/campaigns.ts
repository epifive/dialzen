"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { createCampaign, deleteCampaign, getCampaign, pauseCampaign, resumeCampaign, startCampaign, stopCampaign, syncCampaignContacts, updateCampaign, type CampaignError, type CampaignInput } from "@/lib/campaigns";
import { runCampaignEngine } from "@/lib/campaigns/engine";
import { getCompliance, outboundAccess } from "@/lib/compliance";
import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/messages";
import { idList, parseLocalDateTime } from "@/voice/normalize";
import { RETRYABLE_OUTCOMES } from "@/voice/types";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

/**
 * Campaigns (Workspace → Campaigns). Editors draft and edit campaigns (campaigns.edit); starting,
 * resuming and stopping outbound calls is for admins (campaigns.run). Pausing is allowed to
 * editors too: stopping calls is always safe.
 */

const base = (wid: number) => `/dashboard/w/${wid}/campaigns`;

function campaignError(t: Translator, error: CampaignError): string {
  switch (error) {
    case "name":
      return t("dash.campaigns.err.name");
    case "agent":
      return t("dash.campaigns.err.agent");
    case "number":
      return t("dash.campaigns.err.number");
    case "list":
      return t("dash.campaigns.err.list");
    case "dates":
      return t("dash.campaigns.err.dates");
    case "window":
      return t("dash.campaigns.err.window");
    case "timezone":
      return t("dash.campaigns.err.timezone");
    case "concurrency":
      return t("dash.campaigns.err.concurrency");
    case "status":
      return t("dash.campaigns.err.status");
    case "plan":
      return t("dash.campaigns.err.plan");
    default:
      return t("dash.campaigns.err.notFound");
  }
}

function inputFrom(fd: FormData, timezone: string): CampaignInput {
  const local = (name: string) => {
    const v = str(fd.get(name)).trim();
    if (!v) return null;
    const ms = parseLocalDateTime(v, timezone);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : "invalid";
  };
  const retryDelays: Record<string, number> = {};
  for (const o of RETRYABLE_OUTCOMES) retryDelays[o] = Number(str(fd.get(`delay_${o}`)) || 0);
  const variables: Record<string, string> = {};
  for (const line of str(fd.get("variables")).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*[=:]\s*(.*)$/.exec(line);
    if (m) variables[m[1]] = m[2].trim();
  }
  return {
    name: str(fd.get("name")),
    agentId: idOf(fd.get("agent_id")),
    numberIds: idList(fd.getAll("number_ids").map(String)),
    listIds: idList(fd.getAll("list_ids").map(String)),
    purpose: str(fd.get("purpose")),
    startsAt: local("starts_at"),
    endsAt: local("ends_at"),
    window: { start: str(fd.get("window_start")), end: str(fd.get("window_end")), days: fd.getAll("days").map(Number) },
    timezoneMode: str(fd.get("timezone_mode")),
    timezone: str(fd.get("timezone")),
    maxAttempts: Number(str(fd.get("max_attempts")) || 3),
    retryOn: fd.getAll("retry_on").map(String),
    retryDelays,
    concurrency: Number(str(fd.get("concurrency")) || 1),
    dailyCap: Number(str(fd.get("daily_cap")) || 0),
    variables,
    abandonMaxPct: Number(str(fd.get("abandon_max_pct")) || 0),
  };
}

export async function saveCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.edit" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ws = guard.workspace;
  if (!guard.entitlements.allowCampaigns) return { error: t("dash.campaigns.err.plan") };
  const input = inputFrom(fd, ws.timezone);
  if (input.startsAt === "invalid" || input.endsAt === "invalid") return { error: t("dash.campaigns.err.dates") };
  const campaignId = idOf(fd.get("campaign_id"));
  const options = { maxConcurrency: guard.entitlements.maxConcurrentCalls, userId: guard.user.id };
  const res = Number.isInteger(campaignId) && campaignId > 0 ? await updateCampaign(ws.id, campaignId, input, options) : await createCampaign(ws.id, input, options);
  if (!res.ok) return { error: campaignError(t, res.error) };
  redirect(`${base(ws.id)}/${res.campaign.id}?saved=1`);
}

/** Dials the campaign's first contacts right away (after the response), instead of waiting for the next tick. */
function kick(campaignId: number, concurrency: number) {
  after(async () => {
    try {
      await runCampaignEngine({ deadline: Date.now() + 8_000, campaignId, maxDials: Math.max(1, concurrency) });
    } catch (error) {
      console.error("[dialzen] campaign kick failed:", error);
    }
  });
}

export async function startCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.run" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ws = guard.workspace;
  const access = await outboundAccess(await getCompliance(ws), guard.entitlements);
  if (!access.ok) return { error: t(`dash.campaigns.blocked.${access.reason}`) };
  const campaignId = idOf(fd.get("campaign_id"));
  const res = await startCampaign(ws.id, campaignId, { type: "user", id: guard.user.id }, guard.entitlements.allowCampaigns);
  if (!res.ok) return { error: res.error === "empty" ? t("dash.campaigns.err.empty") : res.error === "plan" ? t("dash.campaigns.err.plan") : t("dash.campaigns.err.status") };
  const c = await getCampaign(ws.id, campaignId);
  if (c && res.status === "running") kick(c.id, c.concurrency);
  return { success: res.status === "scheduled" ? t("dash.campaigns.scheduledMsg") : t("dash.campaigns.startedMsg", { n: res.contacts }) };
}

export async function pauseCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.edit" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await pauseCampaign(guard.workspace.id, idOf(fd.get("campaign_id")), { type: "user", id: guard.user.id });
  return ok ? { success: t("dash.campaigns.pausedMsg") } : { error: t("dash.campaigns.err.status") };
}

export async function resumeCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.run" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ws = guard.workspace;
  const access = await outboundAccess(await getCompliance(ws), guard.entitlements);
  if (!access.ok) return { error: t(`dash.campaigns.blocked.${access.reason}`) };
  const campaignId = idOf(fd.get("campaign_id"));
  const res = await resumeCampaign(ws.id, campaignId, { type: "user", id: guard.user.id }, guard.entitlements.allowCampaigns);
  if (!res.ok) return { error: res.error === "plan" ? t("dash.campaigns.err.plan") : t("dash.campaigns.err.status") };
  const c = await getCampaign(ws.id, campaignId);
  if (c?.status === "running") kick(c.id, c.concurrency);
  return { success: t("dash.campaigns.resumedMsg") };
}

export async function stopCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.run" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await stopCampaign(guard.workspace.id, idOf(fd.get("campaign_id")), { type: "user", id: guard.user.id });
  return ok ? { success: t("dash.campaigns.stoppedMsg") } : { error: t("dash.campaigns.err.status") };
}

export async function deleteCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.run" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const ok = await deleteCampaign(guard.workspace.id, idOf(fd.get("campaign_id")), guard.user.id);
  if (!ok) return { error: t("dash.campaigns.err.deleteRunning") };
  redirect(`${base(guard.workspace.id)}?deleted=1`);
}

/** Adds contacts that joined the campaign's lists after it started. */
export async function syncCampaignAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const guard = await guardWorkspace(fd.get("wid"), { capability: "campaigns.edit" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const c = await getCampaign(guard.workspace.id, idOf(fd.get("campaign_id")));
  if (!c) return { error: t("dash.campaigns.err.notFound") };
  if (c.status === "draft" || c.status === "completed" || c.status === "canceled") return { error: t("dash.campaigns.err.status") };
  const n = await syncCampaignContacts(c);
  return { success: t("dash.campaigns.synced", { n }) };
}
