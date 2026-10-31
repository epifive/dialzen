import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireDashboardUser, workspaceIdOf } from "@/lib/dashboard";
import { ensurePersonalWorkspace, getMembership, WORKSPACE_COOKIE } from "@/lib/workspaces";

/**
 * /dashboard: the entry point after sign-in. Creates the personal workspace on the first visit,
 * then opens the workspace used last (cookie) when the user is still a member of it, else the
 * personal one.
 */
export default async function DashboardEntry() {
  const user = await requireDashboardUser();
  const personal = await ensurePersonalWorkspace(user);
  const remembered = workspaceIdOf((await cookies()).get(WORKSPACE_COOKIE)?.value);
  const target = Number.isInteger(remembered) && remembered !== personal.id && (await getMembership(remembered, user.id)) ? remembered : personal.id;
  redirect(`/dashboard/w/${target}`);
}
