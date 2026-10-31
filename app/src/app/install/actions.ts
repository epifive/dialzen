"use server";

import fs from "node:fs";
import { Kysely, sql } from "kysely";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { isInstalled, markInstalled, storageDir, writeConfig, type DbConfig } from "@/lib/config";
import { createDialect, getDb, now, resetDb } from "@/lib/db";
import type { Database } from "@/lib/db/schema";
import { updateSettings } from "@/lib/settings";

export interface InstallResult {
  ok: boolean;
  message: string;
}

const dbSchema = z.discriminatedUnion("driver", [
  z.object({
    driver: z.literal("mysql"),
    host: z.string().trim().min(1, "Enter the database host."),
    port: z.coerce.number().int().min(1).max(65535),
    user: z.string().trim().min(1, "Enter the database username."),
    password: z.string(),
    database: z.string().trim().min(1, "Enter the database name.").regex(/^[\w$-]+$/, "The database name contains invalid characters."),
    ssl: z.boolean(),
  }),
  z.object({
    driver: z.literal("sqlite"),
    file: z
      .string()
      .trim()
      .min(1)
      .regex(/^[\w.-]+\.(sqlite|db)$/, "Use a simple file name ending in .sqlite, e.g. database.sqlite."),
  }),
]);

function readDbConfig(formData: FormData) {
  return dbSchema.safeParse({
    driver: formData.get("driver"),
    host: formData.get("host"),
    port: formData.get("port") || 3306,
    user: formData.get("user"),
    password: formData.get("password") ?? "",
    database: formData.get("database"),
    file: formData.get("file") || "database.sqlite",
    ssl: formData.get("ssl") === "on",
  });
}

async function tryConnect(config: DbConfig): Promise<string | null> {
  if (config.driver === "sqlite") fs.mkdirSync(storageDir(), { recursive: true });
  let db: Kysely<Database> | null = null;
  try {
    db = new Kysely<Database>({ dialect: await createDialect(config) });
    await sql`select 1`.execute(db);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (config.driver === "sqlite" && /not available in this Node/i.test(message)) {
      return "SQLite needs Node.js 22.13 or newer. Use MySQL or upgrade Node.js.";
    }
    return `Could not connect to the database: ${message}`;
  } finally {
    await db?.destroy().catch(() => undefined);
  }
}

export async function testDatabase(formData: FormData): Promise<InstallResult> {
  if (isInstalled()) return { ok: false, message: "The application is already installed." };
  const parsed = readDbConfig(formData);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const error = await tryConnect(parsed.data);
  return error ? { ok: false, message: error } : { ok: true, message: "Connected successfully." };
}

export async function runInstall(formData: FormData): Promise<InstallResult> {
  if (isInstalled()) return { ok: false, message: "The application is already installed." };

  const dbParsed = readDbConfig(formData);
  if (!dbParsed.success) return { ok: false, message: dbParsed.error.issues[0].message };

  const site = z
    .object({
      site_name: z.string().trim().min(2, "Enter a site name.").max(80),
      site_url: z.url("Enter the full site URL, e.g. https://voice.example.com").transform((v) => v.replace(/\/+$/, "")),
      admin_name: z.string().trim().min(2, "Enter the admin name.").max(120),
      admin_email: z.email("Enter a valid admin email.").transform((v) => v.trim().toLowerCase()),
      admin_password: z.string().min(8, "The admin password must be at least 8 characters."),
    })
    .safeParse({
      site_name: formData.get("site_name"),
      site_url: formData.get("site_url"),
      admin_name: formData.get("admin_name"),
      admin_email: formData.get("admin_email"),
      admin_password: formData.get("admin_password"),
    });
  if (!site.success) return { ok: false, message: site.error.issues[0].message };

  const connectError = await tryConnect(dbParsed.data);
  if (connectError) return { ok: false, message: connectError };

  try {
    writeConfig({ db: dbParsed.data, installedAt: now() });
  } catch {
    return { ok: false, message: `Could not write ${storageDir()}. Make sure the storage folder is writable.` };
  }

  try {
    await resetDb();
    const db = await getDb(); // runs all migrations
    await updateSettings({
      site_name: site.data.site_name,
      site_url: site.data.site_url,
      site_email: site.data.admin_email,
      mail_from_name: site.data.site_name,
      meta_title: `${site.data.site_name} — AI Voice Agents for Support, Booking & Follow-ups`,
    });

    const ts = now();
    const passwordHash = await hashPassword(site.data.admin_password);
    const existing = await db.selectFrom("users").select("id").where("email", "=", site.data.admin_email).executeTakeFirst();
    if (existing) {
      await db
        .updateTable("users")
        .set({ name: site.data.admin_name, password_hash: passwordHash, role: "admin", status: "active", updated_at: ts })
        .where("id", "=", existing.id)
        .execute();
    } else {
      await db
        .insertInto("users")
        .values({
          name: site.data.admin_name,
          email: site.data.admin_email,
          password_hash: passwordHash,
          role: "admin",
          status: "active",
          plan_id: null,
          plan_expires_at: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          created_at: ts,
          updated_at: ts,
        })
        .execute();
    }
    markInstalled();
  } catch (e) {
    return { ok: false, message: `Installation failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, message: "Installation complete." };
}
