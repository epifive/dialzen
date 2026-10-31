import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

/** A nullable column that inserts may leave out (added by a later migration). */
type OptionalNullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

/**
 * Database schema shared by the MySQL and SQLite drivers.
 *
 * Portability rules used across the project:
 * - booleans are stored as 0 / 1 integers
 * - timestamps are ISO-8601 strings (see `now()` in ./index.ts), so string comparison = time order
 * - plan prices and payments are in the smallest currency unit (cents); call credits, prices per
 *   minute and provider costs are in MICROS (1 USD = 1,000,000) so sub-cent amounts stay exact
 * - phone numbers are E.164 strings, countries ISO 3166-1 alpha-2
 * - JSON is stored as text (parse with parseJson() from src/voice/normalize.ts and normalise)
 * - days are "YYYY-MM-DD" strings (UTC unless stated otherwise), months "YYYY-MM"
 */

export interface SettingsTable {
  key: string;
  value: string | null;
}

export interface UsersTable {
  id: Generated<number>;
  name: string;
  email: string;
  password_hash: string;
  role: "user" | "admin";
  status: "active" | "banned";
  plan_id: number | null;
  plan_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionsTable {
  id: string;
  user_id: number;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PasswordResetsTable {
  token_hash: string;
  user_id: number;
  expires_at: string;
  created_at: string;
}

export interface PlansTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: string | null;
  // Limits: -1 = unlimited, 0 = none. They count across all the workspaces the owner owns.
  /** AI agents. */
  max_agents: number;
  /** Phone numbers (0 = browser test calls only). */
  max_numbers: number;
  /** Calls in progress at the same time (inbound + outbound + test calls). */
  max_concurrent_calls: number;
  /** Call minutes included each calendar month; beyond that, minutes are paid from the wallet. */
  included_minutes_monthly: number;
  /** Team seats, the owner included. */
  max_members: number;
  /** AI prompt assistant requests per calendar month. */
  max_ai_monthly: number;
  /** Outbound phone calls (still needs the admin's outbound approval of the workspace). */
  allow_outbound: number;
  /** Outbound campaigns (call lists with calling windows and retries). */
  allow_campaigns: number;
  /** Workspaces may use their own provider API keys. */
  allow_byo_keys: number;
  /** REST API access (/api/v1). */
  allow_api: number;
  /** Own branding on the web widget and notification emails. */
  allow_white_label: number;
  /** Hide the "Powered by" line on the widget and emails. */
  remove_branding: number;
  is_free: number;
  is_active: number;
  is_featured: number;
  sort_order: number;
  created_at: string;
}

export interface PaymentsTable {
  id: Generated<number>;
  user_id: number;
  /** The plan bought; 0 for a credit pack (purpose "credits"). */
  plan_id: number;
  /** "plan" (subscription period) or "credits" (wallet top-up of `workspace_id`). */
  purpose: Generated<"plan" | "credits">;
  /** Credit packs: the workspace whose wallet is topped up. */
  workspace_id: number | null;
  /** Credit packs: micros added to the wallet when the payment is paid. */
  credits_micros: number | null;
  amount: number;
  currency: string;
  billing_cycle: "monthly" | "yearly";
  provider: "stripe" | "paypal" | "razorpay" | "offline";
  provider_ref: string;
  status: "pending" | "paid" | "rejected" | "refunded";
  note: string | null;
  created_at: string;
}

export interface PagesTable {
  id: Generated<number>;
  slug: string;
  title: string;
  content: string;
  meta_description: string | null;
  is_published: number;
  show_in_footer: number;
  created_at: string;
  updated_at: string;
}

export interface ContactMessagesTable {
  id: Generated<number>;
  name: string;
  email: string;
  subject: string;
  message: string;
  ip: string | null;
  is_read: number;
  created_at: string;
}

export interface LanguagesTable {
  code: string;
  name: string;
  native_name: string;
  direction: "ltr" | "rtl";
  is_active: number;
  sort_order: number;
}

export interface TranslationsTable {
  lang: string;
  key: string;
  value: string;
}

/** Articles of the public blog (/blog). */
export interface BlogPostsTable {
  id: Generated<number>;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image: string | null;
  meta_description: string | null;
  status: "draft" | "published";
  published_at: string | null;
  views: number;
  created_at: string;
  updated_at: string;
}

// ── Workspaces and team ──

export interface WorkspacesTable {
  id: Generated<number>;
  /** The owner; their plan sets the workspace's limits. */
  owner_id: number;
  name: string;
  /** IANA time zone of reports and campaign schedules. */
  timezone: string;
  /** JSON WorkspaceSettings (src/voice/types.ts), read through normalizeWorkspaceSettings(). */
  settings: string;
  /** 1 = the workspace created automatically for the owner (can't be deleted). */
  is_personal: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMembersTable {
  id: Generated<number>;
  workspace_id: number;
  user_id: number;
  role: "owner" | "admin" | "editor" | "viewer";
  created_at: string;
}

export interface WorkspaceInvitesTable {
  id: Generated<number>;
  workspace_id: number;
  email: string;
  role: "admin" | "editor" | "viewer";
  /** sha256 of the invite token (the token is only in the invite link). */
  token_hash: string;
  invited_by: number;
  expires_at: string;
  created_at: string;
}

// ── Media library (knowledge-base files, logos) ──

export interface MediaFoldersTable {
  id: Generated<number>;
  workspace_id: number;
  parent_id: number | null;
  name: string;
  created_at: string;
}

export interface MediaTable {
  id: Generated<number>;
  workspace_id: number;
  folder_id: number | null;
  uploaded_by: number | null;
  /** Storage adapter: "local", "s3", "blob". */
  storage: string;
  /** Key / path inside the storage. */
  storage_key: string;
  /** Public HTTPS URL (local files: /api/media/f/…). */
  url: string;
  filename: string;
  mime: string;
  kind: "image" | "audio" | "document";
  size: number;
  width: number | null;
  height: number | null;
  /** Seconds (audio). */
  duration: number | null;
  alt_text: string;
  created_at: string;
}

// ── Voice providers ──

/**
 * A workspace's own provider keys (plan option allow_byo_keys). The platform's master keys live
 * in settings (Admin → Voice providers); a row here wins for its workspace and provider.
 */
export interface ProviderAccountsTable {
  id: Generated<number>;
  workspace_id: number;
  /** ProviderId (src/voice/types.ts). */
  provider: string;
  label: string;
  /** AES-256-GCM encrypted JSON ProviderKeys (purpose "provider-keys"). */
  credentials: string;
  status: "active" | "error" | "disabled";
  last_checked_at: string | null;
  last_error: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

// ── Agents, knowledge base and tools ──

export interface AgentsTable {
  id: Generated<number>;
  workspace_id: number;
  name: string;
  /** TemplateId the agent started from ("" = blank). */
  template: string;
  status: "draft" | "active" | "paused";
  /** ProviderId that runs the agent. */
  provider: string;
  /** The provider's agent id once synced. Indexed with provider (webhook routing). */
  provider_agent_id: string | null;
  /** JSON Record<string,string>: other provider ids (Retell LLM id…). */
  provider_meta: string;
  sync_status: "pending" | "synced" | "error";
  sync_error: string | null;
  synced_at: string | null;
  /**
   * The provider account the agent was last synced into: "platform" (the site's keys) or "byo"
   * (the workspace's own keys), and a fingerprint of that account's API key (accountFingerprint()).
   * When the account in use changes (plan downgrade, keys removed…) the agent is synced again.
   */
  sync_key_source: OptionalNullable<string>;
  sync_account: OptionalNullable<string>;
  /** BCP-47. */
  language: string;
  voice_id: string;
  voice_name: string;
  /** Always contains the AI disclosure (ensureDisclosure()). */
  first_message: string;
  system_prompt: string;
  /** Model id understood by the provider ("" = provider default). */
  llm: string;
  /** JSON AgentSettings, read through normalizeAgentSettings(). */
  settings: string;
  /** Random secret the provider sends to our tool endpoints (X-Dialzen-Tool-Secret). */
  tool_secret: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface KbItemsTable {
  id: Generated<number>;
  workspace_id: number;
  /** null = shared with every agent of the workspace. */
  agent_id: number | null;
  kind: "url" | "file" | "text";
  name: string;
  url: string | null;
  /** kind "file": media.id of the uploaded document. */
  media_id: number | null;
  /** kind "text": the text; files and URLs: extracted text when available. */
  content: string | null;
  size_bytes: number;
  /** Provider the document is uploaded to, and its id there. */
  provider: string | null;
  provider_doc_id: string | null;
  /** Fingerprint of the provider account the document was uploaded to (null = before this was tracked). */
  sync_account: OptionalNullable<string>;
  status: "pending" | "ready" | "error";
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolsTable {
  id: Generated<number>;
  workspace_id: number;
  /** ToolKind. */
  kind: string;
  /** Function name the LLM calls (snake_case). */
  name: string;
  description: string;
  /** AES-256-GCM encrypted JSON ToolConfig (purpose "tool-config"): API keys and OAuth tokens. */
  config: string;
  status: "active" | "error" | "disabled";
  last_error: string | null;
  last_used_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AgentToolsTable {
  agent_id: number;
  tool_id: number;
  workspace_id: number;
  created_at: string;
}

// ── Phone numbers ──

export interface PhoneNumbersTable {
  id: Generated<number>;
  workspace_id: number;
  e164: string;
  country: string;
  label: string;
  /** ProviderId the number is imported into. */
  provider: string;
  /** Carrier (src/voice/types.ts CARRIERS): retell, twilio, sip, exotel… */
  carrier: string;
  provider_number_id: string | null;
  /** AES-256-GCM encrypted JSON of carrier credentials (Twilio SID/token, SIP login), "" = none. */
  credentials: string;
  inbound_agent_id: number | null;
  /** Default agent of outbound calls from this number (campaigns choose their own). */
  outbound_agent_id: number | null;
  outbound_enabled: number;
  kyc_status: "not_required" | "pending" | "approved" | "rejected";
  /** Outbound dials per local day from this number (spam-label guard). */
  daily_dial_cap: number;
  /** Monthly rental charged to the wallet (micros, 0 = none). */
  monthly_price_micros: number;
  status: "pending" | "active" | "error" | "released";
  last_error: string | null;
  released_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

// ── Contacts, consent and do-not-call ──

export interface ContactsTable {
  id: Generated<number>;
  workspace_id: number;
  phone_e164: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  country: string;
  /** IANA zone ("" = unknown: calling hours are checked in every zone of the country). */
  timezone: string;
  /** Region / US state code ("FL"), used for state calling-hour presets. */
  state: string;
  /** BCP-47 ("" = the agent's language). */
  language: string;
  /** JSON object of custom fields ({{contact.<field>}} in prompts). */
  fields: string;
  /** JSON string[]. */
  tags: string;
  source: "manual" | "csv" | "api" | "call" | "widget";
  /** Set when the person asked not to be called again (also a DNC entry). */
  opted_out_at: string | null;
  last_called_at: string | null;
  calls_count: number;
  created_at: string;
  updated_at: string;
}

export interface ContactListsTable {
  id: Generated<number>;
  workspace_id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface ListMembersTable {
  list_id: number;
  contact_id: number;
  workspace_id: number;
  added_at: string;
}

/** Consent evidence, one row per consent given (never edited, only revoked). */
export interface ConsentsTable {
  id: Generated<number>;
  workspace_id: number;
  contact_id: number;
  /** The number the consent was given for (snapshot). */
  phone_e164: string;
  /** ConsentType: pewc, pec, ai_voice, marketing, recording. */
  type: string;
  /** CampaignPurpose or "any". */
  purpose: string;
  /** ConsentSource: web_form, csv, api, verbal, paper, inbound_call, other. */
  source: string;
  source_url: string;
  captured_at: string;
  ip: string;
  user_agent: string;
  /** The exact consent wording the person agreed to. */
  text_snapshot: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_by: number | null;
  created_at: string;
}

/**
 * Do-not-call entries. scope "workspace" = the tenant's internal / uploaded national lists;
 * scope "global" = the operator's list (workspace_id 0), checked for every workspace.
 * Unique (scope, workspace_id, phone_e164).
 */
export interface DncEntriesTable {
  id: Generated<number>;
  scope: "workspace" | "global";
  workspace_id: number;
  phone_e164: string;
  /** DncReason. */
  reason: string;
  /** Where it came from: "call:123", "csv", "api", "admin"… */
  source: string;
  /** Uploaded list name and date (national DNC / TPS with the SAN), "" = none. */
  list_ref: string;
  note: string;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
}

// ── Campaigns ──

export interface CampaignsTable {
  id: Generated<number>;
  workspace_id: number;
  name: string;
  agent_id: number;
  /** Caller id (phone_numbers.id). */
  number_id: number;
  list_id: number | null;
  purpose: "informational" | "telemarketing";
  status: "draft" | "scheduled" | "running" | "paused" | "completed" | "canceled";
  starts_at: string | null;
  ends_at: string | null;
  /** JSON CallingWindow (narrows the workspace's calling hours). */
  calling_window: string;
  /** "contact" = the window is in each contact's local time; "campaign" = in `timezone`. */
  timezone_mode: "contact" | "campaign";
  timezone: string;
  max_attempts: number;
  retry_delay_min: number;
  /** JSON RetryableOutcome[]. */
  retry_on: string;
  /** Calls of this campaign in progress at once (also capped by plan and workspace). */
  concurrency: number;
  /** Dials per local day for the campaign (0 = only the number's cap). */
  daily_cap: number;
  /** JSON object of extra prompt variables for every call. */
  variables: string;
  /** JSON counters cached by the engine (pending, completed, failed…). */
  stats: string;
  /** JSON number[]: caller-id pool (phone_numbers.id); [] = `number_id` only. The engine uses the first number under its daily cap. */
  number_ids: Generated<string>;
  /** JSON number[]: contact lists added to the campaign ([] = `list_id` only). */
  list_ids: Generated<string>;
  /** JSON Partial<Record<RetryableOutcome, minutes>>: retry delay per outcome (missing = retry_delay_min). */
  retry_delays: Generated<string>;
  /** Auto-pause when more than this % of answered calls are abandoned (no agent speech within 2 s), 0 = off. */
  abandon_max_pct: Generated<number>;
  /** Why the engine paused the campaign ("abandonment", "no_credits", "number_cap"…); null = paused by a person. */
  paused_reason: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** One contact of a campaign; the engine leases rows before dialing (one dial per lease). */
export interface CampaignContactsTable {
  id: Generated<number>;
  campaign_id: number;
  workspace_id: number;
  contact_id: number;
  phone_e164: string;
  state: "pending" | "dialing" | "in_call" | "retry" | "completed" | "failed" | "skipped" | "canceled";
  attempts: number;
  /** When the engine may (re)try. Indexed with campaign_id and state. */
  next_attempt_at: string | null;
  /** Random token of the tick holding the lease, and its expiry. */
  lease_token: string | null;
  lease_until: string | null;
  last_call_id: number | null;
  /** Final status of the last call (no_answer, busy…). */
  last_outcome: string | null;
  /** DialBlockReason(s) of a skipped row, comma-separated. */
  skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Calls ──

export interface CallsTable {
  id: Generated<number>;
  workspace_id: number;
  agent_id: number | null;
  campaign_id: number | null;
  campaign_contact_id: number | null;
  contact_id: number | null;
  number_id: number | null;
  direction: "inbound" | "outbound" | "web";
  from_e164: string;
  to_e164: string;
  /** ProviderId. Unique with provider_call_id. */
  provider: string;
  provider_call_id: string | null;
  /** "platform" master key or the workspace's own "byo" key (billing differs). */
  key_source: "platform" | "byo";
  /** CallStatus. */
  status: string;
  /** EndReason (null while live). */
  end_reason: string | null;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number;
  /** Seconds billed after rounding, of which `included_seconds` came from the plan's minutes. */
  billed_seconds: number;
  included_seconds: number;
  /** Sell price per minute used to bill the call (micros). */
  price_per_min_micros: number;
  credits_reserved_micros: number;
  credits_settled_micros: number;
  /** What the provider charged the operator (micros, null = unknown). */
  provider_cost_micros: number | null;
  /** Recording copied to storage (driver + key), the provider's temporary URL, and its deletion time. */
  recording_storage: string | null;
  recording_key: string | null;
  recording_url: string | null;
  recording_deleted_at: string | null;
  /** JSON TranscriptTurn[]. */
  transcript: string | null;
  summary: string | null;
  sentiment: "positive" | "neutral" | "negative" | "unknown";
  /** Short outcome label (booked, transferred, opted_out…) from the analysis. */
  outcome: string | null;
  /** JSON object: the agent's analysis fields. */
  extracted: string | null;
  /** 1 = the AI disclosure was played (first message), null = unknown. */
  disclosure_played: number | null;
  /** JSON ToolCallRecord[]. */
  tool_calls: string | null;
  /** Median response latency reported by the provider (ms). */
  latency_ms: number | null;
  /** JSON CallTags + extra provider data. */
  metadata: string;
  error: string | null;
  /** When the nightly reconciliation last confirmed this finished call with the provider (null = not yet). */
  reconciled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Provider webhooks already handled (idempotency: unique provider + event_id). */
export interface WebhookEventsTable {
  id: Generated<number>;
  provider: string;
  event_id: string;
  received_at: string;
  /** sha256 of the raw body. */
  payload_hash: string;
  call_id: number | null;
  status: "processed" | "ignored" | "error";
  error: string | null;
}

// ── Credits ──

/** One wallet per workspace. Balances change only through src/lib/wallet.ts (conditional UPDATEs). */
export interface WalletsTable {
  workspace_id: number;
  /** Spendable balance (micros); reservations are already taken off. */
  balance_micros: number;
  /** Held for calls in progress (micros). */
  reserved_micros: number;
  /** JSON AutoRecharge. */
  auto_recharge: string;
  /** Notify when the balance falls below this (micros, 0 = off). */
  low_balance_micros: number;
  low_balance_notified_at: string | null;
  /** Last automatic recharge attempt (throttle: one attempt per few hours). */
  auto_recharge_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Wallet ledger (append-only). Unique (call_id, kind): a call is reserved, settled or released once. */
export interface CreditTransactionsTable {
  id: Generated<number>;
  workspace_id: number;
  kind: "purchase" | "reserve" | "settle" | "release" | "adjustment" | "included";
  /** Signed change of the spendable balance (micros); 0 for "included". */
  amount_micros: number;
  balance_after: number;
  call_id: number | null;
  payment_id: number | null;
  /** Billed seconds ("settle", "included"). */
  seconds: number;
  note: string;
  created_by: number | null;
  created_at: string;
}

// ── Compliance ──

/** Append-only audit trail (consent, scrubs, dial decisions, disclosures, opt-outs, admin actions). */
export interface AuditLogTable {
  id: Generated<number>;
  /** null = platform level (admin actions, global DNC). */
  workspace_id: number | null;
  actor_type: "user" | "api" | "system" | "admin" | "provider";
  actor_id: number | null;
  /** "consent.added", "dnc.added", "call.blocked", "outbound.approved"… */
  action: string;
  entity_type: string;
  entity_id: string;
  /** JSON details. */
  data: string;
  ip: string;
  created_at: string;
}

export interface ComplianceSettingsTable {
  workspace_id: number;
  /** JSON ComplianceSettings. */
  settings: string;
  /** OutboundState: outbound calls need the admin's approval. */
  outbound_state: "not_requested" | "pending" | "approved" | "rejected" | "suspended";
  /** Acceptable-use terms accepted (ISO) and by whom. */
  aup_accepted_at: string | null;
  aup_accepted_by: number | null;
  /** Admin kill switch: 1 = no outbound calls at all, whatever the approval. */
  kill_switch: number;
  kill_reason: string | null;
  /** The workspace's own stop switch (its admins): 1 = no outbound calls until switched off. */
  outbound_paused: Generated<number>;
  updated_at: string;
}

/** Outbound approval requests (KYC) reviewed by the admin. */
export interface KycRequestsTable {
  id: Generated<number>;
  workspace_id: number;
  business_name: string;
  address: string;
  website: string;
  country: string;
  use_case: string;
  /** How the numbers called gave their consent. */
  consent_method: string;
  /** A sample of what the agent says on outbound calls. */
  sample_script: string | null;
  expected_volume: string;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  submitted_by: number | null;
  created_at: string;
  updated_at: string;
}

// ── Account level ──

export interface ApiKeysTable {
  id: Generated<number>;
  /** The workspace the key acts in. */
  workspace_id: number;
  /** Who created it (must still be a member for the key to work). */
  user_id: number;
  name: string;
  /** sha256 of the key; the key itself is shown once. */
  key_hash: string;
  /** First characters, to recognise the key in the list. */
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

/** Monthly usage per account (the workspace OWNER's plan), UTC month. */
export interface UsageMonthlyTable {
  user_id: number;
  /** YYYY-MM (UTC) */
  month: string;
  /** Billed call seconds counted against the plan's included minutes (included_minutes_monthly × 60). */
  seconds_used: number;
  /** Calls finished this month (all directions). */
  calls: number;
  /** AI prompt assistant requests (max_ai_monthly). */
  ai_requests: number;
  /** Comma-separated quota alerts sent this month ("minutes:quota_warning"), see src/lib/notify/quota.ts. */
  quota_alerts: string | null;
}

/** Where workspace notifications go (email, Slack, Teams, Telegram, Discord, webhook). */
export interface NotifyChannelsTable {
  id: Generated<number>;
  workspace_id: number;
  created_by: number | null;
  type: "email" | "webhook" | "slack" | "discord" | "telegram" | "teams";
  name: string;
  /** JSON: NotifyConfigByType[type]. */
  config: string;
  /** JSON NotifyEvent[] this channel receives. */
  events: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AlertLogTable {
  id: Generated<number>;
  workspace_id: number | null;
  call_id: number | null;
  /** notify_channels.id (null = account email or no channel). */
  notify_channel_id: number | null;
  event: string;
  ok: number;
  error: string | null;
  created_at: string;
}

/** Scheduled events of a simulated call (demo / tests), delivered through the webhook ingest. */
export interface VoiceSimEventsTable {
  id: Generated<number>;
  workspace_id: number;
  provider_call_id: string;
  /** Order within the call (unique with provider_call_id). */
  seq: number;
  due_at: string;
  /** Raw JSON body of the simulated webhook. */
  body: string;
  delivered_at: string | null;
  created_at: string;
}

/** Monthly rental of a phone number charged to the wallet (once per number and UTC month). */
export interface NumberRentalsTable {
  id: Generated<number>;
  workspace_id: number;
  number_id: number;
  /** YYYY-MM (UTC). */
  month: string;
  amount_micros: number;
  /** credit_transactions.id of the charge (null = not charged, e.g. admin-owned). */
  transaction_id: number | null;
  created_at: string;
}

export interface Database {
  settings: SettingsTable;
  users: UsersTable;
  sessions: SessionsTable;
  password_resets: PasswordResetsTable;
  plans: PlansTable;
  payments: PaymentsTable;
  pages: PagesTable;
  contact_messages: ContactMessagesTable;
  languages: LanguagesTable;
  translations: TranslationsTable;
  blog_posts: BlogPostsTable;
  workspaces: WorkspacesTable;
  workspace_members: WorkspaceMembersTable;
  workspace_invites: WorkspaceInvitesTable;
  media_folders: MediaFoldersTable;
  media: MediaTable;
  provider_accounts: ProviderAccountsTable;
  agents: AgentsTable;
  kb_items: KbItemsTable;
  tools: ToolsTable;
  agent_tools: AgentToolsTable;
  phone_numbers: PhoneNumbersTable;
  contacts: ContactsTable;
  contact_lists: ContactListsTable;
  list_members: ListMembersTable;
  consents: ConsentsTable;
  dnc_entries: DncEntriesTable;
  campaigns: CampaignsTable;
  campaign_contacts: CampaignContactsTable;
  calls: CallsTable;
  webhook_events: WebhookEventsTable;
  wallets: WalletsTable;
  credit_transactions: CreditTransactionsTable;
  audit_log: AuditLogTable;
  compliance_settings: ComplianceSettingsTable;
  kyc_requests: KycRequestsTable;
  api_keys: ApiKeysTable;
  usage_monthly: UsageMonthlyTable;
  notify_channels: NotifyChannelsTable;
  alert_log: AlertLogTable;
  voice_sim_events: VoiceSimEventsTable;
  number_rentals: NumberRentalsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Plan = Selectable<PlansTable>;
export type Payment = Selectable<PaymentsTable>;
export type Page = Selectable<PagesTable>;
export type ContactMessage = Selectable<ContactMessagesTable>;
export type Language = Selectable<LanguagesTable>;
export type BlogPost = Selectable<BlogPostsTable>;
export type WorkspaceRow = Selectable<WorkspacesTable>;
export type WorkspaceMemberRow = Selectable<WorkspaceMembersTable>;
export type WorkspaceInviteRow = Selectable<WorkspaceInvitesTable>;
export type MediaRow = Selectable<MediaTable>;
export type MediaFolderRow = Selectable<MediaFoldersTable>;
export type ProviderAccountRow = Selectable<ProviderAccountsTable>;
export type AgentRow = Selectable<AgentsTable>;
export type KbItemRow = Selectable<KbItemsTable>;
export type ToolRow = Selectable<ToolsTable>;
export type PhoneNumberRow = Selectable<PhoneNumbersTable>;
export type ContactRow = Selectable<ContactsTable>;
export type ContactListRow = Selectable<ContactListsTable>;
export type ConsentRow = Selectable<ConsentsTable>;
export type DncEntryRow = Selectable<DncEntriesTable>;
export type CampaignRow = Selectable<CampaignsTable>;
export type CampaignContactRow = Selectable<CampaignContactsTable>;
export type CallRow = Selectable<CallsTable>;
export type WalletRow = Selectable<WalletsTable>;
export type CreditTransactionRow = Selectable<CreditTransactionsTable>;
export type AuditLogRow = Selectable<AuditLogTable>;
export type ComplianceSettingsRow = Selectable<ComplianceSettingsTable>;
export type KycRequestRow = Selectable<KycRequestsTable>;
export type ApiKey = Selectable<ApiKeysTable>;
export type NotifyChannelRow = Selectable<NotifyChannelsTable>;
