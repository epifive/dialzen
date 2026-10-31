import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Runtime configuration written by the web installer.
 *
 * Stored in `storage/config.json` so buyers never have to edit files by hand.
 * Every value can be overridden with environment variables (useful for Docker
 * and platforms with a read-only filesystem).
 */

export type DbConfig =
  | {
      driver: "mysql";
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
      /** Use TLS (required by most cloud databases such as TiDB, PlanetScale, Aiven). */
      ssl?: boolean;
    }
  | {
      driver: "sqlite";
      file: string;
    };

export interface AppConfig {
  db: DbConfig;
  installedAt: string;
}

export function storageDir(): string {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.join(process.cwd(), "storage");
}

export function storagePath(...parts: string[]): string {
  return path.join(storageDir(), ...parts);
}

const CONFIG_FILE = () => storagePath("config.json");
const LOCK_FILE = () => storagePath("installed.lock");

const truthy = (value: string | undefined | null) => ["1", "true", "yes", "required"].includes((value ?? "").toLowerCase());

/** Parse mysql://user:password@host:port/database?ssl=true (the format cloud providers hand out). */
function dbFromUrl(url: string): DbConfig | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "mysql:" && u.protocol !== "mariadb:") return null;
    const sslParam = u.searchParams.get("ssl") ?? u.searchParams.get("sslmode") ?? u.searchParams.get("ssl-mode");
    return {
      driver: "mysql",
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "dialzen",
      ssl: sslParam ? truthy(sslParam) || sslParam.toLowerCase().startsWith("verify") : truthy(process.env.DB_SSL),
    };
  } catch {
    return null;
  }
}

function dbFromEnv(): DbConfig | null {
  if (process.env.DATABASE_URL) {
    const fromUrl = dbFromUrl(process.env.DATABASE_URL);
    if (fromUrl) return fromUrl;
  }
  const driver = process.env.DB_DRIVER;
  if (driver === "mysql") {
    return {
      driver: "mysql",
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "dialzen",
      ssl: truthy(process.env.DB_SSL),
    };
  }
  if (driver === "sqlite") {
    return { driver: "sqlite", file: process.env.DB_FILE || "database.sqlite" };
  }
  return null;
}

let cached: AppConfig | null = null;

export function readConfig(): AppConfig | null {
  if (cached) return cached;
  let fileConfig: Partial<AppConfig> = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
  } catch {
    // No config yet: the app is not installed.
  }
  const db = dbFromEnv() ?? fileConfig.db;
  if (!db) return null;
  cached = { db, installedAt: fileConfig.installedAt ?? "" };
  return cached;
}

export function writeConfig(config: AppConfig): void {
  fs.mkdirSync(storageDir(), { recursive: true });
  // Keep keys written by other parts of the app (e.g. the generated appSecret for stored tokens).
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
  } catch {
    // No config yet.
  }
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify({ ...existing, ...config }, null, 2), { mode: 0o600 });
  cached = null;
}

export function isInstalled(): boolean {
  return fs.existsSync(LOCK_FILE()) || process.env.APP_INSTALLED === "true";
}

export function markInstalled(): void {
  fs.writeFileSync(LOCK_FILE(), new Date().toISOString());
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

