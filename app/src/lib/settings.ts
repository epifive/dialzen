import "server-only";
import { getDb } from "./db";

/**
 * Every configurable option with its default value. Values are stored as
 * strings in the `settings` table; the type of the default decides how the
 * stored value is parsed.
 */
export const SETTING_DEFAULTS = {
  // General
  site_name: "Dialzen",
  site_tagline: "AI phone agents for support, bookings and follow-ups",
  site_url: "",
  site_email: "support@example.com",
  logo: "",
  logo_dark: "",
  favicon: "",
  footer_text: "AI voice agents that answer calls, book appointments and follow up, with consent and compliance tools built in.",
  copyright_text: "© {year} {site_name}. All rights reserved.",

  // Appearance
  primary_color: "#a21caf",
  default_theme: "system",
  home_hero_title: "AI phone agents that answer, book and follow up.",
  home_hero_subtitle:
    "Build a voice agent in minutes, give it your knowledge base and calendar, and let it handle inbound calls, bookings and consented follow-ups, with AI disclosure, consent records and do-not-call checks built in.",
  show_stats_on_home: true,

  // SEO
  meta_title: "Dialzen — AI Voice Agents for Support, Booking & Follow-ups",
  meta_description:
    "Create AI phone agents that answer inbound calls, book appointments and make consented follow-up calls, with call logs, transcripts, analytics and a built-in compliance toolkit.",
  og_image: "",
  google_site_verification: "",
  bing_site_verification: "",
  robots_extra: "",
  title_separator: " | ",

  // Scheduler and branding
  branding_text: "Powered by Dialzen",
  branding_url: "",
  /** Run background jobs (campaigns, call reconciliation, retention) on page views when no cron job ran for a minute. */
  lazy_scheduler: true,

  // AI assistant (Admin → Settings → AI)
  /** "none", "openai" (any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter, Ollama…) or "anthropic". */
  ai_provider: "none",
  ai_base_url: "https://api.openai.com/v1",
  ai_api_key: "",
  ai_model: "",
  ai_anthropic_key: "",
  ai_anthropic_model: "claude-opus-5-5",
  ai_max_tokens: 1024,
  /** Requests per member per minute (on top of the plan's monthly cap). */
  ai_rate_per_minute: 10,

  // Media storage (Admin → Settings → Media storage). Env S3_* / BLOB_READ_WRITE_TOKEN override these.
  /** "local" (storage/uploads on this server), "s3" (S3, R2, MinIO, Wasabi…) or "blob" (Vercel Blob). */
  storage_driver: "local",
  /** S3 API endpoint, e.g. https://<account>.r2.cloudflarestorage.com ("" = AWS S3 for the region). */
  s3_endpoint: "",
  s3_region: "us-east-1",
  s3_bucket: "",
  s3_access_key: "",
  s3_secret_key: "",
  /** Public base URL of the bucket (custom domain / r2.dev / CDN), "" = the endpoint URL. */
  s3_public_url: "",
  /** Path-style URLs (endpoint/bucket/key): needed for MinIO and most self-hosted S3. */
  s3_path_style: false,
  /** Vercel Blob read-write token (BLOB_READ_WRITE_TOKEN). */
  blob_token: "",
  /** Largest image (logos) and document / audio file (knowledge base) a user may upload, in MB. */
  media_max_image_mb: 10,
  media_max_file_mb: 25,
  /** Media library size per workspace owner, in MB (0 = unlimited). */
  media_quota_mb: 0,

  // Voice providers (Admin → Voice providers): the operator's master keys. Workspaces on plans
  // with allow_byo_keys can add their own keys (provider_accounts).
  /** Provider of new agents: "elevenlabs", "retell" or "simulated". */
  voice_default_provider: "simulated",
  elevenlabs_api_key: "",
  /** HMAC secret of the ElevenLabs post-call webhook (one per ElevenLabs workspace). */
  elevenlabs_webhook_secret: "",
  /** Retell signs webhooks with the API key itself. */
  retell_api_key: "",
  /** The Simulated provider may be used outside demo mode (testing only; DEMO_MODE forces it on). */
  voice_simulated: false,
  /** Sell price per call minute, in the site currency, per provider (what workspaces pay from their wallet). */
  voice_price_elevenlabs: 0.15,
  voice_price_retell: 0.14,
  voice_price_simulated: 0.1,
  /** Platform fee per minute for workspaces using their own provider keys (0 = free). */
  voice_price_byo: 0.02,
  /** "per_second", "per_6s" or "per_minute" (per started minute). */
  billing_rounding: "per_6s",
  /** Every answered call is billed at least this many seconds (0 = none). */
  billing_min_seconds: 0,
  /** Monthly rental charged for a phone number, in the site currency (0 = none). */
  number_monthly_price: 3,
  /** Calls in progress at once across the whole platform (the providers' concurrency; 0 = no cap). */
  voice_global_concurrency: 20,
  /** Emergency stop: no outbound calls from any workspace. */
  outbound_kill_switch: false,
  /** Outbound calls need the admin's approval of each workspace (KYC form + acceptable use). */
  outbound_requires_approval: true,
  /** Default low-balance alert of new wallets, in the site currency. */
  wallet_low_balance: 5,
  /** Credit packs offered to workspaces (amounts in the site currency, comma-separated). */
  credit_packs: "10,25,50,100",
  /** Copy call recordings from the provider into media storage (recordings/ prefix) after each call. */
  voice_copy_recordings: true,
  /** Nightly comparison of call durations and costs with the providers' records (last 48 hours). */
  voice_reconcile: true,

  // Google (Calendar and Sheets tools): the operator's OAuth client.
  google_client_id: "",
  google_client_secret: "",

  // Custom code
  custom_head_code: "",
  custom_body_code: "",

  // Cookie consent
  cookie_consent_enabled: true,
  cookie_consent_text:
    "We use cookies to keep you signed in and to understand how the site is used. By continuing you agree to our use of cookies.",

  // Language
  default_language: "en",

  // Blog
  blog_enabled: true,

  // Users
  registration_enabled: true,

  // Payments
  currency: "USD",
  stripe_enabled: false,
  stripe_secret_key: "",
  stripe_webhook_secret: "",
  paypal_enabled: false,
  paypal_mode: "sandbox",
  paypal_client_id: "",
  paypal_secret: "",
  razorpay_enabled: false,
  razorpay_key_id: "",
  razorpay_key_secret: "",
  offline_enabled: false,
  offline_instructions:
    "Transfer the amount to the bank account below and enter the transaction reference.\n\nBank: Example Bank\nAccount name: Your Company\nAccount number: 0000000000",

  // Email
  mail_enabled: false,
  smtp_host: "",
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: "",
  smtp_pass: "",
  mail_from_name: "Dialzen",
  mail_from_address: "no-reply@example.com",

  // Contact
  contact_enabled: true,

  // Maintenance
  maintenance_mode: false,
  maintenance_message: "We are performing scheduled maintenance. Please check back soon.",
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

/** Settings that must never be sent to the browser. */
export const SECRET_SETTINGS: SettingKey[] = [
  "stripe_secret_key",
  "stripe_webhook_secret",
  "paypal_secret",
  "razorpay_key_secret",
  "smtp_pass",
  "ai_api_key",
  "ai_anthropic_key",
  "s3_secret_key",
  "blob_token",
  "elevenlabs_api_key",
  "elevenlabs_webhook_secret",
  "retell_api_key",
  "google_client_secret",
];

const globalForSettings = globalThis as unknown as { __dialzenSettings?: Settings };

function parse<K extends SettingKey>(key: K, raw: string | null): Settings[K] {
  const fallback = SETTING_DEFAULTS[key];
  if (raw === null || raw === undefined) return fallback;
  if (typeof fallback === "boolean") return (raw === "1" || raw === "true") as Settings[K];
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as Settings[K];
  }
  return raw as Settings[K];
}

export async function getSettings(): Promise<Settings> {
  if (globalForSettings.__dialzenSettings) return globalForSettings.__dialzenSettings;
  const db = await getDb();
  const rows = await db.selectFrom("settings").selectAll().execute();
  const settings: Settings = { ...SETTING_DEFAULTS };
  const record = settings as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in SETTING_DEFAULTS) {
      record[row.key] = parse(row.key as SettingKey, row.value);
    }
  }
  globalForSettings.__dialzenSettings = settings;
  return settings;
}

function serialize(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value ?? "");
}

export async function updateSettings(values: Partial<Settings>): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in SETTING_DEFAULTS)) continue;
      const serialized = serialize(value);
      const updated = await trx
        .updateTable("settings")
        .set({ value: serialized })
        .where("key", "=", key)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 0) {
        // MySQL reports 0 changed rows when the value is unchanged, so check existence.
        const exists = await trx
          .selectFrom("settings")
          .select("key")
          .where("key", "=", key)
          .executeTakeFirst();
        if (!exists) await trx.insertInto("settings").values({ key, value: serialized }).execute();
      }
    }
  });
  clearSettingsCache();
}

export function clearSettingsCache(): void {
  globalForSettings.__dialzenSettings = undefined;
}

/** Replace `{site_name}`, `{site_email}` and `{year}` placeholders. */
export function fillPlaceholders(text: string, settings: Settings): string {
  return text
    .replaceAll("{site_name}", settings.site_name)
    .replaceAll("{site_email}", settings.site_email)
    .replaceAll("{year}", String(new Date().getFullYear()));
}
