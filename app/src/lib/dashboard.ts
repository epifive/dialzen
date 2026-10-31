import "server-only";
import { notFound } from "next/navigation";
import { DEMO_MESSAGE } from "./admin";
import { getCurrentUser, requireUser, type SessionUser } from "./auth/session";
import { isDemoMode } from "./config";
import { getEntitlements, type Entitlements } from "./plans";
import { getMembership, getWorkspaceEntitlements, type WorkspaceRecord } from "./workspaces";
import { roleAtLeast, roleCan } from "@/voice/normalize";
import type { WorkspaceCapability, WorkspaceRole } from "@/voice/types";

/** For dashboard pages: the signed-in user (redirects to the login page otherwise). */
export async function requireDashboardUser(): Promise<SessionUser> {
  return requireUser("/dashboard");
}

/**
 * Guard for dashboard Server Actions that aren't about one workspace (account-level). Returns the
 * signed-in, active user, or an error message. In demo mode changes are blocked so every visitor
 * sees the same data.
 */
export async function guardDashboard(options: { allowInDemo?: boolean } = {}): Promise<
  { ok: true; user: SessionUser; entitlements: Entitlements } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Your session has expired. Sign in again." };
  if (isDemoMode() && !options.allowInDemo) return { ok: false, error: DEMO_MESSAGE };
  return { ok: true, user, entitlements: await getEntitlements(user) };
}

/** Workspace id from a route segment or form value; NaN when invalid. */
export function workspaceIdOf(value: string | number | FormDataEntryValue | null | undefined): number {
  if (typeof value === "number") return Number.isInteger(value) ? value : NaN;
  return typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : NaN;
}

export interface WorkspaceContext {
  user: SessionUser;
  workspace: WorkspaceRecord;
  role: WorkspaceRole;
}

/**
 * For pages under /dashboard/w/[wid]: the signed-in user, the workspace and their role. 404 when
 * the id is invalid, the user isn't a member, or their role ranks below `minRole`
 * (viewer < editor < admin < owner).
 */
export async function requireWorkspace(wid: string | number, minRole: WorkspaceRole = "viewer"): Promise<WorkspaceContext> {
  const user = await requireDashboardUser();
  const membership = await getMembership(workspaceIdOf(wid), user.id);
  if (!membership || !roleAtLeast(membership.role, minRole)) notFound();
  return { user, workspace: membership.workspace, role: membership.role };
}

export type WorkspaceGuard = ({ ok: true; entitlements: Entitlements } & WorkspaceContext) | { ok: false; error: string };

/**
 * Guard for workspace Server Actions: active session, membership, `minRole` and/or a capability
 * (roleCan()), and the demo-mode block. `entitlements` are the workspace OWNER's.
 */
export async function guardWorkspace(
  wid: string | number | FormDataEntryValue | null,
  options: { minRole?: WorkspaceRole; capability?: WorkspaceCapability; allowInDemo?: boolean } = {},
): Promise<WorkspaceGuard> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return { ok: false, error: "Your session has expired. Sign in again." };
  const membership = await getMembership(workspaceIdOf(wid), user.id);
  if (!membership) return { ok: false, error: "This workspace doesn't exist or you are no longer a member." };
  if (options.minRole && !roleAtLeast(membership.role, options.minRole)) return { ok: false, error: "Your role in this workspace doesn't allow this." };
  if (options.capability && !roleCan(membership.role, options.capability)) return { ok: false, error: "Your role in this workspace doesn't allow this." };
  if (isDemoMode() && !options.allowInDemo) return { ok: false, error: DEMO_MESSAGE };
  return { ok: true, user, workspace: membership.workspace, role: membership.role, entitlements: await getWorkspaceEntitlements(membership.workspace) };
}
