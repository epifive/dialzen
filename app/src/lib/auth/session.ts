import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, now } from "../db";
import type { User } from "../db/schema";

export const SESSION_COOKIE = "tz_session";
const SESSION_DAYS = 30;

export type SessionUser = Omit<User, "password_hash">;

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function isHttps(): Promise<boolean> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return (h.get("origin") ?? h.get("referer") ?? "").startsWith("https://");
}

/** Create a session for the user and set the session cookie. Server Actions / Route Handlers only. */
export async function createSession(userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const h = await headers();
  const db = await getDb();
  await db
    .insertInto("sessions")
    .values({
      id: hashToken(token),
      user_id: userId,
      expires_at: expires.toISOString(),
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null,
      user_agent: (h.get("user-agent") ?? "").slice(0, 255) || null,
      created_at: now(),
    })
    .execute();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttps(),
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.deleteFrom("sessions").where("id", "=", hashToken(token)).execute();
  }
  jar.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: number): Promise<void> {
  const db = await getDb();
  await db.deleteFrom("sessions").where("user_id", "=", userId).execute();
}

/** The signed-in user for the current request, or null. Deduplicated per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const row = await db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .select([
      "users.id",
      "users.name",
      "users.email",
      "users.role",
      "users.status",
      "users.plan_id",
      "users.plan_expires_at",
      "users.stripe_customer_id",
      "users.stripe_subscription_id",
      "users.created_at",
      "users.updated_at",
      "sessions.expires_at as session_expires_at",
    ])
    .where("sessions.id", "=", hashToken(token))
    .executeTakeFirst();
  if (!row || row.session_expires_at < now() || row.status !== "active") return null;
  const { session_expires_at: _expires, ...user } = row;
  void _expires;
  return user;
});

export async function requireUser(next = "/account"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/");
  return user;
}

/** For Server Actions: throws instead of redirecting so the action fails loudly. */
export async function assertAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Unauthorized");
  return user;
}

export async function cleanupExpiredSessions(): Promise<void> {
  const db = await getDb();
  await db.deleteFrom("sessions").where("expires_at", "<", now()).execute();
  await db.deleteFrom("password_resets").where("expires_at", "<", now()).execute();
}
