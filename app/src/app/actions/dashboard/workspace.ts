"use server";

import { redirect } from "next/navigation";
import { guardDashboard, guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { mailConfigured, sendMail } from "@/lib/mail";
import { deleteWorkspaceMediaFiles } from "@/lib/media/service";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { cleanupWorkspaceProviders } from "@/lib/voice/cleanup";
import {
  acceptInvite,
  createInvite,
  createWorkspace,
  deleteWorkspaceData,
  getUserWorkspaces,
  getWorkspaceEntitlements,
  hasFreeSeat,
  MAX_WORKSPACES_PER_USER,
  removeMember,
  revokeInvite,
  setMemberRole,
  updateWorkspace,
  getMembership,
} from "@/lib/workspaces";
import { canManageMember, countryInfo, isAssignableRole, isValidTimeZone, normalizeEmail, normalizeLanguageTag } from "@/voice/normalize";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

/** "New workspace": the creator becomes its owner (limits still count on their own plan). */
export async function createWorkspaceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const name = str(formData.get("name")).trim();
  if (!name || name.length > 120) return { error: t("dash.ws.err.name") };
  const timezone = str(formData.get("timezone"));
  if (!isValidTimeZone(timezone)) return { error: t("dash.ws.err.timezone") };
  if (!rateLimit(`ws-create:${guard.user.id}`, 10, 60 * 60_000)) return { error: t("dash.ws.err.rate") };
  const owned = (await getUserWorkspaces(guard.user.id)).filter((m) => m.role === "owner");
  if (owned.length >= MAX_WORKSPACES_PER_USER) return { error: t("dash.ws.err.limit", { n: MAX_WORKSPACES_PER_USER }) };
  const ws = await createWorkspace(guard.user.id, { name, timezone });
  redirect(`/dashboard/w/${ws.id}?created=1`);
}

/** Workspace settings (Settings page): name, time zone, default country and language, week start. */
export async function saveWorkspaceSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const name = str(formData.get("name")).trim();
  if (!name || name.length > 120) return { error: t("dash.ws.err.name") };
  const timezone = str(formData.get("timezone"));
  if (!isValidTimeZone(timezone)) return { error: t("dash.ws.err.timezone") };
  const country = countryInfo(str(formData.get("default_country")))?.iso ?? guard.workspace.settings.defaultCountry;
  await updateWorkspace(guard.workspace.id, {
    name,
    timezone,
    settings: {
      ...guard.workspace.settings,
      defaultCountry: country,
      defaultLanguage: normalizeLanguageTag(str(formData.get("default_language")), guard.workspace.settings.defaultLanguage),
      weekStart: str(formData.get("week_start")) === "7" ? 7 : 1,
    },
  });
  return { success: t("dash.settings.saved") };
}

/** White-label branding of the widget and emails (used when the owner's plan allows white label). */
export async function saveBrandingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "settings.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const logo = str(formData.get("logo")).trim();
  if (logo && !/^https:\/\/[^\s"'<>]+$/i.test(logo)) return { error: t("dash.branding.err.logo") };
  const color = str(formData.get("color")).trim();
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) return { error: t("dash.branding.err.color") };
  await updateWorkspace(guard.workspace.id, {
    settings: { ...guard.workspace.settings, branding: { companyName: str(formData.get("company")).trim().slice(0, 120), logo: logo.slice(0, 500), color: formData.get("use_color") === "on" ? color : "" } },
  });
  return { success: t("dash.branding.saved") };
}

/** Deletes a (non-personal) workspace with everything in it, uploaded files included (owner only). */
export async function deleteWorkspaceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "workspace.delete" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (guard.workspace.isPersonal) return { error: t("dash.settings.deletePersonal") };
  if (str(formData.get("confirm")).trim() !== guard.workspace.name.trim()) return { error: t("dash.settings.err.deleteName") };
  // Numbers, agents and documents at the voice providers first (they cost money and keep answering).
  await cleanupWorkspaceProviders(guard.workspace.id, { type: "user", id: guard.user.id });
  await deleteWorkspaceMediaFiles(guard.workspace.id);
  await deleteWorkspaceData(guard.workspace.id);
  redirect("/dashboard");
}

/** Invite someone by email (Team page). Needs a free seat on the owner's plan. */
export async function inviteMemberAction(_prev: FormState & { link?: string }, formData: FormData): Promise<FormState & { link?: string }> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "members.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const email = normalizeEmail(formData.get("email"));
  if (!email) return { error: t("dash.team.err.email") };
  const role = str(formData.get("role"));
  if (!isAssignableRole(role) || !canManageMember(guard.role, "viewer", role)) return { error: t("dash.team.err.role") };
  if (!rateLimit(`invite:${guard.user.id}`, 30, 60 * 60_000)) return { error: t("dash.team.err.rate") };
  if (!(await hasFreeSeat(guard.workspace.ownerId, await getWorkspaceEntitlements(guard.workspace), email))) return { error: t("dash.team.err.seats") };
  const result = await createInvite(guard.workspace.id, { email, role, invitedBy: guard.user.id });
  if ("error" in result) return { error: result.error === "member" ? t("dash.team.err.member") : t("dash.team.err.email") };

  const settings = await getSettings();
  const link = absoluteUrl(settings, `/invite/${result.token}`);
  if (mailConfigured(settings)) {
    try {
      await sendMail({
        to: email,
        subject: t("dash.team.inviteSubject", { workspace: guard.workspace.name, site: settings.site_name }),
        text: t("dash.team.inviteBody", { name: guard.user.name, workspace: guard.workspace.name, site: settings.site_name, link }),
      });
      return { success: t("dash.team.invited", { email }), link };
    } catch {
      // Fall through: show the link so it can be shared another way.
    }
  }
  return { success: t("dash.team.invitedLink", { email }), link };
}

export async function revokeInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "members.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!(await revokeInvite(guard.workspace.id, idOf(formData.get("invite_id"))))) return { error: t("dash.team.err.notFound") };
  return { success: t("dash.team.revoked") };
}

export async function changeMemberRoleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "members.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const member = await getMembership(guard.workspace.id, idOf(formData.get("user_id")));
  const role = str(formData.get("role"));
  if (!member) return { error: t("dash.team.err.notFound") };
  if (!isAssignableRole(role) || !canManageMember(guard.role, member.role, role)) return { error: t("dash.team.err.role") };
  await setMemberRole(guard.workspace.id, idOf(formData.get("user_id")), role);
  return { success: t("dash.team.roleSaved") };
}

export async function removeMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = idOf(formData.get("user_id"));
  const guard = await guardWorkspace(formData.get("wid"));
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const member = await getMembership(guard.workspace.id, userId);
  if (!member) return { error: t("dash.team.err.notFound") };
  // Anyone but the owner may leave; removing others needs the members capability.
  const leaving = userId === guard.user.id && member.role !== "owner";
  if (!leaving && !canManageMember(guard.role, member.role)) return { error: t("dash.team.err.role") };
  await removeMember(guard.workspace.id, userId);
  if (leaving) redirect("/dashboard");
  return { success: t("dash.team.removed") };
}

/** Joins the signed-in user to the workspace of an invite link (/invite/<token>). */
export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardDashboard();
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const result = await acceptInvite(str(formData.get("token")), guard.user);
  if (!result.ok) return { error: t(result.error === "email" ? "invite.err.email" : result.error === "seats" ? "invite.err.seats" : "invite.err.invalid") };
  redirect(`/dashboard/w/${result.workspaceId}`);
}
