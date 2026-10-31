import "server-only";
import { getDb, now } from "./db";
import type { Plan } from "./db/schema";
import type { SessionUser } from "./auth/session";

/**
 * Plans and what they allow. Limits belong to an ACCOUNT: a workspace uses the plan of its
 * owner, and the counts (agents, numbers, members, minutes) add up across all the workspaces the
 * owner owns, so creating more workspaces never raises a limit. See src/lib/workspaces.ts.
 *
 * Every numeric limit uses the same convention: -1 = unlimited, 0 = none, N = at most N.
 */
export interface Entitlements {
  plan: Plan | null;
  /** True when the user has an active paid plan. */
  isPremium: boolean;
  /** The account is banned: everything below is switched off (no calls, campaigns, API). */
  suspended?: boolean;
  /** AI agents across the owner's workspaces. */
  maxAgents: number;
  /** Phone numbers across the owner's workspaces (0 = browser test calls only). */
  maxNumbers: number;
  /** Calls in progress at the same time across the owner's workspaces. */
  maxConcurrentCalls: number;
  /** Call minutes included each calendar month (UTC); more minutes are paid from the wallet. */
  includedMinutesMonthly: number;
  /** Team seats across the owner's workspaces, the owner included. */
  maxMembers: number;
  /** AI prompt assistant requests per calendar month. */
  maxAiMonthly: number;
  /** Outbound phone calls (the workspace also needs the admin's outbound approval). */
  allowOutbound: boolean;
  /** Outbound campaigns. */
  allowCampaigns: boolean;
  /** The workspace's own voice provider API keys. */
  allowByoKeys: boolean;
  /** REST API access (/api/v1). */
  allowApi: boolean;
  /** Own branding on the web widget and notification emails. */
  allowWhiteLabel: boolean;
  /** Hide the "Powered by" line on the widget and emails. */
  removeBranding: boolean;
  expiresAt: string | null;
}

export type Limits = Omit<Entitlements, "plan" | "isPremium" | "expiresAt">;

/** Limits used if no plan is marked as the free plan (the same as the default free plan). */
const FALLBACK_FREE: Limits = {
  maxAgents: 1,
  maxNumbers: 0,
  maxConcurrentCalls: 1,
  includedMinutesMonthly: 10,
  maxMembers: 1,
  maxAiMonthly: 20,
  allowOutbound: false,
  allowCampaigns: false,
  allowByoKeys: false,
  allowApi: false,
  allowWhiteLabel: false,
  removeBranding: false,
};

/**
 * Administrators run the platform, so their own workspaces are never limited and their calls
 * count as included minutes (no wallet credits needed; provider costs are still recorded).
 */
const ADMIN_LIMITS: Limits = {
  maxAgents: -1,
  maxNumbers: -1,
  maxConcurrentCalls: -1,
  includedMinutesMonthly: -1,
  maxMembers: -1,
  maxAiMonthly: -1,
  allowOutbound: true,
  allowCampaigns: true,
  allowByoKeys: true,
  allowApi: true,
  allowWhiteLabel: true,
  removeBranding: true,
};

export async function getActivePlans(): Promise<Plan[]> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("is_active", "=", 1).orderBy("sort_order").orderBy("id").execute();
}

export async function getAllPlans(): Promise<Plan[]> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().orderBy("sort_order").orderBy("id").execute();
}

export async function getPlan(id: number): Promise<Plan | undefined> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getFreePlan(): Promise<Plan | undefined> {
  const db = await getDb();
  return db.selectFrom("plans").selectAll().where("is_free", "=", 1).orderBy("id").executeTakeFirst();
}

export function hasActivePaidPlan(user: Pick<SessionUser, "plan_id" | "plan_expires_at"> | null): boolean {
  return Boolean(user?.plan_id && user.plan_expires_at && user.plan_expires_at > now());
}

/** A stored limit: whole number, -1 for anything negative. */
const limit = (v: unknown) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? (n < 0 ? -1 : n) : 0;
};

export type PlanLimitColumns = Pick<
  Plan,
  | "max_agents"
  | "max_numbers"
  | "max_concurrent_calls"
  | "included_minutes_monthly"
  | "max_members"
  | "max_ai_monthly"
  | "allow_outbound"
  | "allow_campaigns"
  | "allow_byo_keys"
  | "allow_api"
  | "allow_white_label"
  | "remove_branding"
>;

export function limitsFromPlan(plan: PlanLimitColumns): Limits {
  return {
    maxAgents: limit(plan.max_agents),
    maxNumbers: limit(plan.max_numbers),
    maxConcurrentCalls: limit(plan.max_concurrent_calls),
    includedMinutesMonthly: limit(plan.included_minutes_monthly),
    maxMembers: limit(plan.max_members),
    maxAiMonthly: limit(plan.max_ai_monthly),
    allowOutbound: plan.allow_outbound === 1,
    allowCampaigns: plan.allow_campaigns === 1 && plan.allow_outbound === 1,
    allowByoKeys: plan.allow_byo_keys === 1,
    allowApi: plan.allow_api === 1,
    allowWhiteLabel: plan.allow_white_label === 1,
    removeBranding: plan.remove_branding === 1,
  };
}

export async function getEntitlements(user: Pick<SessionUser, "role" | "plan_id" | "plan_expires_at"> | null): Promise<Entitlements> {
  if (user?.role === "admin") return { plan: null, isPremium: true, ...ADMIN_LIMITS, expiresAt: null };
  if (user && hasActivePaidPlan(user)) {
    const plan = await getPlan(user.plan_id!);
    if (plan && !plan.is_free) return { plan, isPremium: true, ...limitsFromPlan(plan), expiresAt: user.plan_expires_at };
  }
  const free = await getFreePlan();
  return {
    plan: free ?? null,
    isPremium: false,
    ...(free ? limitsFromPlan(free) : FALLBACK_FREE),
    expiresAt: null,
  };
}

/** True for an unlimited limit (-1). */
export function isUnlimited(limitValue: number): boolean {
  return limitValue < 0;
}

/** True when `used` has reached a limit (-1 = unlimited, 0 = nothing allowed). */
export function atLimit(used: number, limitValue: number): boolean {
  return limitValue >= 0 && used >= limitValue;
}

/** How many more items fit under a limit (Infinity when unlimited, never negative). */
export function remaining(used: number, limitValue: number): number {
  return limitValue < 0 ? Infinity : Math.max(0, limitValue - used);
}

/** The limits and switches a pricing card shows (camelCase; -1 = unlimited). */
export function planCardLimits(plan: PlanLimitColumns) {
  const l = limitsFromPlan(plan);
  return {
    maxAgents: l.maxAgents,
    maxNumbers: l.maxNumbers,
    maxConcurrentCalls: l.maxConcurrentCalls,
    includedMinutesMonthly: l.includedMinutesMonthly,
    maxMembers: l.maxMembers,
    allowOutbound: l.allowOutbound,
    allowCampaigns: l.allowCampaigns,
    allowApi: l.allowApi,
    allowByoKeys: l.allowByoKeys,
    allowWhiteLabel: l.allowWhiteLabel,
    removeBranding: l.removeBranding,
  };
}

export function planFeatures(plan: Pick<Plan, "features">): string[] {
  return (plan.features ?? "")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** What a banned (or missing) owner's workspaces may do: nothing that places or bills calls. */
const SUSPENDED_LIMITS: Limits = {
  maxAgents: 0,
  maxNumbers: 0,
  maxConcurrentCalls: 0,
  includedMinutesMonthly: 0,
  maxMembers: 0,
  maxAiMonthly: 0,
  allowOutbound: false,
  allowCampaigns: false,
  allowByoKeys: false,
  allowApi: false,
  allowWhiteLabel: false,
  removeBranding: false,
};

/**
 * Entitlements of a user by id (e.g. the owner of a workspace in jobs, calls and the REST API).
 * A banned or deleted owner gets the suspended limits: their workspaces can't call, dial
 * campaigns, take widget calls or use the API until the admin lifts the ban.
 */
export async function getEntitlementsForUserId(userId: number): Promise<Entitlements> {
  const db = await getDb();
  const user = await db.selectFrom("users").select(["role", "plan_id", "plan_expires_at", "status"]).where("id", "=", userId).executeTakeFirst();
  if (!user || user.status !== "active") return { plan: null, isPremium: false, suspended: true, ...SUSPENDED_LIMITS, expiresAt: null };
  return getEntitlements(user);
}
