"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin";
import { hashPassword } from "@/lib/auth/password";
import { destroyAllSessions } from "@/lib/auth/session";
import { getDb, now } from "@/lib/db";
import { deleteWorkspaceMediaFiles } from "@/lib/media/service";
import { pauseOwnerCampaigns } from "@/lib/campaigns";
import { cleanupWorkspaceProviders } from "@/lib/voice/cleanup";
import { deleteWorkspaceData, ensurePersonalWorkspace } from "@/lib/workspaces";
import type { FormState } from "@/app/actions/types";

const userSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(120),
  email: z.email("Enter a valid email.").transform((v) => v.trim().toLowerCase()),
  role: z.enum(["user", "admin"]),
  status: z.enum(["active", "banned"]),
  plan_id: z.coerce.number().int().min(0),
  plan_expires_at: z.string().trim(),
  password: z.string().max(200),
});

function readUser(formData: FormData) {
  return userSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    status: formData.get("status"),
    plan_id: formData.get("plan_id") || 0,
    plan_expires_at: formData.get("plan_expires_at") ?? "",
    password: formData.get("password") ?? "",
  });
}

function expiryIso(date: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T23:59:59Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function saveUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const rawId = Number(formData.get("user_id"));
  const userId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const parsed = readUser(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;
  if (data.password && data.password.length < 8) return { error: "Passwords must be at least 8 characters." };
  if (!userId && !data.password) return { error: "Set a password for the new user." };
  if (userId === guard.user.id && (data.role !== "admin" || data.status !== "active")) {
    return { error: "You can't remove your own admin access or ban yourself." };
  }

  const db = await getDb();
  const duplicate = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", data.email)
    .$if(userId !== null, (qb) => qb.where("id", "!=", userId!))
    .executeTakeFirst();
  if (duplicate) return { error: "Another user already has this email." };

  const planId = data.plan_id > 0 ? data.plan_id : null;
  const expires = planId ? expiryIso(data.plan_expires_at) : null;
  if (planId && !expires) return { error: "Choose the date the plan ends." };

  const ts = now();
  const values = {
    name: data.name,
    email: data.email,
    role: data.role,
    status: data.status,
    plan_id: planId,
    plan_expires_at: expires,
    updated_at: ts,
  };

  if (userId) {
    await db
      .updateTable("users")
      .set({ ...values, ...(data.password ? { password_hash: await hashPassword(data.password) } : {}) })
      .where("id", "=", userId)
      .execute();
    if (data.password || data.status === "banned") await destroyAllSessions(userId);
    if (data.status === "banned") await pauseOwnerCampaigns(userId, "suspended");
    return { success: "User saved." };
  }

  const result = await db
    .insertInto("users")
    .values({
      ...values,
      password_hash: await hashPassword(data.password),
      stripe_customer_id: null,
      stripe_subscription_id: null,
      created_at: ts,
    })
    .executeTakeFirstOrThrow();
  await ensurePersonalWorkspace({ id: Number(result.insertId), name: values.name });
  redirect(`/admin/users/${Number(result.insertId)}?created=1`);
}

export async function deleteUser(userId: number): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  if (userId === guard.user.id) return { error: "You can't delete your own account." };
  const db = await getDb();
  // Everything the account owns: its workspaces with their agents, numbers, contacts, calls,
  // credits, uploads, team, notification channels and API keys; memberships in other people's
  // workspaces; usage counters. DNC entries and the audit log are kept (see deleteWorkspaceData).
  // Payments are kept (accounting); they show "Deleted user" in Admin → Payments.
  // Media files are deleted from the storage (local disk, S3 or Blob) before the rows.
  const owned = await db.selectFrom("workspaces").select("id").where("owner_id", "=", userId).execute();
  for (const ws of owned) {
    // Numbers, agents and documents at the voice providers first (they cost money and keep answering).
    await cleanupWorkspaceProviders(ws.id, { type: "user", id: guard.user.id });
    await deleteWorkspaceMediaFiles(ws.id);
    await deleteWorkspaceData(ws.id);
  }
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("workspace_members").where("user_id", "=", userId).execute();
    await trx.deleteFrom("api_keys").where("user_id", "=", userId).execute();
    await trx.deleteFrom("usage_monthly").where("user_id", "=", userId).execute();
    await trx.deleteFrom("sessions").where("user_id", "=", userId).execute();
    await trx.deleteFrom("password_resets").where("user_id", "=", userId).execute();
    await trx.deleteFrom("users").where("id", "=", userId).execute();
  });
  redirect("/admin/users?deleted=1");
}
