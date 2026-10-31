"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyAllSessions, destroySession, getCurrentUser } from "@/lib/auth/session";
import { DEMO_MESSAGE } from "@/lib/admin";
import { isDemoMode } from "@/lib/config";
import { getDb, now } from "@/lib/db";
import type { Translator } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { mailConfigured, sendMail } from "@/lib/mail";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { safeNextPath } from "@/lib/utils";
import { ensurePersonalWorkspace } from "@/lib/workspaces";
import type { FormState } from "./types";

const emailField = (t: Translator) =>
  z.email(t("auth.err.invalidEmail")).max(190).transform((v) => v.trim().toLowerCase());
const passwordField = (t: Translator) => z.string().min(8, t("auth.err.passwordLength")).max(200);

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 10, 15 * 60_000)) {
    return { error: t("auth.err.tooManyLogins") };
  }
  const parsed = z
    .object({ email: emailField(t), password: z.string().min(1, t("auth.err.enterPassword")) })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  const user = await db.selectFrom("users").selectAll().where("email", "=", parsed.data.email).executeTakeFirst();
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return { error: t("auth.err.wrongCredentials") };
  }
  if (user.status !== "active") return { error: t("auth.err.suspended") };

  await createSession(user.id);
  redirect(safeNextPath(formData.get("next"), user.role === "admin" ? "/admin" : "/dashboard"));
}

export async function register(_prev: FormState, formData: FormData): Promise<FormState> {
  const [settings, t] = await Promise.all([getSettings(), getT()]);
  if (!settings.registration_enabled) return { error: t("auth.err.registrationClosed") };
  // A public demo is read-only, so new accounts couldn't do anything.
  if (isDemoMode()) return { error: t("auth.err.demoRegistration") };

  const ip = await clientIp();
  if (!rateLimit(`register:${ip}`, 5, 60 * 60_000)) {
    return { error: t("auth.err.tooManyAccounts") };
  }
  const parsed = z
    .object({
      name: z.string().trim().min(2, t("auth.err.enterName")).max(120),
      email: emailField(t),
      password: passwordField(t),
      terms: z.literal("on", { error: t("auth.err.acceptTerms") }),
    })
    .safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      terms: formData.get("terms"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  const exists = await db.selectFrom("users").select("id").where("email", "=", parsed.data.email).executeTakeFirst();
  if (exists) return { error: t("auth.err.emailTaken") };

  const ts = now();
  const result = await db
    .insertInto("users")
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      password_hash: await hashPassword(parsed.data.password),
      role: "user",
      status: "active",
      plan_id: null,
      plan_expires_at: null,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      created_at: ts,
      updated_at: ts,
    })
    .executeTakeFirstOrThrow();

  const userId = Number(result.insertId);
  // Every account starts with a personal workspace (in the visitor's time zone when the browser sent it).
  await ensurePersonalWorkspace({ id: userId, name: parsed.data.name }, String(formData.get("timezone") ?? ""));
  await createSession(userId);
  redirect(safeNextPath(formData.get("next"), "/dashboard"));
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const [settings, t] = await Promise.all([getSettings(), getT()]);
  if (!mailConfigured(settings)) {
    return { error: t("auth.err.resetUnavailable", { email: settings.site_email }) };
  }
  const ip = await clientIp();
  if (!rateLimit(`reset:${ip}`, 5, 60 * 60_000)) return { error: t("auth.err.tooManyRequests") };

  const parsed = emailField(t).safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  const user = await db.selectFrom("users").select(["id", "name", "email"]).where("email", "=", parsed.data).executeTakeFirst();
  // Always answer the same way so the form can't be used to discover accounts.
  const message = t("auth.resetSent");
  if (!user) return { success: message };

  const token = crypto.randomBytes(32).toString("base64url");
  await db.deleteFrom("password_resets").where("user_id", "=", user.id).execute();
  await db
    .insertInto("password_resets")
    .values({
      token_hash: hashToken(token),
      user_id: user.id,
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      created_at: now(),
    })
    .execute();

  try {
    await sendMail({
      to: user.email,
      subject: `Reset your ${settings.site_name} password`,
      text: `Hi ${user.name},\n\nUse the link below to choose a new password. It expires in 1 hour.\n\n${absoluteUrl(settings, `/reset-password?token=${token}`)}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  } catch {
    return { error: t("auth.err.mailFailed") };
  }
  return { success: message };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const parsed = z
    .object({ token: z.string().min(10, t("auth.err.linkInvalid")), password: passwordField(t) })
    .safeParse({ token: formData.get("token"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  const reset = await db
    .selectFrom("password_resets")
    .selectAll()
    .where("token_hash", "=", hashToken(parsed.data.token))
    .executeTakeFirst();
  if (!reset || reset.expires_at < now()) {
    return { error: t("auth.err.linkExpired") };
  }
  await db
    .updateTable("users")
    .set({ password_hash: await hashPassword(parsed.data.password), updated_at: now() })
    .where("id", "=", reset.user_id)
    .execute();
  await db.deleteFrom("password_resets").where("user_id", "=", reset.user_id).execute();
  await destroyAllSessions(reset.user_id);
  await createSession(reset.user_id);
  redirect("/account?password=reset");
}

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const [user, t] = await Promise.all([getCurrentUser(), getT()]);
  if (!user) return { error: t("auth.err.sessionExpired") };
  if (isDemoMode() && user.role === "admin") return { error: DEMO_MESSAGE };
  const parsed = z
    .object({ name: z.string().trim().min(2, t("auth.err.enterName")).max(120), email: emailField(t) })
    .safeParse({ name: formData.get("name"), email: formData.get("email") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  if (parsed.data.email !== user.email) {
    const taken = await db
      .selectFrom("users")
      .select("id")
      .where("email", "=", parsed.data.email)
      .where("id", "!=", user.id)
      .executeTakeFirst();
    if (taken) return { error: t("auth.err.emailInUse") };
  }
  await db
    .updateTable("users")
    .set({ name: parsed.data.name, email: parsed.data.email, updated_at: now() })
    .where("id", "=", user.id)
    .execute();
  return { success: t("auth.profileSaved") };
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const [user, t] = await Promise.all([getCurrentUser(), getT()]);
  if (!user) return { error: t("auth.err.sessionExpired") };
  if (isDemoMode() && user.role === "admin") return { error: DEMO_MESSAGE };
  const parsed = z
    .object({ current: z.string().min(1, t("auth.err.currentPassword")), password: passwordField(t) })
    .safeParse({ current: formData.get("current_password"), password: formData.get("new_password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const db = await getDb();
  const row = await db.selectFrom("users").select("password_hash").where("id", "=", user.id).executeTakeFirstOrThrow();
  if (!(await verifyPassword(parsed.data.current, row.password_hash))) {
    return { error: t("auth.err.currentWrong") };
  }
  await db
    .updateTable("users")
    .set({ password_hash: await hashPassword(parsed.data.password), updated_at: now() })
    .where("id", "=", user.id)
    .execute();
  await destroyAllSessions(user.id);
  await createSession(user.id);
  return { success: t("auth.passwordChanged") };
}
