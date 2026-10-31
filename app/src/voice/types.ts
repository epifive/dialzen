/**
 * The Dialzen contract: shared by the voice provider adapters (ElevenLabs Agents, Retell AI,
 * Simulated), the webhook ingest, the tool runtime, the campaign engine, the billing (wallet)
 * code, the dashboard, the REST API, the background jobs and the notification channels.
 *
 * Our database is the source of truth. Agents, knowledge-base items and tools are synced OUT to
 * the provider that runs the realtime audio loop; call events come back IN through webhooks and
 * are normalised into NormalizedCallEvent objects.
 *
 * Keep this file free of imports and runtime dependencies (apart from the ProviderError class): it
 * is used on the server, in client components and in the library tests.
 *
 * Conventions:
 * - times are ISO-8601 strings in UTC ("2026-10-21T09:30:00.000Z"); days are "YYYY-MM-DD"
 * - time zones are IANA names ("America/Chicago"); local wall-clock times are "HH:MM" (24 h)
 * - weekdays are ISO numbers: 1 = Monday … 7 = Sunday
 * - phone numbers are E.164 strings ("+14155550123"); countries are ISO 3166-1 alpha-2 ("US")
 * - money is in MICROS of the site currency (1 USD = 1,000,000 micros), durations in seconds
 * - languages are BCP-47 tags ("en-US", "hi-IN", "ar-SA")
 * - JSON columns are parsed with parseJson() and always normalised before use (./normalize.ts)
 */

// ── Providers ──

/** Voice providers with an adapter in v1. Vapi and Ultravox are planned for v1.1. */
export const PROVIDERS = ["elevenlabs", "retell", "simulated"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Where telephony comes from when a number is imported into a provider. */
export const CARRIERS = ["retell", "twilio", "sip", "exotel", "telnyx", "plivo", "simulated"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** What a provider can do; the UI hides what it can't. */
export interface ProviderCapabilities {
  /** Buy numbers through the provider's API (Retell: US/CA only). */
  numbersPurchase: boolean;
  /** Countries numbers can be bought in (ISO), [] when numbersPurchase is false. */
  purchaseCountries: string[];
  /** Ways to bring an existing number. */
  numbersImport: Carrier[];
  /** Outbound phone calls. */
  outbound: boolean;
  /** Browser test calls (WebRTC SDK or our text simulation). */
  webCall: boolean;
  /** Knowledge-base documents hosted by the provider. */
  knowledgeBase: boolean;
  /** Warm (announced) transfer to a human; cold transfer is always available. */
  warmTransfer: boolean;
  /** Voicemail / answering machine detection on outbound calls. */
  voicemailDetection: boolean;
  /** Post-call webhook URL per agent (Retell) instead of one per provider account (ElevenLabs). */
  perAgentWebhook: boolean;
  /** Per-call inbound routing webhook (tenant routing, reject, dynamic variables). */
  inboundWebhook: boolean;
  /** How recordings are fetched: a temporary URL in the webhook, an API call, or none. */
  recordings: "url" | "api" | "none";
  /** The post-call webhook carries the provider's cost of the call. */
  costInWebhook: boolean;
  /** Spoken languages (BCP-47 primary tags, e.g. "en", "hi", "ar"). */
  languages: string[];
}

/** Decrypted credentials of one provider account (the admin's platform key or a tenant's own key). */
export interface ProviderKeys {
  apiKey: string;
  /** Secret used to verify webhook signatures ("" = the provider signs with the API key, as Retell does). */
  webhookSecret: string;
  /** Provider specific extras (ElevenLabs workspace id, Retell LLM defaults…). */
  extra: Record<string, string>;
}

/**
 * Everything an adapter needs, injected so adapters stay pure and testable: no adapter reads
 * settings, the database or the clock directly.
 */
export interface ProviderContext {
  provider: ProviderId;
  keys: ProviderKeys;
  /** The admin's master key ("platform") or the workspace's own key ("byo"). */
  keySource: "platform" | "byo";
  fetch: typeof fetch;
  now: () => number;
  /** Absolute base URL of this installation (webhooks and tool endpoints are built from it). */
  baseUrl: string;
  /** Tests point adapters at mock servers ("" = the provider's real API). */
  apiBase: string;
  /** Request timeout in ms (tool endpoints and dashboard actions use short ones). */
  timeoutMs: number;
}

/** Classified provider failure, thrown by adapters. */
export const PROVIDER_ERROR_KINDS = ["auth", "rate_limit", "validation", "not_found", "network", "quota", "unsupported", "unknown"] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(kind: ProviderErrorKind, message: string, options: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? (kind === "rate_limit" || kind === "network");
  }
}

export interface Voice {
  id: string;
  name: string;
  /** BCP-47 tags the voice speaks well ([] = multilingual). */
  languages: string[];
  gender: "female" | "male" | "neutral" | "";
  accent: string;
  /** Short audio sample hosted by the provider ("" = none). */
  previewUrl: string;
}

export type ConnectionTest = { ok: true; account: string; detail?: string } | { ok: false; error: ProviderError };

// ── Agents ──

export const AGENT_STATUSES = ["draft", "active", "paused"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const SYNC_STATUSES = ["pending", "synced", "error"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const INTERRUPTION_LEVELS = ["low", "medium", "high"] as const;
export type InterruptionSensitivity = (typeof INTERRUPTION_LEVELS)[number];

export const VOICEMAIL_ACTIONS = ["hangup", "leave_message"] as const;
export type VoicemailAction = (typeof VOICEMAIL_ACTIONS)[number];

/** A field the post-call analysis extracts from the transcript (per agent). */
export const ANALYSIS_FIELD_TYPES = ["string", "number", "boolean", "enum", "date"] as const;
export type AnalysisFieldType = (typeof ANALYSIS_FIELD_TYPES)[number];

export interface AnalysisField {
  /** snake_case key in calls.extracted ("appointment_time"). */
  key: string;
  label: string;
  type: AnalysisFieldType;
  /** Instruction for the model ("The date and time the caller booked, ISO-8601"). */
  description: string;
  /** Allowed values of an enum. */
  options: string[];
  required: boolean;
}

/** The embeddable web voice widget of an agent. */
export interface WidgetSettings {
  enabled: boolean;
  /** Hostnames allowed to embed the widget ("example.com", "*.example.com"); [] = nowhere. */
  allowedDomains: string[];
  title: string;
  /** #rrggbb ("" = the platform colour). */
  color: string;
  position: "bottom-right" | "bottom-left";
}

/** Stored as JSON in agents.settings; always read through normalizeAgentSettings(). */
export interface AgentSettings {
  /** Hard cap of a call (also the cost guard), 60–3600 s. */
  maxDurationSec: number;
  /** Hang up after this long without speech, 5–120 s. */
  silenceTimeoutSec: number;
  interruptionSensitivity: InterruptionSensitivity;
  /** LLM temperature, 0–1. */
  temperature: number;
  /** Speaking speed, 0.7–1.3. */
  speed: number;
  voicemailAction: VoicemailAction;
  /** Spoken when voicemailAction is "leave_message" (variables allowed). */
  voicemailMessage: string;
  /** The agent ends the call when one of these happens ("the caller says goodbye"). */
  endCallConditions: string[];
  /** Human hand-off number (E.164, "" = no transfer). */
  transferNumber: string;
  /** Record calls (a recording notice is then always played). */
  recording: boolean;
  /** "" = the workspace's compliance name. Said in the first message with the AI disclosure. */
  businessName: string;
  /** What "a successful call" means for this agent (post-call evaluation). */
  successCriteria: string;
  analysisFields: AnalysisField[];
  widget: WidgetSettings;
}

/** An agent as the provider adapters receive it (our row, normalised). */
export interface AgentSpec {
  id: number;
  workspaceId: number;
  name: string;
  /** BCP-47, e.g. "en-US". */
  language: string;
  voiceId: string;
  /** Spoken first; always contains the AI disclosure (ensureDisclosure()). */
  firstMessage: string;
  systemPrompt: string;
  /** Model id understood by the provider ("gpt-4.1-mini", "gemini-2.5-flash"…; "" = provider default). */
  llm: string;
  settings: AgentSettings;
  /** Set once synced. */
  providerAgentId: string | null;
  /** Provider ids that belong with the agent (Retell LLM id, ElevenLabs version id…). */
  providerMeta: Record<string, string>;
  /** Where the provider sends this agent's call events (perAgentWebhook providers). */
  webhookUrl: string;
  /**
   * ElevenLabs conversation-initiation webhook for inbound calls: our URL and the secret the
   * provider must send in the X-Dialzen-Inbound-Secret header (null = not set, e.g. a local site).
   */
  inboundWebhook?: { url: string; secret: string } | null;
}

export interface SyncAgentResult {
  providerAgentId: string;
  providerMeta: Record<string, string>;
}

// ── Knowledge base ──

export const KB_KINDS = ["url", "file", "text"] as const;
export type KbKind = (typeof KB_KINDS)[number];

export const KB_STATUSES = ["pending", "ready", "error"] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

/** A knowledge-base item handed to an adapter. Files are opened lazily from media storage. */
export interface KbDoc {
  id: number;
  kind: KbKind;
  name: string;
  /** kind "url". */
  url: string;
  /** kind "text" (and extracted text when available). */
  text: string;
  file: { filename: string; mime: string; size: number; open: () => Promise<ReadableStream<Uint8Array>> } | null;
  providerDocId: string | null;
}

// ── Tools (actions the agent can take during a call) ──

export const TOOL_KINDS = ["cal_com", "google_calendar", "webhook", "google_sheets", "transfer", "end_call"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/** A parameter the LLM fills when it calls a webhook tool. */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
}

export interface WeeklyHours {
  /** "HH:MM" local. */
  start: string;
  end: string;
  /** ISO weekdays. */
  days: number[];
}

/**
 * Tool settings by kind, stored ENCRYPTED in tools.config (they hold API keys and OAuth tokens).
 * Providers never see these values: they only get our tool endpoint (ToolSpec).
 */
export interface ToolConfigByKind {
  cal_com: {
    apiKey: string;
    eventTypeId: number;
    /** IANA zone the agent speaks times in. */
    timezone: string;
    /** "" = https://api.cal.com (self-hosted Cal.com: its API base). */
    apiBase: string;
  };
  google_calendar: {
    calendarId: string;
    /** Encrypted OAuth tokens of the connected Google account (see src/lib/oauth-state.ts). */
    refreshToken: string;
    accountEmail: string;
    durationMin: number;
    bufferMin: number;
    timezone: string;
    hours: WeeklyHours;
  };
  webhook: {
    url: string;
    /** Always POST: the signature covers the JSON body (configs saved with GET are read as POST). */
    method: "POST";
    /** Extra headers (e.g. an API key of the target system). */
    headers: Record<string, string>;
    /** HMAC-SHA256 signing secret of the body (X-Dialzen-Signature). */
    secret: string;
    timeoutMs: number;
    parameters: ToolParameter[];
  };
  google_sheets: {
    spreadsheetId: string;
    sheetName: string;
    refreshToken: string;
    accountEmail: string;
    /** Column order of the appended row (keys of the call's extracted data or caller fields). */
    columns: string[];
  };
  transfer: {
    /** E.164. */
    number: string;
    mode: "cold" | "warm";
    /** Said to the human before connecting (warm transfer). */
    whisper: string;
  };
  end_call: {
    /** When the agent should end the call (added to the prompt). */
    instructions: string;
  };
}
export type ToolConfig<K extends ToolKind = ToolKind> = ToolConfigByKind[K];

/** What an adapter registers with the provider for one tool. */
export interface ToolSpec {
  id: number;
  kind: ToolKind;
  /** Function name the LLM calls (snake_case, unique per agent). */
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** Our endpoint (/api/voice/tools/<id>) for server tools; "" for system tools (transfer, end_call). */
  url: string;
  /** Per agent and tool secret the provider sends back (header X-Dialzen-Tool-Secret). */
  secret: string;
  /** transfer only. */
  transfer: { number: string; mode: "cold" | "warm"; whisper: string } | null;
}

// ── Phone numbers ──

export const NUMBER_STATUSES = ["pending", "active", "error", "released"] as const;
export type NumberStatus = (typeof NUMBER_STATUSES)[number];

export const KYC_STATUSES = ["not_required", "pending", "approved", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export interface BuyNumberInput {
  country: string;
  areaCode: string;
  tollFree: boolean;
}

/** Bring an existing number into a provider. Secrets are only passed through, never logged. */
export interface NumberImportSpec {
  e164: string;
  carrier: Carrier;
  label: string;
  /** Twilio. */
  twilio?: { accountSid: string; authToken: string };
  /** SIP trunk (Telnyx, Plivo, Exotel, Asterisk…). */
  sip?: { terminationUri: string; username: string; password: string };
}

export interface NumberRef {
  providerNumberId: string;
  e164: string;
}

// ── Calls ──

export const CALL_DIRECTIONS = ["inbound", "outbound", "web"] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/**
 * Lifecycle of a call row. queued → ringing → in_progress → one final status. Final statuses:
 * completed (talked), no_answer, busy, voicemail, failed, canceled.
 */
export const CALL_STATUSES = ["queued", "ringing", "in_progress", "completed", "no_answer", "busy", "voicemail", "failed", "canceled"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const FINAL_CALL_STATUSES: readonly CallStatus[] = ["completed", "no_answer", "busy", "voicemail", "failed", "canceled"];
export const LIVE_CALL_STATUSES: readonly CallStatus[] = ["queued", "ringing", "in_progress"];

/** Why a call ended (normalised across providers). */
export const END_REASONS = [
  "caller_hangup",
  "agent_hangup",
  "transferred",
  "voicemail",
  "no_answer",
  "busy",
  "max_duration",
  "silence_timeout",
  "opt_out",
  "rejected",
  "canceled",
  "error",
  "unknown",
] as const;
export type EndReason = (typeof END_REASONS)[number];

export const SENTIMENTS = ["positive", "neutral", "negative", "unknown"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** One turn of a transcript; `at` = seconds from the start of the call. */
export interface TranscriptTurn {
  role: "agent" | "caller" | "tool";
  text: string;
  at: number;
}

/** A tool call made during the call (stored in calls.tool_calls). */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
  ok: boolean;
  at: number;
  durationMs: number;
}

/**
 * Tenant tags put on every provider call (ElevenLabs user_id + dynamic variables, Retell
 * metadata), so webhooks from a shared platform account route back to the right workspace.
 */
export interface CallTags {
  workspaceId: number | null;
  callId: number | null;
  agentId: number | null;
  campaignId: number | null;
  contactId: number | null;
}

export interface StartCallInput {
  agent: AgentSpec;
  /** E.164 caller id (a number imported into the provider). */
  from: string;
  /** E.164 destination. */
  to: string;
  /** Prompt variables ({{contact.first_name}}…), already rendered to strings. */
  variables: Record<string, string>;
  metadata: CallTags;
  /** The provider's id of the `from` number when it needs one (ElevenLabs phone number id). */
  fromNumberId: string | null;
}

export interface WebCallSession {
  /** Which browser client to load. "simulated" = our text chat (no audio). */
  sdk: "elevenlabs" | "retell" | "simulated";
  /** Access token (Retell) or signed URL (ElevenLabs); "" for simulated. */
  token: string;
  url: string;
  /** The provider's call id when known up front (Retell web calls). */
  providerCallId: string | null;
  expiresAt: string;
}

/** A call as the provider reports it (getCall, reconciliation). */
export interface ProviderCallDetails {
  providerCallId: string;
  status: CallStatus;
  endReason: EndReason | null;
  direction: CallDirection | null;
  from: string;
  to: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number;
  /** null = the provider didn't say. */
  costMicros: number | null;
  transcript: TranscriptTurn[];
  summary: string;
  sentiment: Sentiment;
  extracted: Record<string, unknown>;
  recordingUrl: string;
  latencyMs: number | null;
  metadata: CallTags;
}

export interface RecordingStream {
  body: ReadableStream<Uint8Array>;
  mime: string;
  /** Bytes when known. */
  size: number | null;
}

// ── Normalised webhook events ──

export const CALL_EVENT_TYPES = ["started", "ended", "analysis_ready", "transcript", "tool_call", "failed"] as const;
export type CallEventType = (typeof CALL_EVENT_TYPES)[number];

interface CallEventBase {
  /** Unique per provider (idempotency key in webhook_events). */
  eventId: string;
  provider: ProviderId;
  providerCallId: string;
  /** When it happened (ISO). */
  at: string;
  metadata: CallTags;
}

export type NormalizedCallEvent =
  | (CallEventBase & { type: "started"; direction: CallDirection | null; from: string; to: string; providerAgentId: string | null })
  | (CallEventBase & {
      type: "ended";
      status: CallStatus;
      endReason: EndReason;
      durationSec: number;
      costMicros: number | null;
      startedAt: string | null;
      endedAt: string;
      transcript: TranscriptTurn[];
      recordingUrl: string;
      disclosurePlayed: boolean | null;
      latencyMs: number | null;
    })
  | (CallEventBase & { type: "analysis_ready"; summary: string; sentiment: Sentiment; extracted: Record<string, unknown>; success: boolean | null })
  | (CallEventBase & { type: "transcript"; transcript: TranscriptTurn[] })
  | (CallEventBase & { type: "tool_call"; call: ToolCallRecord })
  | (CallEventBase & { type: "failed"; endReason: EndReason; error: string });

/** Headers as a plain lower-case map (Request headers are converted before verifyWebhook). */
export type WebhookHeaders = Record<string, string>;

// ── The adapter interface ──

/**
 * One voice provider. Methods throw ProviderError. Optional methods are missing when the
 * capability is (buyNumber without numbersPurchase). Adapters must be stateless: everything comes
 * from the ProviderContext.
 */
export interface VoiceProvider {
  id: ProviderId;
  capabilities: ProviderCapabilities;

  /** Checks the keys (Admin → Voice providers → Test, tenant BYO keys). */
  testConnection(ctx: ProviderContext): Promise<ConnectionTest>;
  /** Voices, optionally filtered to a language (BCP-47 primary tag or full tag). */
  listVoices(ctx: ProviderContext, lang?: string): Promise<Voice[]>;

  /** Creates or updates the provider's copy of the agent (prompt, voice, tools, KB, webhook). */
  syncAgent(ctx: ProviderContext, agent: AgentSpec, tools: ToolSpec[], kb: KbDoc[]): Promise<SyncAgentResult>;
  deleteAgent(ctx: ProviderContext, providerAgentId: string, providerMeta: Record<string, string>): Promise<void>;
  /** Uploads one knowledge-base item; returns the provider's document id. */
  syncKbItem(ctx: ProviderContext, item: KbDoc): Promise<{ providerDocId: string }>;
  deleteKbItem(ctx: ProviderContext, providerDocId: string): Promise<void>;

  buyNumber?(ctx: ProviderContext, input: BuyNumberInput): Promise<NumberRef>;
  importNumber(ctx: ProviderContext, spec: NumberImportSpec): Promise<NumberRef>;
  releaseNumber(ctx: ProviderContext, providerNumberId: string): Promise<void>;
  /** Routes inbound calls of a number to an agent (null = no inbound agent). */
  setInboundAgent(ctx: ProviderContext, providerNumberId: string, providerAgentId: string | null, inboundWebhookUrl: string): Promise<void>;

  /** Places an outbound phone call. Returns the provider's call id. */
  startCall(ctx: ProviderContext, input: StartCallInput): Promise<{ providerCallId: string }>;
  /** Browser test call / widget session. */
  createWebCall(ctx: ProviderContext, agent: AgentSpec, metadata: CallTags): Promise<WebCallSession>;

  /** True when the webhook's signature matches (constant-time). `nowMs` checks timestamp tolerance. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string, secret: string, nowMs?: number): Promise<boolean>;
  /** Webhook body → normalised events ([] for events we ignore). Never throws on unknown shapes. */
  parseWebhook(body: unknown): NormalizedCallEvent[];

  getCall(ctx: ProviderContext, providerCallId: string): Promise<ProviderCallDetails | null>;
  /** Deletes the provider's copy of a finished call (transcript, recording); erasure requests. Already gone = success. */
  deleteCall?(ctx: ProviderContext, providerCallId: string): Promise<void>;
  /** The call's audio (null = no recording). */
  fetchRecording(ctx: ProviderContext, providerCallId: string): Promise<RecordingStream | null>;
  /** Calls ended since `sinceIso` (nightly reconciliation of missed webhooks). */
  listCallsSince?(ctx: ProviderContext, sinceIso: string, limit: number): Promise<ProviderCallDetails[]>;
}

// ── Contacts, consent and DNC ──

export const CONTACT_SOURCES = ["manual", "csv", "api", "call", "widget"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/**
 * Consent types (research notes in PRODUCT-9-TECH.md §3, not legal advice):
 * - pewc:      prior express WRITTEN consent (US telemarketing with an artificial/AI voice)
 * - pec:       prior express consent (US informational calls to mobiles)
 * - ai_voice:  explicit consent to automated / AI-voice calls (UK PECR reg. 19, EU ePrivacy 13(1))
 * - marketing: general marketing consent (GDPR Art. 6(1)(a))
 * - recording: consent to being recorded (all-party consent states)
 */
export const CONSENT_TYPES = ["pewc", "pec", "ai_voice", "marketing", "recording"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_SOURCES = ["web_form", "csv", "api", "verbal", "paper", "inbound_call", "other"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export interface Consent {
  id: number;
  type: ConsentType;
  /** The campaign purpose the consent covers ("any" = both). */
  purpose: CampaignPurpose | "any";
  source: ConsentSource;
  sourceUrl: string;
  capturedAt: string;
  ip: string;
  /** The exact consent wording the person agreed to. */
  textSnapshot: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export const DNC_SCOPES = ["workspace", "global"] as const;
export type DncScope = (typeof DNC_SCOPES)[number];

export const DNC_REASONS = ["opt_out", "manual", "national_dnc", "tps", "complaint", "import", "admin"] as const;
export type DncReason = (typeof DNC_REASONS)[number];

export interface DncMatch {
  scope: DncScope;
  reason: DncReason;
  expiresAt: string | null;
}

// ── Campaigns ──

/** telemarketing needs written consent (pewc / ai_voice); informational (reminders, service) needs pec or better. */
export const CAMPAIGN_PURPOSES = ["informational", "telemarketing"] as const;
export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "running", "paused", "completed", "canceled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** One contact of a campaign. The engine leases rows (lease_token / lease_until) before dialing. */
export const CAMPAIGN_CONTACT_STATES = ["pending", "dialing", "in_call", "retry", "completed", "failed", "skipped", "canceled"] as const;
export type CampaignContactState = (typeof CAMPAIGN_CONTACT_STATES)[number];

/** Outcomes that may be retried (per campaign: campaigns.retry_on). */
export const RETRYABLE_OUTCOMES = ["no_answer", "busy", "voicemail", "failed"] as const;
export type RetryableOutcome = (typeof RETRYABLE_OUTCOMES)[number];

/** A daily calling window in the callee's (or the campaign's) local time. */
export interface CallingWindow {
  start: string;
  end: string;
  days: number[];
}

// ── Compliance ──

/** Stored as JSON in compliance_settings.settings; read through normalizeComplianceSettings(). */
export interface ComplianceSettings {
  /** Legal business name said at the start of every call ("" = the workspace name). */
  businessName: string;
  /** Callback number given on request (E.164). */
  callbackNumber: string;
  /** Calling hours in the callee's local time (default 08:00–21:00, every day). */
  callingHours: CallingWindow;
  /** Apply stricter US state rules (FL/OK 8–20, TX 9–21 and Sunday from noon, AL/LA/MS no Sundays, RI weekdays 9–18). */
  usStatePresets: boolean;
  /** Days without outbound calls ("YYYY-MM-DD", callee local). */
  holidays: string[];
  /** Calls to the same number: at most this many per rolling 24 h (0 = no cap) … */
  maxCallsPer24h: number;
  /** … and per rolling 30 days (0 = no cap). */
  maxCallsPer30d: number;
  /** Play the recording notice (forced on whenever an agent records). */
  recordingDisclosure: boolean;
  recordingDisclosureText: string;
  /** India: outbound telemarketing to +91 is blocked unless a DLT-registered route is set. */
  indiaDltRoute: "" | "140" | "1600";
  /** EU/UK/EEA: automated (AI) calls need ai_voice or marketing consent whatever the purpose. */
  euRequireConsent: boolean;
  /** ISO countries never dialed. */
  blockedCountries: string[];
  /** ISO countries allowed ([] = every country not blocked). */
  allowedCountries: string[];
  /** Extra opt-out phrases (any language) on top of the built-in ones. */
  optOutPhrases: string[];
  /** Auto-delete after N days (0 = keep). */
  recordingRetentionDays: number;
  transcriptRetentionDays: number;
}

/** Outbound approval of a workspace (KYC + acceptable use + admin review). */
export const OUTBOUND_STATES = ["not_requested", "pending", "approved", "rejected", "suspended"] as const;
export type OutboundState = (typeof OUTBOUND_STATES)[number];

export const DIAL_BLOCK_REASONS = [
  "invalid_number",
  "country_blocked",
  "india_dlt_required",
  "dnc_workspace",
  "dnc_global",
  "opted_out",
  "no_consent",
  "consent_revoked",
  "consent_expired",
  "eu_consent_required",
  "outside_hours",
  "holiday",
  "frequency_24h",
  "frequency_30d",
  "campaign_inactive",
  "outbound_disabled",
] as const;
export type DialBlockReason = (typeof DIAL_BLOCK_REASONS)[number];

export interface DialCheckResult {
  ok: boolean;
  reasons: DialBlockReason[];
  /** For time-based blocks only: the earliest instant the call could be retried (ISO), else null. */
  retryAt: string | null;
}

// ── Credits ──

export const CREDIT_KINDS = ["purchase", "reserve", "settle", "release", "adjustment", "included"] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];

/** How call seconds are rounded before billing (Admin → Billing). */
export const BILLING_ROUNDINGS = ["per_second", "per_6s", "per_minute"] as const;
export type BillingRounding = (typeof BILLING_ROUNDINGS)[number];

export interface AutoRecharge {
  enabled: boolean;
  /** Recharge when the balance falls below this (micros). */
  thresholdMicros: number;
  /** Amount bought each time (micros). */
  amountMicros: number;
}

// ── Workspaces and members ──

/**
 * Roles in a workspace, lowest to highest rank (requireWorkspace(wid, minRole) compares ranks):
 * - viewer:  reads calls, transcripts, analytics and settings; changes nothing
 * - editor:  builds agents, knowledge bases and tools, manages contacts and drafts campaigns
 * - admin:   editor + numbers, campaigns (start/stop), billing, compliance, members (not the
 *            owner), notifications, API keys and settings
 * - owner:   admin + deletes the workspace; the owner's plan sets the workspace's limits
 */
export const WORKSPACE_ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Roles that can be given to a member or an invite (there is exactly one owner). */
export const ASSIGNABLE_ROLES = ["admin", "editor", "viewer"] as const satisfies readonly WorkspaceRole[];
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const WORKSPACE_CAPABILITIES = [
  "view",
  "agents.manage",
  "contacts.manage",
  "campaigns.edit",
  "campaigns.run",
  "numbers.manage",
  "billing.manage",
  "compliance.manage",
  "members.manage",
  "settings.manage",
  "workspace.delete",
] as const;
export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

/** White-label branding of the widget and notification emails (plan option). */
export interface WorkspaceBranding {
  /** "" = the workspace name. */
  companyName: string;
  /** Logo URL or upload path ("" = none). */
  logo: string;
  /** #rrggbb ("" = the platform colour). */
  color: string;
}

/** Stored as JSON in workspaces.settings; always read through normalizeWorkspaceSettings(). */
export interface WorkspaceSettings {
  /** Country assumed for phone numbers typed without a +country code (ISO). */
  defaultCountry: string;
  /** Default spoken language of new agents (BCP-47). */
  defaultLanguage: string;
  /** First day of the week in charts and calling windows (1 = Monday, 7 = Sunday). */
  weekStart: 1 | 7;
  branding: WorkspaceBranding;
}

// ── Notification channels (where workspace notifications go) ──

export const NOTIFY_CHANNEL_TYPES = ["email", "webhook", "slack", "discord", "telegram", "teams"] as const;
export type NotifyChannelType = (typeof NOTIFY_CHANNEL_TYPES)[number];

export interface NotifyConfigByType {
  /** Comma-separated addresses. */
  email: { to: string };
  /** Payload signed with HMAC-SHA256 of `secret` in the X-Dialzen-Signature header. */
  webhook: { url: string; secret: string };
  slack: { webhookUrl: string };
  discord: { webhookUrl: string };
  teams: { webhookUrl: string };
  telegram: { botToken: string; chatId: string };
}
export type NotifyConfig<T extends NotifyChannelType = NotifyChannelType> = NotifyConfigByType[T];

/** Events sent to notification channels. */
export const NOTIFY_EVENTS = [
  "call_completed",
  "call_failed",
  "booking_made",
  "opt_out",
  "campaign_finished",
  "low_balance",
  "agent_sync_failed",
  "outbound_decided",
  "quota_warning",
  "quota_reached",
  "test",
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

/** Events a new notification channel receives (call_completed is noisy, so it's opt-in). */
export const DEFAULT_NOTIFY_EVENTS: readonly NotifyEvent[] = [
  "call_failed",
  "booking_made",
  "opt_out",
  "campaign_finished",
  "low_balance",
  "agent_sync_failed",
  "outbound_decided",
  "quota_warning",
  "quota_reached",
];

/** What every notification channel receives (also the JSON body of webhooks). Keys are snake_case, like the REST API's, `data` keys included. */
export interface NotifyPayload {
  event: NotifyEvent;
  workspace: { id: number; name: string } | null;
  /** Human-readable one-line summary. */
  message: string;
  /** Facts behind the notification (agent, caller, duration, balance, used, limit…). */
  data: Record<string, number | string>;
  /** Link to the relevant dashboard page. */
  url: string;
  /** ISO time the notification was sent. */
  sent_at: string;
}
