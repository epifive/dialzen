import "server-only";
import { sql, type Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import { DEFAULT_PAGES } from "./seed-pages";
import { DEFAULT_POSTS } from "./seed-posts";

/**
 * Versioned schema migrations. They run automatically on first database
 * access after an update, so buyers only need to replace files and restart.
 * Never edit a released migration: add a new one instead.
 *
 * Portable Kysely only (SQLite + MySQL/MariaDB/TiDB): ISO date strings, JSON as text,
 * integers for booleans, bigint for micros, varchar lengths that fit utf8mb4 index limits.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = Kysely<any>;

const ts = () => new Date().toISOString();

/** Tables of the initial schema, dropped in reverse order by down(). */
const TABLES = [
  "settings",
  "users",
  "sessions",
  "password_resets",
  "plans",
  "payments",
  "pages",
  "contact_messages",
  "languages",
  "translations",
  "blog_posts",
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "media_folders",
  "media",
  "provider_accounts",
  "agents",
  "kb_items",
  "tools",
  "agent_tools",
  "phone_numbers",
  "contacts",
  "contact_lists",
  "list_members",
  "consents",
  "dnc_entries",
  "campaigns",
  "campaign_contacts",
  "calls",
  "webhook_events",
  "wallets",
  "credit_transactions",
  "audit_log",
  "compliance_settings",
  "kyc_requests",
  "api_keys",
  "usage_monthly",
  "notify_channels",
  "alert_log",
];

const migrations: Record<string, Migration> = {
  "2026_10_21_000001_initial_schema": {
    async up(db: AnyDb) {
      // ── Platform: settings, accounts, billing, content ──
      await db.schema
        .createTable("settings")
        .addColumn("key", "varchar(100)", (c) => c.primaryKey())
        .addColumn("value", "text")
        .execute();

      await db.schema
        .createTable("users")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull().unique())
        .addColumn("password_hash", "varchar(255)", (c) => c.notNull())
        .addColumn("role", "varchar(20)", (c) => c.notNull().defaultTo("user"))
        .addColumn("status", "varchar(20)", (c) => c.notNull().defaultTo("active"))
        .addColumn("plan_id", "integer")
        .addColumn("plan_expires_at", "varchar(32)")
        .addColumn("stripe_customer_id", "varchar(100)")
        .addColumn("stripe_subscription_id", "varchar(100)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("sessions")
        .addColumn("id", "varchar(64)", (c) => c.primaryKey())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("user_agent", "varchar(255)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("sessions_user_id_idx").on("sessions").column("user_id").execute();

      await db.schema
        .createTable("password_resets")
        .addColumn("token_hash", "varchar(64)", (c) => c.primaryKey())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      // Limits: -1 = unlimited, 0 = none (see src/lib/plans.ts).
      await db.schema
        .createTable("plans")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(100)", (c) => c.notNull())
        .addColumn("description", "varchar(255)")
        .addColumn("price_monthly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("price_yearly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("features", "text")
        .addColumn("max_agents", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("max_numbers", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("max_concurrent_calls", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("included_minutes_monthly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("max_members", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("max_ai_monthly", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_outbound", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_campaigns", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_byo_keys", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_api", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("allow_white_label", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("remove_branding", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("is_free", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("is_featured", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("payments")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("plan_id", "integer", (c) => c.notNull())
        .addColumn("purpose", "varchar(10)", (c) => c.notNull().defaultTo("plan"))
        .addColumn("workspace_id", "integer")
        .addColumn("credits_micros", "bigint")
        .addColumn("amount", "integer", (c) => c.notNull())
        .addColumn("currency", "varchar(10)", (c) => c.notNull())
        .addColumn("billing_cycle", "varchar(10)", (c) => c.notNull())
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("provider_ref", "varchar(190)", (c) => c.notNull().unique())
        .addColumn("status", "varchar(20)", (c) => c.notNull())
        .addColumn("note", "text")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("payments_user_id_idx").on("payments").column("user_id").execute();

      await db.schema
        .createTable("pages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("slug", "varchar(120)", (c) => c.notNull().unique())
        .addColumn("title", "varchar(255)", (c) => c.notNull())
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("meta_description", "varchar(255)")
        .addColumn("is_published", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("show_in_footer", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("contact_messages")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull())
        .addColumn("subject", "varchar(255)", (c) => c.notNull())
        .addColumn("message", "text", (c) => c.notNull())
        .addColumn("ip", "varchar(64)")
        .addColumn("is_read", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("languages")
        .addColumn("code", "varchar(12)", (c) => c.primaryKey())
        .addColumn("name", "varchar(60)", (c) => c.notNull())
        .addColumn("native_name", "varchar(60)", (c) => c.notNull())
        .addColumn("direction", "varchar(3)", (c) => c.notNull().defaultTo("ltr"))
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("sort_order", "integer", (c) => c.notNull().defaultTo(0))
        .execute();

      await db.schema
        .createTable("translations")
        .addColumn("lang", "varchar(12)", (c) => c.notNull())
        .addColumn("key", "varchar(190)", (c) => c.notNull())
        .addColumn("value", "text", (c) => c.notNull())
        .addPrimaryKeyConstraint("translations_pk", ["lang", "key"])
        .execute();

      await db.schema
        .createTable("blog_posts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("slug", "varchar(160)", (c) => c.notNull().unique())
        .addColumn("title", "varchar(255)", (c) => c.notNull())
        .addColumn("excerpt", "varchar(500)")
        .addColumn("content", "text", (c) => c.notNull())
        .addColumn("cover_image", "varchar(500)")
        .addColumn("meta_description", "varchar(255)")
        .addColumn("status", "varchar(12)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("published_at", "varchar(32)")
        .addColumn("views", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("blog_posts_status_published_idx").on("blog_posts").columns(["status", "published_at"]).execute();

      // ── Workspaces and team ──
      await db.schema
        .createTable("workspaces")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("owner_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("timezone", "varchar(64)", (c) => c.notNull().defaultTo("UTC"))
        .addColumn("settings", "text", (c) => c.notNull())
        .addColumn("is_personal", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("workspaces_owner_idx").on("workspaces").columns(["owner_id", "is_personal"]).execute();

      await db.schema
        .createTable("workspace_members")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("role", "varchar(12)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("workspace_members_ws_user_uq", ["workspace_id", "user_id"])
        .execute();
      await db.schema.createIndex("workspace_members_user_idx").on("workspace_members").column("user_id").execute();

      await db.schema
        .createTable("workspace_invites")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("email", "varchar(190)", (c) => c.notNull())
        .addColumn("role", "varchar(12)", (c) => c.notNull())
        .addColumn("token_hash", "varchar(64)", (c) => c.notNull().unique())
        .addColumn("invited_by", "integer", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("workspace_invites_ws_email_uq", ["workspace_id", "email"])
        .execute();

      // ── Media library (knowledge-base files, logos) ──
      await db.schema
        .createTable("media_folders")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("parent_id", "integer")
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("media_folders_ws_idx").on("media_folders").columns(["workspace_id", "parent_id"]).execute();

      await db.schema
        .createTable("media")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("folder_id", "integer")
        .addColumn("uploaded_by", "integer")
        .addColumn("storage", "varchar(10)", (c) => c.notNull())
        .addColumn("storage_key", "varchar(500)", (c) => c.notNull())
        .addColumn("url", "varchar(1000)", (c) => c.notNull())
        .addColumn("filename", "varchar(255)", (c) => c.notNull())
        .addColumn("mime", "varchar(100)", (c) => c.notNull())
        .addColumn("kind", "varchar(10)", (c) => c.notNull())
        .addColumn("size", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("width", "integer")
        .addColumn("height", "integer")
        .addColumn("duration", "double precision")
        .addColumn("alt_text", "varchar(1500)", (c) => c.notNull().defaultTo(""))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("media_ws_folder_idx").on("media").columns(["workspace_id", "folder_id", "created_at"]).execute();

      // ── Voice providers (tenant BYO keys; platform keys live in settings) ──
      await db.schema
        .createTable("provider_accounts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("label", "varchar(120)", (c) => c.notNull().defaultTo(""))
        .addColumn("credentials", "text", (c) => c.notNull())
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("active"))
        .addColumn("last_checked_at", "varchar(32)")
        .addColumn("last_error", "varchar(1000)")
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("provider_accounts_ws_provider_uq", ["workspace_id", "provider"])
        .execute();

      // ── Agents, knowledge base, tools ──
      await db.schema
        .createTable("agents")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("template", "varchar(40)", (c) => c.notNull().defaultTo(""))
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("provider_agent_id", "varchar(190)")
        .addColumn("provider_meta", "text", (c) => c.notNull())
        .addColumn("sync_status", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("sync_error", "varchar(1000)")
        .addColumn("synced_at", "varchar(32)")
        .addColumn("language", "varchar(16)", (c) => c.notNull().defaultTo("en-US"))
        .addColumn("voice_id", "varchar(190)", (c) => c.notNull().defaultTo(""))
        .addColumn("voice_name", "varchar(190)", (c) => c.notNull().defaultTo(""))
        .addColumn("first_message", "text", (c) => c.notNull())
        .addColumn("system_prompt", "text", (c) => c.notNull())
        .addColumn("llm", "varchar(80)", (c) => c.notNull().defaultTo(""))
        .addColumn("settings", "text", (c) => c.notNull())
        .addColumn("tool_secret", "varchar(64)", (c) => c.notNull())
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("agents_ws_idx").on("agents").columns(["workspace_id", "created_at"]).execute();
      // Webhook routing and sync: WHERE provider = ? AND provider_agent_id = ?.
      await db.schema.createIndex("agents_provider_ref_idx").on("agents").columns(["provider", "provider_agent_id"]).execute();

      await db.schema
        .createTable("kb_items")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("agent_id", "integer")
        .addColumn("kind", "varchar(8)", (c) => c.notNull())
        .addColumn("name", "varchar(255)", (c) => c.notNull())
        .addColumn("url", "varchar(1000)")
        .addColumn("media_id", "integer")
        .addColumn("content", "text")
        .addColumn("size_bytes", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("provider", "varchar(20)")
        .addColumn("provider_doc_id", "varchar(190)")
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("error", "varchar(1000)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("kb_items_ws_agent_idx").on("kb_items").columns(["workspace_id", "agent_id"]).execute();
      await db.schema.createIndex("kb_items_media_idx").on("kb_items").column("media_id").execute();

      await db.schema
        .createTable("tools")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("kind", "varchar(20)", (c) => c.notNull())
        .addColumn("name", "varchar(60)", (c) => c.notNull())
        .addColumn("description", "varchar(1000)", (c) => c.notNull().defaultTo(""))
        .addColumn("config", "text", (c) => c.notNull())
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("active"))
        .addColumn("last_error", "varchar(1000)")
        .addColumn("last_used_at", "varchar(32)")
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("tools_ws_idx").on("tools").column("workspace_id").execute();

      await db.schema
        .createTable("agent_tools")
        .addColumn("agent_id", "integer", (c) => c.notNull())
        .addColumn("tool_id", "integer", (c) => c.notNull())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addPrimaryKeyConstraint("agent_tools_pk", ["agent_id", "tool_id"])
        .execute();
      await db.schema.createIndex("agent_tools_tool_idx").on("agent_tools").column("tool_id").execute();

      // ── Phone numbers ──
      await db.schema
        .createTable("phone_numbers")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("e164", "varchar(20)", (c) => c.notNull())
        .addColumn("country", "varchar(2)", (c) => c.notNull().defaultTo(""))
        .addColumn("label", "varchar(120)", (c) => c.notNull().defaultTo(""))
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("carrier", "varchar(20)", (c) => c.notNull())
        .addColumn("provider_number_id", "varchar(190)")
        .addColumn("credentials", "text", (c) => c.notNull())
        .addColumn("inbound_agent_id", "integer")
        .addColumn("outbound_agent_id", "integer")
        .addColumn("outbound_enabled", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("kyc_status", "varchar(14)", (c) => c.notNull().defaultTo("not_required"))
        .addColumn("daily_dial_cap", "integer", (c) => c.notNull().defaultTo(100))
        .addColumn("monthly_price_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("last_error", "varchar(1000)")
        .addColumn("released_at", "varchar(32)")
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("phone_numbers_ws_e164_uq", ["workspace_id", "e164"])
        .execute();
      // Inbound routing by the dialed number, and webhook routing by the provider's number id.
      await db.schema.createIndex("phone_numbers_e164_idx").on("phone_numbers").columns(["e164", "status"]).execute();
      await db.schema.createIndex("phone_numbers_provider_ref_idx").on("phone_numbers").columns(["provider", "provider_number_id"]).execute();

      // ── Contacts, lists, consent, DNC ──
      await db.schema
        .createTable("contacts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("phone_e164", "varchar(20)", (c) => c.notNull())
        .addColumn("first_name", "varchar(120)", (c) => c.notNull().defaultTo(""))
        .addColumn("last_name", "varchar(120)", (c) => c.notNull().defaultTo(""))
        .addColumn("email", "varchar(190)", (c) => c.notNull().defaultTo(""))
        .addColumn("company", "varchar(190)", (c) => c.notNull().defaultTo(""))
        .addColumn("country", "varchar(2)", (c) => c.notNull().defaultTo(""))
        .addColumn("timezone", "varchar(64)", (c) => c.notNull().defaultTo(""))
        .addColumn("state", "varchar(8)", (c) => c.notNull().defaultTo(""))
        .addColumn("language", "varchar(16)", (c) => c.notNull().defaultTo(""))
        .addColumn("fields", "text", (c) => c.notNull())
        .addColumn("tags", "text", (c) => c.notNull())
        .addColumn("source", "varchar(10)", (c) => c.notNull().defaultTo("manual"))
        .addColumn("opted_out_at", "varchar(32)")
        .addColumn("last_called_at", "varchar(32)")
        .addColumn("calls_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("contacts_ws_phone_uq", ["workspace_id", "phone_e164"])
        .execute();
      await db.schema.createIndex("contacts_ws_created_idx").on("contacts").columns(["workspace_id", "created_at"]).execute();

      await db.schema
        .createTable("contact_lists")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("description", "varchar(500)", (c) => c.notNull().defaultTo(""))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("contact_lists_ws_idx").on("contact_lists").column("workspace_id").execute();

      await db.schema
        .createTable("list_members")
        .addColumn("list_id", "integer", (c) => c.notNull())
        .addColumn("contact_id", "integer", (c) => c.notNull())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("added_at", "varchar(32)", (c) => c.notNull())
        .addPrimaryKeyConstraint("list_members_pk", ["list_id", "contact_id"])
        .execute();
      await db.schema.createIndex("list_members_contact_idx").on("list_members").column("contact_id").execute();

      await db.schema
        .createTable("consents")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("contact_id", "integer", (c) => c.notNull())
        .addColumn("phone_e164", "varchar(20)", (c) => c.notNull())
        .addColumn("type", "varchar(12)", (c) => c.notNull())
        .addColumn("purpose", "varchar(16)", (c) => c.notNull().defaultTo("any"))
        .addColumn("source", "varchar(16)", (c) => c.notNull())
        .addColumn("source_url", "varchar(1000)", (c) => c.notNull().defaultTo(""))
        .addColumn("captured_at", "varchar(32)", (c) => c.notNull())
        .addColumn("ip", "varchar(64)", (c) => c.notNull().defaultTo(""))
        .addColumn("user_agent", "varchar(255)", (c) => c.notNull().defaultTo(""))
        .addColumn("text_snapshot", "text", (c) => c.notNull())
        .addColumn("expires_at", "varchar(32)")
        .addColumn("revoked_at", "varchar(32)")
        .addColumn("revoked_reason", "varchar(255)")
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("consents_ws_contact_idx").on("consents").columns(["workspace_id", "contact_id"]).execute();
      await db.schema.createIndex("consents_ws_phone_idx").on("consents").columns(["workspace_id", "phone_e164"]).execute();

      // workspace_id 0 = global (operator) entries, so the unique key also works for them.
      await db.schema
        .createTable("dnc_entries")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("scope", "varchar(10)", (c) => c.notNull())
        .addColumn("workspace_id", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("phone_e164", "varchar(20)", (c) => c.notNull())
        .addColumn("reason", "varchar(16)", (c) => c.notNull())
        .addColumn("source", "varchar(60)", (c) => c.notNull().defaultTo(""))
        .addColumn("list_ref", "varchar(120)", (c) => c.notNull().defaultTo(""))
        .addColumn("note", "varchar(500)", (c) => c.notNull().defaultTo(""))
        .addColumn("expires_at", "varchar(32)")
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("dnc_entries_scope_ws_phone_uq", ["scope", "workspace_id", "phone_e164"])
        .execute();
      // Dial-time scrub: WHERE phone_e164 = ? (both scopes at once).
      await db.schema.createIndex("dnc_entries_phone_idx").on("dnc_entries").column("phone_e164").execute();

      // ── Campaigns ──
      await db.schema
        .createTable("campaigns")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("agent_id", "integer", (c) => c.notNull())
        .addColumn("number_id", "integer", (c) => c.notNull())
        .addColumn("list_id", "integer")
        .addColumn("purpose", "varchar(16)", (c) => c.notNull().defaultTo("informational"))
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("draft"))
        .addColumn("starts_at", "varchar(32)")
        .addColumn("ends_at", "varchar(32)")
        .addColumn("calling_window", "text", (c) => c.notNull())
        .addColumn("timezone_mode", "varchar(10)", (c) => c.notNull().defaultTo("contact"))
        .addColumn("timezone", "varchar(64)", (c) => c.notNull().defaultTo("UTC"))
        .addColumn("max_attempts", "integer", (c) => c.notNull().defaultTo(3))
        .addColumn("retry_delay_min", "integer", (c) => c.notNull().defaultTo(240))
        .addColumn("retry_on", "text", (c) => c.notNull())
        .addColumn("concurrency", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("daily_cap", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("variables", "text", (c) => c.notNull())
        .addColumn("stats", "text", (c) => c.notNull())
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addColumn("completed_at", "varchar(32)")
        .execute();
      await db.schema.createIndex("campaigns_ws_status_idx").on("campaigns").columns(["workspace_id", "status"]).execute();
      // The engine: WHERE status = 'running'.
      await db.schema.createIndex("campaigns_status_idx").on("campaigns").columns(["status", "starts_at"]).execute();

      await db.schema
        .createTable("campaign_contacts")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("campaign_id", "integer", (c) => c.notNull())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("contact_id", "integer", (c) => c.notNull())
        .addColumn("phone_e164", "varchar(20)", (c) => c.notNull())
        .addColumn("state", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("next_attempt_at", "varchar(32)")
        .addColumn("lease_token", "varchar(64)")
        .addColumn("lease_until", "varchar(32)")
        .addColumn("last_call_id", "integer")
        .addColumn("last_outcome", "varchar(20)")
        .addColumn("skip_reason", "varchar(255)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("campaign_contacts_campaign_contact_uq", ["campaign_id", "contact_id"])
        .execute();
      // The engine: WHERE campaign_id = ? AND state IN ('pending','retry') AND next_attempt_at <= now.
      await db.schema.createIndex("campaign_contacts_due_idx").on("campaign_contacts").columns(["campaign_id", "state", "next_attempt_at"]).execute();
      // Expired leases of in-flight rows: WHERE state = 'dialing' AND lease_until < now.
      await db.schema.createIndex("campaign_contacts_lease_idx").on("campaign_contacts").columns(["state", "lease_until"]).execute();

      // ── Calls ──
      await db.schema
        .createTable("calls")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("agent_id", "integer")
        .addColumn("campaign_id", "integer")
        .addColumn("campaign_contact_id", "integer")
        .addColumn("contact_id", "integer")
        .addColumn("number_id", "integer")
        .addColumn("direction", "varchar(10)", (c) => c.notNull())
        .addColumn("from_e164", "varchar(20)", (c) => c.notNull().defaultTo(""))
        .addColumn("to_e164", "varchar(20)", (c) => c.notNull().defaultTo(""))
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("provider_call_id", "varchar(190)")
        .addColumn("key_source", "varchar(10)", (c) => c.notNull().defaultTo("platform"))
        .addColumn("status", "varchar(12)", (c) => c.notNull().defaultTo("queued"))
        .addColumn("end_reason", "varchar(20)")
        .addColumn("queued_at", "varchar(32)", (c) => c.notNull())
        .addColumn("started_at", "varchar(32)")
        .addColumn("ended_at", "varchar(32)")
        .addColumn("duration_sec", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("billed_seconds", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("included_seconds", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("price_per_min_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("credits_reserved_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("credits_settled_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("provider_cost_micros", "bigint")
        .addColumn("recording_storage", "varchar(10)")
        .addColumn("recording_key", "varchar(500)")
        .addColumn("recording_url", "varchar(2000)")
        .addColumn("recording_deleted_at", "varchar(32)")
        .addColumn("transcript", "text")
        .addColumn("summary", "text")
        .addColumn("sentiment", "varchar(10)", (c) => c.notNull().defaultTo("unknown"))
        .addColumn("outcome", "varchar(30)")
        .addColumn("extracted", "text")
        .addColumn("disclosure_played", "integer")
        .addColumn("tool_calls", "text")
        .addColumn("latency_ms", "integer")
        .addColumn("metadata", "text", (c) => c.notNull())
        .addColumn("error", "varchar(1000)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("calls_provider_call_uq", ["provider", "provider_call_id"])
        .execute();
      // Call log and analytics: WHERE workspace_id = ? ORDER BY created_at.
      await db.schema.createIndex("calls_ws_created_idx").on("calls").columns(["workspace_id", "created_at"]).execute();
      await db.schema.createIndex("calls_agent_idx").on("calls").columns(["agent_id", "created_at"]).execute();
      await db.schema.createIndex("calls_campaign_idx").on("calls").columns(["campaign_id", "created_at"]).execute();
      // Per-number daily dial caps.
      await db.schema.createIndex("calls_number_idx").on("calls").columns(["number_id", "created_at"]).execute();
      await db.schema.createIndex("calls_contact_idx").on("calls").columns(["contact_id", "created_at"]).execute();
      // Frequency caps: calls to a number in the last 24 h / 30 days.
      await db.schema.createIndex("calls_ws_to_idx").on("calls").columns(["workspace_id", "to_e164", "created_at"]).execute();
      // Concurrency caps and stuck-call reconciliation: WHERE status IN ('queued','ringing','in_progress').
      await db.schema.createIndex("calls_status_idx").on("calls").columns(["status", "updated_at"]).execute();

      await db.schema
        .createTable("webhook_events")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("provider", "varchar(20)", (c) => c.notNull())
        .addColumn("event_id", "varchar(190)", (c) => c.notNull())
        .addColumn("received_at", "varchar(32)", (c) => c.notNull())
        .addColumn("payload_hash", "varchar(64)", (c) => c.notNull())
        .addColumn("call_id", "integer")
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("processed"))
        .addColumn("error", "varchar(1000)")
        .addUniqueConstraint("webhook_events_provider_event_uq", ["provider", "event_id"])
        .execute();
      await db.schema.createIndex("webhook_events_received_idx").on("webhook_events").column("received_at").execute();

      // ── Credits ──
      await db.schema
        .createTable("wallets")
        .addColumn("workspace_id", "integer", (c) => c.primaryKey())
        .addColumn("balance_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("reserved_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("auto_recharge", "text", (c) => c.notNull())
        .addColumn("low_balance_micros", "bigint", (c) => c.notNull().defaultTo(0))
        .addColumn("low_balance_notified_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();

      await db.schema
        .createTable("credit_transactions")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("kind", "varchar(12)", (c) => c.notNull())
        .addColumn("amount_micros", "bigint", (c) => c.notNull())
        .addColumn("balance_after", "bigint", (c) => c.notNull())
        .addColumn("call_id", "integer")
        .addColumn("payment_id", "integer")
        .addColumn("seconds", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("note", "varchar(255)", (c) => c.notNull().defaultTo(""))
        .addColumn("created_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        // A call is reserved, settled, released and counted against included minutes at most once each.
        .addUniqueConstraint("credit_transactions_call_kind_uq", ["call_id", "kind"])
        .execute();
      await db.schema.createIndex("credit_transactions_ws_idx").on("credit_transactions").columns(["workspace_id", "created_at"]).execute();
      await db.schema.createIndex("credit_transactions_payment_idx").on("credit_transactions").column("payment_id").execute();

      // ── Compliance ──
      await db.schema
        .createTable("audit_log")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer")
        .addColumn("actor_type", "varchar(10)", (c) => c.notNull())
        .addColumn("actor_id", "integer")
        .addColumn("action", "varchar(60)", (c) => c.notNull())
        .addColumn("entity_type", "varchar(30)", (c) => c.notNull().defaultTo(""))
        .addColumn("entity_id", "varchar(64)", (c) => c.notNull().defaultTo(""))
        .addColumn("data", "text", (c) => c.notNull())
        .addColumn("ip", "varchar(64)", (c) => c.notNull().defaultTo(""))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("audit_log_ws_created_idx").on("audit_log").columns(["workspace_id", "created_at"]).execute();
      await db.schema.createIndex("audit_log_entity_idx").on("audit_log").columns(["entity_type", "entity_id"]).execute();

      await db.schema
        .createTable("compliance_settings")
        .addColumn("workspace_id", "integer", (c) => c.primaryKey())
        .addColumn("settings", "text", (c) => c.notNull())
        .addColumn("outbound_state", "varchar(14)", (c) => c.notNull().defaultTo("not_requested"))
        .addColumn("aup_accepted_at", "varchar(32)")
        .addColumn("aup_accepted_by", "integer")
        .addColumn("kill_switch", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("kill_reason", "varchar(500)")
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("compliance_settings_outbound_idx").on("compliance_settings").column("outbound_state").execute();

      await db.schema
        .createTable("kyc_requests")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("business_name", "varchar(190)", (c) => c.notNull())
        .addColumn("address", "varchar(500)", (c) => c.notNull())
        .addColumn("website", "varchar(500)", (c) => c.notNull().defaultTo(""))
        .addColumn("country", "varchar(2)", (c) => c.notNull().defaultTo(""))
        .addColumn("use_case", "text", (c) => c.notNull())
        .addColumn("consent_method", "text", (c) => c.notNull())
        .addColumn("expected_volume", "varchar(120)", (c) => c.notNull().defaultTo(""))
        .addColumn("status", "varchar(10)", (c) => c.notNull().defaultTo("pending"))
        .addColumn("review_note", "varchar(1000)")
        .addColumn("reviewed_by", "integer")
        .addColumn("reviewed_at", "varchar(32)")
        .addColumn("submitted_by", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("kyc_requests_status_idx").on("kyc_requests").columns(["status", "created_at"]).execute();
      await db.schema.createIndex("kyc_requests_ws_idx").on("kyc_requests").column("workspace_id").execute();

      // ── Account level: API keys, usage, notifications ──
      await db.schema
        .createTable("api_keys")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("key_hash", "varchar(64)", (c) => c.notNull().unique())
        .addColumn("prefix", "varchar(12)", (c) => c.notNull())
        .addColumn("last_used_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("api_keys_ws_idx").on("api_keys").column("workspace_id").execute();

      await db.schema
        .createTable("usage_monthly")
        .addColumn("user_id", "integer", (c) => c.notNull())
        .addColumn("month", "varchar(7)", (c) => c.notNull())
        .addColumn("seconds_used", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("calls", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("ai_requests", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("quota_alerts", "varchar(255)")
        .addPrimaryKeyConstraint("usage_monthly_pk", ["user_id", "month"])
        .execute();

      await db.schema
        .createTable("notify_channels")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("created_by", "integer")
        .addColumn("type", "varchar(12)", (c) => c.notNull())
        .addColumn("name", "varchar(120)", (c) => c.notNull())
        .addColumn("config", "text", (c) => c.notNull())
        .addColumn("events", "text", (c) => c.notNull())
        .addColumn("is_active", "integer", (c) => c.notNull().defaultTo(1))
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addColumn("updated_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("notify_channels_ws_idx").on("notify_channels").column("workspace_id").execute();

      await db.schema
        .createTable("alert_log")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer")
        .addColumn("call_id", "integer")
        .addColumn("notify_channel_id", "integer")
        .addColumn("event", "varchar(30)", (c) => c.notNull())
        .addColumn("ok", "integer", (c) => c.notNull())
        .addColumn("error", "varchar(500)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .execute();
      await db.schema.createIndex("alert_log_ws_idx").on("alert_log").columns(["workspace_id", "created_at"]).execute();
      await db.schema.createIndex("alert_log_created_idx").on("alert_log").column("created_at").execute();
    },
    async down(db: AnyDb) {
      for (const table of [...TABLES].reverse()) await db.schema.dropTable(table).ifExists().execute();
    },
  },

  "2026_10_21_000002_seed_defaults": {
    async up(db: AnyDb) {
      const now = ts();
      // Limits: -1 = unlimited, 0 = none. Feature lines are display text (Admin → Plans): keep them
      // in line with the switches below, and don't repeat the limits the pricing cards show.
      await db
        .insertInto("plans")
        .values([
          {
            name: "Free",
            description: "Build and test an AI phone agent in your browser.",
            price_monthly: 0,
            price_yearly: 0,
            features: ["Browser test calls", "Knowledge base and post-call analysis", "Call logs with transcripts and summaries", "Compliance toolkit"].join("\n"),
            max_agents: 1,
            max_numbers: 0,
            max_concurrent_calls: 1,
            included_minutes_monthly: 10,
            max_members: 1,
            max_ai_monthly: 20,
            allow_outbound: 0,
            allow_campaigns: 0,
            allow_byo_keys: 0,
            allow_api: 0,
            allow_white_label: 0,
            remove_branding: 0,
            is_free: 1,
            is_active: 1,
            is_featured: 0,
            sort_order: 1,
            created_at: now,
          },
          {
            name: "Pro",
            description: "Phone numbers, outbound calls and campaigns for a growing business.",
            price_monthly: 2900,
            price_yearly: 29000,
            features: ["Everything in Free", "Calendar booking, webhook and Google Sheets tools", "Outbound calls and campaigns", "REST API and webhooks"].join("\n"),
            max_agents: 5,
            max_numbers: 3,
            max_concurrent_calls: 5,
            included_minutes_monthly: 100,
            max_members: 3,
            max_ai_monthly: 300,
            allow_outbound: 1,
            allow_campaigns: 1,
            allow_byo_keys: 0,
            allow_api: 1,
            allow_white_label: 0,
            remove_branding: 0,
            is_free: 0,
            is_active: 1,
            is_featured: 1,
            sort_order: 2,
            created_at: now,
          },
          {
            name: "Agency",
            description: "For agencies running voice agents for many clients.",
            price_monthly: 9900,
            price_yearly: 99000,
            features: ["Everything in Pro", "Your own voice provider API keys", "White-label web widget and emails"].join("\n"),
            max_agents: 30,
            max_numbers: 20,
            max_concurrent_calls: 20,
            included_minutes_monthly: 500,
            max_members: 10,
            max_ai_monthly: 2000,
            allow_outbound: 1,
            allow_campaigns: 1,
            allow_byo_keys: 1,
            allow_api: 1,
            allow_white_label: 1,
            remove_branding: 1,
            is_free: 0,
            is_active: 1,
            is_featured: 0,
            sort_order: 3,
            created_at: now,
          },
        ])
        .execute();

      await db
        .insertInto("pages")
        .values(
          DEFAULT_PAGES.map((p) => ({
            slug: p.slug,
            title: p.title,
            content: p.content,
            meta_description: p.metaDescription,
            is_published: 1,
            show_in_footer: 1,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();

      await db.insertInto("languages").values({ code: "en", name: "English", native_name: "English", direction: "ltr", is_active: 1, sort_order: 0 }).execute();
      await db
        .insertInto("blog_posts")
        .values(
          DEFAULT_POSTS.map((p, i) => ({
            slug: p.slug,
            title: p.title,
            excerpt: p.excerpt,
            content: p.content,
            cover_image: null,
            meta_description: p.metaDescription,
            status: "published",
            published_at: new Date(Date.now() - (DEFAULT_POSTS.length - i) * 86_400_000).toISOString(),
            views: 0,
            created_at: now,
            updated_at: now,
          })),
        )
        .execute();
    },
    async down(db: AnyDb) {
      for (const table of ["blog_posts", "languages", "pages", "plans"]) await sql`DELETE FROM ${sql.table(table)}`.execute(db);
    },
  },

  // Campaign engine, compliance center and billing (agent C): number pools and several lists per
  // campaign, retry delays per outcome, the abandonment guard, the tenant's own outbound stop, the
  // KYC sample script and the auto-recharge throttle.
  "2026_10_22_000030_campaigns_billing": {
    async up(db: AnyDb) {
      // JSON arrays / objects in varchar columns (MySQL TEXT columns can't have a default).
      await db.schema.alterTable("campaigns").addColumn("number_ids", "varchar(500)", (c) => c.notNull().defaultTo("[]")).execute();
      await db.schema.alterTable("campaigns").addColumn("list_ids", "varchar(500)", (c) => c.notNull().defaultTo("[]")).execute();
      await db.schema.alterTable("campaigns").addColumn("retry_delays", "varchar(255)", (c) => c.notNull().defaultTo("{}")).execute();
      await db.schema.alterTable("campaigns").addColumn("abandon_max_pct", "integer", (c) => c.notNull().defaultTo(3)).execute();
      await db.schema.alterTable("campaigns").addColumn("paused_reason", "varchar(30)").execute();
      await db.schema.alterTable("compliance_settings").addColumn("outbound_paused", "integer", (c) => c.notNull().defaultTo(0)).execute();
      await db.schema.alterTable("kyc_requests").addColumn("sample_script", "text").execute();
      await db.schema.alterTable("wallets").addColumn("auto_recharge_at", "varchar(32)").execute();
      // Opt-outs and DNC expiry: WHERE expires_at < now.
      await db.schema.createIndex("dnc_entries_expires_idx").on("dnc_entries").column("expires_at").execute();
      // Running campaign rows waiting for their call to end: WHERE state = 'in_call' AND last_call_id = ?.
      await db.schema.createIndex("campaign_contacts_call_idx").on("campaign_contacts").column("last_call_id").execute();
    },
    async down(db: AnyDb) {
      await db.schema.dropIndex("campaign_contacts_call_idx").on("campaign_contacts").execute();
      await db.schema.dropIndex("dnc_entries_expires_idx").on("dnc_entries").execute();
      for (const [table, column] of [
        ["wallets", "auto_recharge_at"],
        ["kyc_requests", "sample_script"],
        ["compliance_settings", "outbound_paused"],
        ["campaigns", "paused_reason"],
        ["campaigns", "abandon_max_pct"],
        ["campaigns", "retry_delays"],
        ["campaigns", "list_ids"],
        ["campaigns", "number_ids"],
      ]) {
        await db.schema.alterTable(table).dropColumn(column).execute();
      }
    },
  },
  "2026_10_22_000010_voice_runtime": {
    async up(db: AnyDb) {
      // Scheduled events of simulated calls (demo / tests), delivered through the real webhook ingest.
      await db.schema
        .createTable("voice_sim_events")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("provider_call_id", "varchar(190)", (c) => c.notNull())
        .addColumn("seq", "integer", (c) => c.notNull())
        .addColumn("due_at", "varchar(32)", (c) => c.notNull())
        .addColumn("body", "text", (c) => c.notNull())
        .addColumn("delivered_at", "varchar(32)")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("voice_sim_events_call_seq_uq", ["provider_call_id", "seq"])
        .execute();
      await db.schema.createIndex("voice_sim_events_due_idx").on("voice_sim_events").columns(["delivered_at", "due_at"]).execute();

      // Monthly phone number rentals charged to the wallet: one row per number and UTC month.
      await db.schema
        .createTable("number_rentals")
        .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
        .addColumn("workspace_id", "integer", (c) => c.notNull())
        .addColumn("number_id", "integer", (c) => c.notNull())
        .addColumn("month", "varchar(7)", (c) => c.notNull())
        .addColumn("amount_micros", "bigint", (c) => c.notNull())
        .addColumn("transaction_id", "integer")
        .addColumn("created_at", "varchar(32)", (c) => c.notNull())
        .addUniqueConstraint("number_rentals_number_month_uq", ["number_id", "month"])
        .execute();
      await db.schema.createIndex("number_rentals_ws_idx").on("number_rentals").columns(["workspace_id", "month"]).execute();
    },
    async down(db: AnyDb) {
      await db.schema.dropTable("number_rentals").ifExists().execute();
      await db.schema.dropTable("voice_sim_events").ifExists().execute();
    },
  },
  "2026_10_23_000011_reconcile_cursor": {
    async up(db: AnyDb) {
      // Finished calls the reconciliation confirmed with the provider are not checked again.
      await db.schema.alterTable("calls").addColumn("reconciled_at", "varchar(32)").execute();
      await db.schema.createIndex("calls_reconcile_idx").on("calls").columns(["reconciled_at", "created_at"]).execute();
    },
    async down(db: AnyDb) {
      await db.schema.dropIndex("calls_reconcile_idx").on("calls").execute();
      await db.schema.alterTable("calls").dropColumn("reconciled_at").execute();
    },
  },
  "2026_10_24_000012_sync_accounts": {
    async up(db: AnyDb) {
      // The provider account an agent / knowledge-base document was synced into (BYO keys vs the
      // site's keys): a changed account re-syncs them (src/lib/voice/sync.ts).
      await db.schema.alterTable("agents").addColumn("sync_key_source", "varchar(10)").execute();
      await db.schema.alterTable("agents").addColumn("sync_account", "varchar(64)").execute();
      await db.schema.alterTable("kb_items").addColumn("sync_account", "varchar(64)").execute();
    },
    async down(db: AnyDb) {
      await db.schema.alterTable("kb_items").dropColumn("sync_account").execute();
      await db.schema.alterTable("agents").dropColumn("sync_account").execute();
      await db.schema.alterTable("agents").dropColumn("sync_key_source").execute();
    },
  },
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
