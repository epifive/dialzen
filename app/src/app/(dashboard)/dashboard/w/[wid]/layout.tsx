import type { ReactNode } from "react";
import { DashboardShell, type ShellBanner } from "@/components/dashboard/shell";
import type { ThemeChoice } from "@/components/site/theme";
import { isDemoMode } from "@/lib/config";
import { requireWorkspace } from "@/lib/dashboard";
import { formatNumber } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import { getEntitlements } from "@/lib/plans";
import { getSettings } from "@/lib/settings";
import { uploadUrl } from "@/lib/site";
import { getUsage } from "@/lib/usage";
import { getUserWorkspaces, getWorkspaceEntitlements } from "@/lib/workspaces";

/**
 * The shell of a workspace: membership check (404 otherwise), workspace switcher, navigation and
 * the owner's included call minutes of the month. Pages below get the workspace with requireWorkspace() again
 * (cheap; React caches nothing across pages, so each page re-checks its own role).
 */
export default async function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ wid: string }> }) {
  const { user, workspace, role } = await requireWorkspace((await params).wid);
  const [settings, locale, memberships, ownerEntitlements, userEntitlements, usage, t] = await Promise.all([
    getSettings(),
    getLocale(),
    getUserWorkspaces(user.id),
    getWorkspaceEntitlements(workspace),
    getEntitlements(user),
    getUsage(workspace.ownerId),
    getT(),
  ]);

  // The owner's included minutes this month (the meter in the sidebar shows the same). Minutes
  // beyond them are paid from the wallet, so this is a heads-up, not a block.
  const limit = ownerEntitlements.includedMinutesMonthly;
  const used = Math.floor(usage.secondsUsed / 60);
  let banner: ShellBanner | null = null;
  if (limit > 0 && used >= limit) {
    banner = { tone: "warning", text: t("dash.banner.minutesFull", { limit: formatNumber(limit, locale.code) }) };
  } else if (limit > 0 && used >= limit * 0.8) {
    banner = { tone: "warning", text: t("dash.banner.minutesNear", { pct: Math.floor((used / limit) * 100), limit: formatNumber(limit, locale.code) }) };
  }

  return (
    <DashboardShell
      siteName={settings.site_name}
      logo={uploadUrl(settings.logo)}
      logoDark={uploadUrl(settings.logo_dark)}
      user={{ name: user.name, email: user.email, isAdmin: user.role === "admin" }}
      workspaces={memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role, isPersonal: m.workspace.isPersonal }))}
      current={{ id: workspace.id, name: workspace.name, role, isPersonal: workspace.isPersonal }}
      usage={{ used, limit }}
      locale={locale.code}
      banner={banner}
      demo={isDemoMode()}
      defaultTheme={settings.default_theme as ThemeChoice}
      isPremium={userEntitlements.isPremium}
    >
      {children}
    </DashboardShell>
  );
}
