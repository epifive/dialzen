"use server";

import { transferOwnership } from "@/lib/workspaces";
import { guardWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import type { FormState } from "../types";
import { idOf, str } from "./helpers";

/**
 * Hands the workspace to another member (owner only, password confirmed). The previous owner
 * stays as admin; plan limits then come from the new owner's plan.
 */
export async function transferOwnershipAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "workspace.delete" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (guard.role !== "owner") return { error: t("dash.team.err.role") };
  if (!rateLimit(`transfer:${guard.user.id}`, 5, 60 * 60_000)) return { error: t("dash.team.err.attempts") };
  const db = await getDb();
  const me = await db.selectFrom("users").select("password_hash").where("id", "=", guard.user.id).executeTakeFirst();
  if (!me || !(await verifyPassword(str(formData.get("password")), me.password_hash))) return { error: t("dash.team.err.password") };
  const result = await transferOwnership(guard.workspace, idOf(formData.get("user_id")));
  if (!result.ok) return { error: t(result.error === "personal" ? "dash.team.err.personal" : "dash.team.err.notFound") };
  return { success: t("dash.team.transferred") };
}
