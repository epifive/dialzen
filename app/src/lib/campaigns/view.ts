import "server-only";
import type { CampaignFormOptions, CampaignFormValues } from "@/components/dashboard/campaign-form";
import { listAgents } from "../agents";
import { listContactLists } from "../contacts";
import { getDb } from "../db";
import { listNumbers } from "../numbers";
import type { Entitlements } from "../plans";
import type { WorkspaceRecord } from "../workspaces";
import { DEFAULT_CALLING_HOURS, localDay, localTime, timeZoneOptions } from "@/voice/normalize";
import type { CampaignPurpose } from "@/voice/types";
import { DEFAULT_RETRY_DELAYS, type CampaignRecord } from "./index";

/** Data the campaign form needs (agents, numbers, lists, the plan's concurrency). */
export async function campaignFormOptions(workspace: WorkspaceRecord, entitlements: Entitlements): Promise<CampaignFormOptions> {
  const [agents, numbers, lists] = await Promise.all([listAgents(workspace.id), listNumbers(workspace.id), listContactLists(workspace.id)]);
  return {
    agents: agents.map((a) => ({ id: a.id, name: a.name, provider: a.provider, status: a.status })),
    numbers: numbers.map((n) => ({ id: n.id, e164: n.e164, label: n.label, provider: n.provider, outboundEnabled: n.outboundEnabled, active: n.status === "active", dailyDialCap: n.dailyDialCap })),
    lists: lists.map((l) => ({ id: l.id, name: l.name, members: l.members })),
    maxConcurrency: entitlements.maxConcurrentCalls,
    timezones: timeZoneOptions(),
    workspaceTimezone: workspace.timezone,
    weekStart: workspace.settings.weekStart,
  };
}

const localInput = (iso: string | null, tz: string) => (iso ? `${localDay(Date.parse(iso), tz)}T${localTime(Date.parse(iso), tz)}` : "");

export function campaignFormValues(c: CampaignRecord | null, workspace: WorkspaceRecord, defaults: Partial<CampaignFormValues> = {}): CampaignFormValues {
  if (!c) {
    return {
      name: "",
      agentId: null,
      numberIds: [],
      listIds: [],
      purpose: "informational",
      startsAt: "",
      endsAt: "",
      window: { start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5] },
      timezoneMode: "contact",
      timezone: workspace.timezone,
      maxAttempts: 3,
      retryOn: ["no_answer", "busy"],
      retryDelays: { ...DEFAULT_RETRY_DELAYS },
      concurrency: 1,
      dailyCap: 0,
      variables: {},
      abandonMaxPct: 3,
      ...defaults,
    };
  }
  return {
    id: c.id,
    name: c.name,
    agentId: c.agentId,
    numberIds: c.numberIds,
    listIds: c.listIds,
    purpose: c.purpose,
    startsAt: localInput(c.startsAt, workspace.timezone),
    endsAt: localInput(c.endsAt, workspace.timezone),
    window: c.window ?? DEFAULT_CALLING_HOURS,
    timezoneMode: c.timezoneMode,
    timezone: c.timezone,
    maxAttempts: c.maxAttempts,
    retryOn: c.retryOn,
    retryDelays: c.retryDelays,
    concurrency: c.concurrency,
    dailyCap: c.dailyCap,
    variables: c.variables,
    abandonMaxPct: c.abandonMaxPct,
  };
}

/**
 * How many of a campaign's contacts have a valid consent covering its purpose (pre-start check on
 * the campaign page; the engine checks every contact again at dial time).
 */
export async function consentCoverage(workspaceId: number, listIds: number[], purpose: CampaignPurpose): Promise<{ total: number; covered: number }> {
  if (!listIds.length) return { total: 0, covered: 0 };
  const db = await getDb();
  const types = purpose === "telemarketing" ? ["pewc", "ai_voice"] : ["pec", "pewc", "ai_voice", "marketing"];
  const nowIso = new Date().toISOString();
  const members = await db.selectFrom("list_members").select("contact_id").distinct().where("workspace_id", "=", workspaceId).where("list_id", "in", listIds).execute();
  const total = members.length;
  if (!total) return { total: 0, covered: 0 };
  const covered = await db
    .selectFrom("consents")
    .select("contact_id")
    .distinct()
    .where("workspace_id", "=", workspaceId)
    .where("contact_id", "in", (eb) => eb.selectFrom("list_members").select("contact_id").where("workspace_id", "=", workspaceId).where("list_id", "in", listIds))
    .where("type", "in", types)
    .where("purpose", "in", ["any", purpose])
    .where("revoked_at", "is", null)
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", nowIso)]))
    .execute();
  return { total, covered: covered.length };
}
