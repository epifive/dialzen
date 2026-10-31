import "server-only";
import crypto from "node:crypto";
import { getDb, now } from "./db";
import type { WorkspaceRow } from "./db/schema";
import { atLimit, getEntitlementsForUserId, type Entitlements } from "./plans";
import { randomToken } from "./tokens";
import { DEFAULT_WORKSPACE_SETTINGS, normalizeEmail, normalizeTimeZone, normalizeWorkspaceSettings, parseJson, roleAtLeast } from "@/voice/normalize";
import type { AssignableRole, WorkspaceRole, WorkspaceSettings } from "@/voice/types";

/**
 * Workspaces: every user has a personal workspace (created on sign-up or on the first dashboard
 * visit) and can create more (one per brand or client) and be invited into other people's.
 *
 * Routing: dashboard pages live under /dashboard/w/<workspace id>/…; /dashboard redirects to the
 * workspace remembered in the WORKSPACE_COOKIE, else the personal one. Every page and action
 * checks membership and role with requireWorkspace() / guardWorkspace() (src/lib/dashboard.ts).
 *
 * Limits come from the OWNER's plan and count across all workspaces the owner owns.
 */

/** Cookie with the id of the workspace used last (only a hint: membership is always checked). */
export const WORKSPACE_COOKIE = "dz_ws";
export const MAX_WORKSPACES_PER_USER = 50;
export const INVITE_TTL_DAYS = 14;

export interface WorkspaceRecord {
  id: number;
  ownerId: number;
  name: string;
  timezone: string;
  settings: WorkspaceSettings;
  isPersonal: boolean;
  createdAt: string;
}

export interface Membership {
  workspace: WorkspaceRecord;
  role: WorkspaceRole;
}

export function toWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    timezone: normalizeTimeZone(row.timezone),
    settings: normalizeWorkspaceSettings(parseJson(row.settings)),
    isPersonal: row.is_personal === 1,
    createdAt: row.created_at,
  };
}

const validId = (id: number) => Number.isInteger(id) && id > 0;

/** Workspaces the user belongs to, with their role: personal first, then by name. */
export async function getUserWorkspaces(userId: number): Promise<Membership[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("workspace_members as m")
    .innerJoin("workspaces as w", "w.id", "m.workspace_id")
    .selectAll("w")
    .select("m.role as member_role")
    .where("m.user_id", "=", userId)
    .execute();
  return rows
    .map(({ member_role, ...row }) => ({ workspace: toWorkspaceRecord(row as WorkspaceRow), role: member_role as WorkspaceRole }))
    .sort((a, b) => Number(b.workspace.isPersonal && b.workspace.ownerId === userId) - Number(a.workspace.isPersonal && a.workspace.ownerId === userId) || a.workspace.name.localeCompare(b.workspace.name));
}

export async function getWorkspace(workspaceId: number): Promise<WorkspaceRecord | undefined> {
  if (!validId(workspaceId)) return undefined;
  const db = await getDb();
  const row = await db.selectFrom("workspaces").selectAll().where("id", "=", workspaceId).executeTakeFirst();
  return row ? toWorkspaceRecord(row) : undefined;
}

/** The user's membership of a workspace (undefined when not a member). */
export async function getMembership(workspaceId: number, userId: number): Promise<Membership | undefined> {
  if (!validId(workspaceId)) return undefined;
  const db = await getDb();
  const row = await db
    .selectFrom("workspace_members as m")
    .innerJoin("workspaces as w", "w.id", "m.workspace_id")
    .selectAll("w")
    .select("m.role as member_role")
    .where("m.workspace_id", "=", workspaceId)
    .where("m.user_id", "=", userId)
    .executeTakeFirst();
  if (!row) return undefined;
  const { member_role, ...ws } = row;
  return { workspace: toWorkspaceRecord(ws as WorkspaceRow), role: member_role as WorkspaceRole };
}

/** True when the user is a member with at least `minRole`. */
export async function hasWorkspaceRole(workspaceId: number, userId: number, minRole: WorkspaceRole): Promise<boolean> {
  const m = await getMembership(workspaceId, userId);
  return Boolean(m && roleAtLeast(m.role, minRole));
}

/** Plan limits of a workspace = its owner's entitlements. */
export async function getWorkspaceEntitlements(workspace: Pick<WorkspaceRecord, "ownerId">): Promise<Entitlements> {
  return getEntitlementsForUserId(workspace.ownerId);
}

export async function createWorkspace(ownerId: number, input: { name: string; timezone?: string; personal?: boolean; settings?: Partial<WorkspaceSettings> }): Promise<WorkspaceRecord> {
  const db = await getDb();
  const ts = now();
  const settings = normalizeWorkspaceSettings({ ...DEFAULT_WORKSPACE_SETTINGS, ...input.settings });
  const id = await db.transaction().execute(async (trx) => {
    const res = await trx
      .insertInto("workspaces")
      .values({
        owner_id: ownerId,
        name: input.name.trim().slice(0, 120) || "Workspace",
        timezone: normalizeTimeZone(input.timezone),
        settings: JSON.stringify(settings),
        is_personal: input.personal ? 1 : 0,
        created_at: ts,
        updated_at: ts,
      })
      .executeTakeFirstOrThrow();
    const workspaceId = Number(res.insertId);
    await trx.insertInto("workspace_members").values({ workspace_id: workspaceId, user_id: ownerId, role: "owner", created_at: ts }).execute();
    return workspaceId;
  });
  return (await getWorkspace(id))!;
}

/**
 * The user's personal workspace, created when missing (sign-up, first dashboard visit, users
 * created by the admin or from ADMIN_EMAIL). Safe to call on every request: concurrent first
 * visits that both create one keep the oldest.
 */
export async function ensurePersonalWorkspace(user: { id: number; name: string }, timezone?: string): Promise<WorkspaceRecord> {
  const db = await getDb();
  const find = () => db.selectFrom("workspaces").selectAll().where("owner_id", "=", user.id).where("is_personal", "=", 1).orderBy("id").execute();
  const existing = await find();
  if (existing.length) return toWorkspaceRecord(existing[0]);
  const first = (user.name.trim().split(/\s+/)[0] || "My").slice(0, 60);
  await createWorkspace(user.id, { name: `${first}'s workspace`, timezone, personal: true });
  const rows = await find();
  for (const extra of rows.slice(1)) await deleteWorkspaceData(extra.id);
  return toWorkspaceRecord(rows[0]);
}

export async function updateWorkspace(workspaceId: number, input: { name?: string; timezone?: string; settings?: WorkspaceSettings }): Promise<void> {
  const db = await getDb();
  await db
    .updateTable("workspaces")
    .set({
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) || "Workspace" } : {}),
      ...(input.timezone !== undefined ? { timezone: normalizeTimeZone(input.timezone) } : {}),
      ...(input.settings !== undefined ? { settings: JSON.stringify(normalizeWorkspaceSettings(input.settings)) } : {}),
      updated_at: now(),
    })
    .where("id", "=", workspaceId)
    .execute();
}

/**
 * Workspaces whose owner is banned: the background jobs (campaigns, calls) skip them until the
 * admin lifts the ban.
 */
export async function bannedOwnerWorkspaceIds(): Promise<number[]> {
  const db = await getDb();
  const rows = await db.selectFrom("workspaces as w").innerJoin("users as u", "u.id", "w.owner_id").select("w.id").where("u.status", "=", "banned").execute();
  return rows.map((r) => r.id);
}

/** Tables with a workspace_id column, deleted with the workspace (children before parents). */
const WORKSPACE_TABLES = [
  "campaign_contacts",
  "campaigns",
  "calls",
  "list_members",
  "contact_lists",
  "consents",
  "contacts",
  "agent_tools",
  "tools",
  "kb_items",
  "agents",
  "phone_numbers",
  "provider_accounts",
  "credit_transactions",
  "wallets",
  "compliance_settings",
  "kyc_requests",
  "media",
  "media_folders",
  "notify_channels",
  "api_keys",
  "workspace_invites",
  "workspace_members",
  // Scheduled events of simulated calls (they hold transcripts and phone numbers).
  "voice_sim_events",
] as const;

/**
 * Deletes a workspace and everything in it: agents, numbers, contacts, consent records,
 * campaigns, calls, wallet and API keys. Callers release the workspace's numbers and agents at
 * the providers first (best effort) and delete the stored FILES (media and call recordings,
 * deleteWorkspaceMediaFiles in src/lib/media/service.ts); this removes the rows.
 *
 * Kept on purpose, with their workspace id, for the operator's records: the workspace's DNC
 * entries (internal do-not-call records must be kept for years) and the audit log (append-only).
 */
export async function deleteWorkspaceData(workspaceId: number): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    for (const table of WORKSPACE_TABLES) await trx.deleteFrom(table).where("workspace_id", "=", workspaceId).execute();
    await trx.updateTable("alert_log").set({ workspace_id: null }).where("workspace_id", "=", workspaceId).execute();
    await trx.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
  });
}

// ── Members and seats ──

export interface MemberRecord {
  userId: number;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

export async function getMembers(workspaceId: number): Promise<MemberRecord[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom("workspace_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select(["m.user_id", "m.role", "m.created_at", "u.name", "u.email"])
    .where("m.workspace_id", "=", workspaceId)
    .orderBy("m.id")
    .execute();
  return rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role as WorkspaceRole, joinedAt: r.created_at }));
}

/**
 * Seats used by an owner: distinct people who are members of any workspace the owner owns (the
 * owner included) plus pending invites to addresses that aren't members yet.
 */
export async function countSeats(ownerId: number): Promise<number> {
  const db = await getDb();
  const owned = await db.selectFrom("workspaces").select("id").where("owner_id", "=", ownerId).execute();
  if (!owned.length) return 1;
  const ids = owned.map((w) => w.id);
  const members = await db.selectFrom("workspace_members as m").innerJoin("users as u", "u.id", "m.user_id").select(["m.user_id", "u.email"]).where("m.workspace_id", "in", ids).execute();
  const people = new Set(members.map((m) => m.user_id));
  people.add(ownerId);
  const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));
  const invites = await db.selectFrom("workspace_invites").select("email").where("workspace_id", "in", ids).where("expires_at", ">", now()).execute();
  const pending = new Set(invites.map((i) => i.email.toLowerCase()).filter((e) => !memberEmails.has(e)));
  return people.size + pending.size;
}

/** True when the owner may add one more person (an existing member of another owned workspace is free). */
export async function hasFreeSeat(ownerId: number, entitlements: Pick<Entitlements, "maxMembers">, email?: string): Promise<boolean> {
  if (entitlements.maxMembers < 0) return true;
  if (email) {
    const db = await getDb();
    const already = await db
      .selectFrom("workspace_members as m")
      .innerJoin("workspaces as w", "w.id", "m.workspace_id")
      .innerJoin("users as u", "u.id", "m.user_id")
      .select("m.user_id")
      .where("w.owner_id", "=", ownerId)
      .where("u.email", "=", email.toLowerCase())
      .executeTakeFirst();
    if (already) return true;
  }
  return !atLimit(await countSeats(ownerId), entitlements.maxMembers);
}

export async function setMemberRole(workspaceId: number, userId: number, role: AssignableRole): Promise<void> {
  const db = await getDb();
  await db.updateTable("workspace_members").set({ role }).where("workspace_id", "=", workspaceId).where("user_id", "=", userId).where("role", "!=", "owner").execute();
}

export async function removeMember(workspaceId: number, userId: number): Promise<void> {
  const db = await getDb();
  await db.deleteFrom("workspace_members").where("workspace_id", "=", workspaceId).where("user_id", "=", userId).where("role", "!=", "owner").execute();
  // Their API keys for this workspace stop working with them.
  await db.deleteFrom("api_keys").where("workspace_id", "=", workspaceId).where("user_id", "=", userId).execute();
}

// ── Invites ──

export interface InviteRecord {
  id: number;
  email: string;
  role: AssignableRole;
  invitedBy: number;
  expiresAt: string;
  createdAt: string;
}

export const hashInviteToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function getInvites(workspaceId: number): Promise<InviteRecord[]> {
  const db = await getDb();
  const rows = await db.selectFrom("workspace_invites").selectAll().where("workspace_id", "=", workspaceId).where("expires_at", ">", now()).orderBy("id", "desc").execute();
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role as AssignableRole, invitedBy: r.invited_by, expiresAt: r.expires_at, createdAt: r.created_at }));
}

/**
 * Creates (or renews) an invite and returns its token: the invite link is /invite/<token>. The
 * caller checks the role and the free seat first (hasFreeSeat()).
 */
export async function createInvite(workspaceId: number, input: { email: string; role: AssignableRole; invitedBy: number }): Promise<{ token: string } | { error: "email" | "member" }> {
  const email = normalizeEmail(input.email);
  if (!email) return { error: "email" };
  const db = await getDb();
  const member = await db
    .selectFrom("workspace_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select("m.id")
    .where("m.workspace_id", "=", workspaceId)
    .where("u.email", "=", email)
    .executeTakeFirst();
  if (member) return { error: "member" };
  const token = randomToken(32);
  const ts = now();
  const values = { role: input.role, token_hash: hashInviteToken(token), invited_by: input.invitedBy, expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(), created_at: ts };
  const existing = await db.selectFrom("workspace_invites").select("id").where("workspace_id", "=", workspaceId).where("email", "=", email).executeTakeFirst();
  if (existing) await db.updateTable("workspace_invites").set(values).where("id", "=", existing.id).execute();
  else await db.insertInto("workspace_invites").values({ workspace_id: workspaceId, email, ...values }).execute();
  return { token };
}

export async function revokeInvite(workspaceId: number, inviteId: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.deleteFrom("workspace_invites").where("workspace_id", "=", workspaceId).where("id", "=", inviteId).executeTakeFirst();
  return Number(res.numDeletedRows) > 0;
}

/** The invite behind a link (undefined when unknown or expired). */
export async function findInvite(token: string): Promise<(InviteRecord & { workspaceId: number }) | undefined> {
  if (!/^[\w-]{20,100}$/.test(token)) return undefined;
  const db = await getDb();
  const r = await db.selectFrom("workspace_invites").selectAll().where("token_hash", "=", hashInviteToken(token)).where("expires_at", ">", now()).executeTakeFirst();
  return r ? { id: r.id, workspaceId: r.workspace_id, email: r.email, role: r.role as AssignableRole, invitedBy: r.invited_by, expiresAt: r.expires_at, createdAt: r.created_at } : undefined;
}

export type AcceptInviteResult = { ok: true; workspaceId: number } | { ok: false; error: "invalid" | "email" | "seats" };

/** Joins the signed-in user to the invite's workspace. The account email must match the invite. */
export async function acceptInvite(token: string, user: { id: number; email: string }): Promise<AcceptInviteResult> {
  const invite = await findInvite(token);
  if (!invite) return { ok: false, error: "invalid" };
  if (invite.email !== user.email.toLowerCase()) return { ok: false, error: "email" };
  const workspace = await getWorkspace(invite.workspaceId);
  if (!workspace) return { ok: false, error: "invalid" };
  if (!(await inviteSeatOk(workspace))) return { ok: false, error: "seats" };
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    const member = await trx.selectFrom("workspace_members").select("id").where("workspace_id", "=", workspace.id).where("user_id", "=", user.id).executeTakeFirst();
    if (!member) await trx.insertInto("workspace_members").values({ workspace_id: workspace.id, user_id: user.id, role: invite.role, created_at: now() }).execute();
    await trx.deleteFrom("workspace_invites").where("id", "=", invite.id).execute();
  });
  return { ok: true, workspaceId: workspace.id };
}

/** Seat check for accepting: the pending invite already holds a seat, so only over-limit plans (after a downgrade) refuse. */
export async function inviteSeatOk(workspace: Pick<WorkspaceRecord, "ownerId">): Promise<boolean> {
  const entitlements = await getWorkspaceEntitlements(workspace);
  return entitlements.maxMembers < 0 || (await countSeats(workspace.ownerId)) <= entitlements.maxMembers;
}

// ── Ownership ──

export type TransferResult = { ok: true } | { ok: false; error: "personal" | "self" | "member" };

/**
 * Hands a (non-personal) workspace to another member. The previous owner stays as admin; the
 * workspace's limits then come from the new owner's plan.
 */
export async function transferOwnership(workspace: Pick<WorkspaceRecord, "id" | "ownerId" | "isPersonal">, toUserId: number): Promise<TransferResult> {
  if (workspace.isPersonal) return { ok: false, error: "personal" };
  if (toUserId === workspace.ownerId) return { ok: false, error: "self" };
  const db = await getDb();
  const member = await db.selectFrom("workspace_members").select(["id", "role"]).where("workspace_id", "=", workspace.id).where("user_id", "=", toUserId).executeTakeFirst();
  if (!member) return { ok: false, error: "member" };
  await db.transaction().execute(async (trx) => {
    await trx.updateTable("workspace_members").set({ role: "admin" }).where("workspace_id", "=", workspace.id).where("user_id", "=", workspace.ownerId).execute();
    await trx.updateTable("workspace_members").set({ role: "owner" }).where("id", "=", member.id).execute();
    await trx.updateTable("workspaces").set({ owner_id: toUserId, updated_at: now() }).where("id", "=", workspace.id).execute();
  });
  return { ok: true };
}

/** Ids of every workspace the user owns (limits count across all of them). */
export async function ownedWorkspaceIds(ownerId: number): Promise<number[]> {
  const db = await getDb();
  return (await db.selectFrom("workspaces").select("id").where("owner_id", "=", ownerId).execute()).map((w) => w.id);
}
