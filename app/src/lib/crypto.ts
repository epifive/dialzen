import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import type { Kysely } from "kysely";
import { getDb } from "./db";
import type { Database } from "./db/schema";
import { storagePath } from "./config";

/**
 * Secrets at rest (voice provider keys, tool credentials and carrier logins, see
 * src/lib/providers.ts and src/lib/numbers.ts) and signed values (OAuth state of the connect
 * flows, see src/lib/oauth-state.ts).
 *
 * The app secret comes from, in order:
 *   1. env APP_SECRET (at least 16 characters; set it on read-only hosts such as Vercel)
 *   2. "appSecret" in storage/config.json (generated there on first use, next to the
 *      database settings the installer writes)
 *   3. a "app_secret" row in the settings table, when storage/config.json can't be written
 *      (read-only file systems without APP_SECRET)
 * Changing the secret makes stored secrets unreadable: provider keys, tool credentials and Google
 * connections must then be entered again.
 *
 * Encrypted values: "v1.<iv>.<tag>.<ciphertext>" (base64url), AES-256-GCM with a 96-bit random
 * IV; the key is HKDF-SHA256(app secret, purpose). Tampering makes decryptSecret() throw.
 */

const MIN_SECRET = 16;
let cachedSecret: string | null = null;

function envSecret(): string {
  const value = process.env.APP_SECRET?.trim() ?? "";
  return value.length >= MIN_SECRET ? value : "";
}

function readConfigSecret(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(storagePath("config.json"), "utf8")) as { appSecret?: unknown };
    return typeof parsed.appSecret === "string" && parsed.appSecret.length >= MIN_SECRET ? parsed.appSecret : "";
  } catch {
    return "";
  }
}

/** Adds appSecret to storage/config.json (keeps the other keys). False when the file can't be written. */
function writeConfigSecret(secret: string): boolean {
  try {
    const file = storagePath("config.json");
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      current = {};
    }
    fs.mkdirSync(storagePath(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...current, appSecret: secret }, null, 2), { mode: 0o600 });
    return readConfigSecret() === secret;
  } catch {
    return false;
  }
}

async function dbSecret(create: string | null, conn?: Kysely<Database>): Promise<string> {
  const db = conn ?? (await getDb());
  const row = await db.selectFrom("settings").select("value").where("key", "=", "app_secret").executeTakeFirst();
  if (row?.value && row.value.length >= MIN_SECRET) return row.value;
  if (!create) return "";
  try {
    await db.insertInto("settings").values({ key: "app_secret", value: create }).execute();
    return create;
  } catch {
    const again = await db.selectFrom("settings").select("value").where("key", "=", "app_secret").executeTakeFirst();
    return again?.value ?? create;
  }
}

/**
 * The app secret (see the file comment). Generated once when none exists. `conn` is the
 * connection to use for the settings fallback: pass the transaction when called while the
 * database is being set up (getDb() would wait for that setup to finish).
 */
export async function getAppSecret(conn?: Kysely<Database>): Promise<string> {
  if (cachedSecret) return cachedSecret;
  let secret = envSecret() || readConfigSecret() || (await dbSecret(null, conn));
  if (!secret) {
    const fresh = crypto.randomBytes(32).toString("base64url");
    secret = writeConfigSecret(fresh) ? fresh : await dbSecret(fresh, conn);
  }
  cachedSecret = secret;
  return secret;
}

/** For tests: forget the cached secret. */
export function clearAppSecretCache(): void {
  cachedSecret = null;
}

function deriveKey(secret: string, purpose: string, length = 32): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("dialzen", "utf8"), Buffer.from(purpose, "utf8"), length));
}

/** Pure AES-256-GCM encryption with an explicit secret (exported for tests). */
export function encryptWith(secret: string, plain: string, purpose = "secrets"): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Decrypts encryptWith() output; throws on a wrong secret, a wrong purpose or tampered data. */
export function decryptWith(secret: string, token: string, purpose = "secrets"): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unknown encrypted value format");
  const [, ivText, tagText, dataText] = parts;
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Malformed encrypted value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret, purpose), iv);
  decipher.setAAD(Buffer.from(purpose, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}

export async function encryptSecret(plain: string, purpose = "secrets"): Promise<string> {
  return encryptWith(await getAppSecret(), plain, purpose);
}

export async function decryptSecret(token: string, purpose = "secrets"): Promise<string> {
  return decryptWith(await getAppSecret(), token, purpose);
}

/** HMAC-SHA256 (base64url) of `value` with a key derived from the app secret for `purpose`. */
export async function sign(value: string, purpose: string): Promise<string> {
  return crypto.createHmac("sha256", deriveKey(await getAppSecret(), `sign:${purpose}`)).update(value).digest("base64url");
}

/** Constant-time check of a sign() result. */
export async function verifySignature(value: string, signature: string, purpose: string): Promise<boolean> {
  const expected = Buffer.from(await sign(value, purpose));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
