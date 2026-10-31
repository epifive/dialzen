import "server-only";
import crypto from "node:crypto";
import type { Insertable } from "kysely";
import { encryptWith } from "../crypto";
import { AGENT_LANGUAGES } from "@/voice/format";
import { normalizeAgentSettings, normalizeComplianceSettings, normalizeToolConfig, normalizeWorkspaceSettings } from "@/voice/normalize";
import { CALL_RULES, getTemplate } from "@/voice/templates";
import type { AnalysisField, ToolKind } from "@/voice/types";
import { bayArea, chicago, indiaMobile, makePerson, PhonePool, uaeMobile, ukDrama, type NameSet } from "./demo-voice-people";
import { DENTAL, HARBOR_HOURS, type Hours, type Person } from "./demo-voice-scripts";
import type { Database } from "./schema";

/**
 * Workspaces, agents, tools, knowledge bases, numbers, contacts, consent records, lists, DNC,
 * compliance, KYC, notification channels and API keys of the voice demo seed (demo-voice.ts
 * generates the call history on top). Rows are built in memory with explicit ids.
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MIN = 60_000;
export const iso = (ms: number) => new Date(ms).toISOString();

export type Row<T extends keyof Database> = Insertable<Database[T]>;

export const TABLES = [
  "workspaces",
  "workspace_members",
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
  "payments",
  "wallets",
  "credit_transactions",
  "number_rentals",
  "compliance_settings",
  "kyc_requests",
  "api_keys",
  "usage_monthly",
  "notify_channels",
  "alert_log",
  "audit_log",
] as const;
export type Table = (typeof TABLES)[number];
export type Rows = { [T in Table]: Row<T>[] };

/** Tables whose ids are set explicitly (continuing after existing rows). */
export const ID_TABLES = ["workspaces", "workspace_members", "agents", "kb_items", "tools", "phone_numbers", "contacts", "contact_lists", "consents", "dnc_entries", "campaigns", "campaign_contacts", "calls", "payments", "credit_transactions", "number_rentals", "kyc_requests", "api_keys", "notify_channels", "alert_log", "audit_log"] as const;

export interface AuditDraft {
  ms: number;
  row: Omit<Row<"audit_log">, "id" | "created_at">;
}

export interface Seed {
  r: () => number;
  NOW: number;
  adminId: number;
  secret: string;
  siteUrl: string;
  /** Monthly number rental of customers' numbers (micros). */
  rentalMicros: number;
  id: (table: (typeof ID_TABLES)[number]) => number;
  rows: Rows;
  audits: AuditDraft[];
  audit: (ws: number | null, actor: { type: "user" | "api" | "system" | "admin" | "provider"; id?: number | null }, action: string, entityType: string, entityId: string | number, data: Record<string, unknown>, ms: number, ip?: string) => void;
  chance: (p: number) => boolean;
  pick: <T>(list: readonly T[]) => T;
  between: (a: number, b: number) => number;
  token: (n: number) => string;
}

export interface AgentDef {
  id: number;
  ws: WsDef;
  key: string;
  name: string;
  language: string;
  firstMessage: string;
  maxDurationSec: number;
  voicemailMessage: string;
  tools: { book?: string; crm?: string; transfer?: string; lookup?: string };
}

export interface NumberDef {
  id: number;
  ws: WsDef;
  e164: string;
  label: string;
  createdMs: number;
  monthlyMicros: number;
}

export interface ContactDef {
  id: number;
  ws: WsDef;
  phone: string;
  person: Person;
  tz: string;
  language: string;
  createdMs: number;
  hasConsent: boolean;
  /** Consent rows (ids) to revoke on an opt-out. */
  consentIds: number[];
  fields: Record<string, string>;
  tags: string[];
  optedOutMs: number | null;
  lastCalledMs: number | null;
  callsCount: number;
  set: NameSet;
  source: Row<"contacts">["source"];
  state: string;
  country: string;
}

export interface WsDef {
  id: number;
  key: "brightline" | "harbor" | "sharma" | "pinecrest";
  name: string;
  ownerId: number;
  ownerIsAdmin: boolean;
  tz: string;
  createdMs: number;
  /** Plan minutes per month (-1 = unlimited, the admin). */
  includedMin: number;
  hours: Hours;
  agents: Record<string, AgentDef>;
  numbers: Record<string, NumberDef>;
  contacts: ContactDef[];
  lists: Record<string, { id: number; members: ContactDef[] }>;
  channels: { email?: number; webhook?: number; emailEvents: string[]; webhookEvents: string[] };
  pool: PhonePool;
  nameSet: NameSet;
}

const field = (key: string, label: string, type: AnalysisField["type"], description: string, options: string[] = [], required = false): AnalysisField => ({ key, label, type, description, options, required });

export const supports = (lang: string) => AGENT_LANGUAGES.some((l) => l.tag.toLowerCase().startsWith(`${lang}-`));

/** "Hi {{contact.first_name|there}}" → "Hi Emily" (or the fallback). */
export function renderGreeting(text: string, first: string | null, business: string): string {
  return text.replace(/\{\{\s*contact\.first_name\s*\|\s*([^}]*)\}\}/g, (_m, fb: string) => first || fb.trim()).replace(/\{\{\s*business_name\s*\}\}/g, business);
}

// ── Workspaces ──

export interface People {
  admin: { id: number; name: string };
  harbor: { id: number; includedMin: number } | null;
  sharma: { id: number; includedMin: number } | null;
  pinecrest: { id: number; includedMin: number } | null;
  team: number[];
  adminHasPersonal: boolean;
}

function workspace(s: Seed, def: Omit<WsDef, "id" | "agents" | "numbers" | "contacts" | "lists" | "channels">, personal: boolean, settings: Record<string, unknown>): WsDef {
  const ws: WsDef = { ...def, id: s.id("workspaces"), agents: {}, numbers: {}, contacts: [], lists: {}, channels: { emailEvents: [], webhookEvents: [] } };
  s.rows.workspaces.push({ id: ws.id, owner_id: def.ownerId, name: def.name, timezone: def.tz, settings: JSON.stringify(normalizeWorkspaceSettings(settings)), is_personal: personal ? 1 : 0, created_at: iso(def.createdMs), updated_at: iso(def.createdMs + 2 * HOUR) });
  s.rows.workspace_members.push({ id: s.id("workspace_members"), workspace_id: ws.id, user_id: def.ownerId, role: "owner", created_at: iso(def.createdMs) });
  return ws;
}

// ── Agents, tools, knowledge base ──

interface AgentInput {
  key: string;
  name: string;
  template: string;
  language: string;
  voiceId: string;
  voiceName: string;
  firstMessage: string;
  prompt: string;
  settings: Record<string, unknown>;
  createdMs: number;
  tools: AgentDef["tools"];
  toolIds: number[];
}

function agent(s: Seed, ws: WsDef, a: AgentInput, adminOrOwner: number): AgentDef {
  const id = s.id("agents");
  const tpl = getTemplate(a.template);
  const settings = normalizeAgentSettings({ ...(tpl?.settings ?? {}), analysisFields: tpl?.analysisFields ?? [], ...a.settings });
  const synced = a.createdMs + 40_000;
  s.rows.agents.push({
    id,
    workspace_id: ws.id,
    name: a.name,
    template: a.template,
    status: "active",
    provider: "simulated",
    provider_agent_id: `sim_agent_${id}`,
    provider_meta: JSON.stringify({ tools: String(a.toolIds.length), kb: "0" }),
    sync_status: "synced",
    sync_error: null,
    synced_at: iso(synced),
    sync_key_source: "platform",
    sync_account: "simulated",
    language: a.language,
    voice_id: a.voiceId,
    voice_name: a.voiceName,
    first_message: a.firstMessage,
    system_prompt: `${a.prompt.trim()}\n\n${CALL_RULES}`,
    llm: "",
    settings: JSON.stringify(settings),
    tool_secret: crypto.randomBytes(24).toString("base64url").slice(0, 32),
    created_by: adminOrOwner,
    created_at: iso(a.createdMs),
    updated_at: iso(synced),
  });
  for (const toolId of a.toolIds) s.rows.agent_tools.push({ agent_id: id, tool_id: toolId, workspace_id: ws.id, created_at: iso(a.createdMs + 20_000) });
  s.audit(ws.id, { type: "user", id: adminOrOwner }, "agent.created", "agent", id, { name: a.name, template: a.template, provider: "simulated" }, a.createdMs);
  const def: AgentDef = { id, ws, key: a.key, name: a.name, language: a.language, firstMessage: a.firstMessage, maxDurationSec: settings.maxDurationSec, voicemailMessage: settings.voicemailAction === "leave_message" ? settings.voicemailMessage : "", tools: a.tools };
  ws.agents[a.key] = def;
  return def;
}

function tool(s: Seed, ws: WsDef, kind: ToolKind, name: string, description: string, config: unknown, createdMs: number, userId: number, lastUsedMs: number | null): number {
  const id = s.id("tools");
  s.rows.tools.push({
    id,
    workspace_id: ws.id,
    kind,
    name,
    description,
    config: encryptWith(s.secret, JSON.stringify(normalizeToolConfig(kind, config)), "tool-config"),
    status: "active",
    last_error: null,
    last_used_at: lastUsedMs ? iso(lastUsedMs) : null,
    created_by: userId,
    created_at: iso(createdMs),
    updated_at: iso(createdMs),
  });
  return id;
}

function kb(s: Seed, ws: WsDef, name: string, content: string, createdMs: number, userId: number): void {
  const id = s.id("kb_items");
  s.rows.kb_items.push({
    id,
    workspace_id: ws.id,
    agent_id: null,
    kind: "text",
    name,
    url: null,
    media_id: null,
    content,
    size_bytes: Buffer.byteLength(content, "utf8"),
    provider: "simulated",
    provider_doc_id: `sim_doc_${id}`,
    sync_account: "simulated",
    status: "ready",
    error: null,
    created_at: iso(createdMs),
    updated_at: iso(createdMs + MIN),
  });
  s.audit(ws.id, { type: "user", id: userId }, "kb.added", "kb_item", id, { kind: "text", name, agentId: null }, createdMs);
}

function phoneNumber(s: Seed, ws: WsDef, n: { key: string; e164: string; country: string; label: string; inbound: number | null; outbound: number | null; outboundEnabled: boolean; cap: number; monthly: number; createdMs: number; userId: number; kyc?: "not_required" | "approved" }): NumberDef {
  const id = s.id("phone_numbers");
  s.rows.phone_numbers.push({
    id,
    workspace_id: ws.id,
    e164: n.e164,
    country: n.country,
    label: n.label,
    provider: "simulated",
    carrier: "simulated",
    provider_number_id: `sim_num_${n.e164.slice(1)}`,
    credentials: "",
    inbound_agent_id: n.inbound,
    outbound_agent_id: n.outbound,
    outbound_enabled: n.outboundEnabled ? 1 : 0,
    kyc_status: n.kyc ?? "not_required",
    daily_dial_cap: n.cap,
    monthly_price_micros: n.monthly,
    status: "active",
    last_error: null,
    released_at: null,
    created_by: n.userId,
    created_at: iso(n.createdMs),
    updated_at: iso(n.createdMs + HOUR),
  });
  ws.pool.reserve(n.e164);
  s.audit(ws.id, { type: "user", id: n.userId }, "number.added", "number", id, { e164: n.e164, provider: "simulated", carrier: "simulated" }, n.createdMs);
  const def: NumberDef = { id, ws, e164: n.e164, label: n.label, createdMs: n.createdMs, monthlyMicros: n.monthly };
  ws.numbers[n.key] = def;
  return def;
}

// ── Contacts and consent ──

interface ConsentSpec {
  type: "pec" | "pewc" | "ai_voice";
  purpose: "any" | "informational" | "telemarketing";
  source: "paper" | "web_form" | "inbound_call" | "csv";
  url: string;
  text: string;
}

function contact(s: Seed, ws: WsDef, c: { set: NameSet; phone: string; tz: string; state: string; country: string; language: string; createdMs: number; source: "csv" | "manual" | "widget" | "api"; fields: Record<string, string>; tags: string[]; consent: ConsentSpec | null; consentMs: number; emailDomain?: string }): ContactDef {
  const person = makePerson(s.r, c.set, c.phone, c.emailDomain);
  const id = s.id("contacts");
  const def: ContactDef = { id, ws, phone: c.phone, person, tz: c.tz, language: c.language, createdMs: c.createdMs, hasConsent: Boolean(c.consent), consentIds: [], fields: c.fields, tags: c.tags, optedOutMs: null, lastCalledMs: null, callsCount: 0, set: c.set, source: c.source, state: c.state, country: c.country };
  if (c.consent) {
    const cid = s.id("consents");
    def.consentIds.push(cid);
    const web = c.consent.source === "web_form";
    s.rows.consents.push({
      id: cid,
      workspace_id: ws.id,
      contact_id: id,
      phone_e164: c.phone,
      type: c.consent.type,
      purpose: c.consent.purpose,
      source: c.consent.source,
      source_url: c.consent.url,
      captured_at: iso(c.consentMs),
      ip: web ? `${s.pick(["198.51.100", "203.0.113", "192.0.2"])}.${Math.floor(s.between(2, 250))}` : "",
      user_agent: web ? s.pick(["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"]) : "",
      text_snapshot: c.consent.text,
      expires_at: null,
      revoked_at: null,
      revoked_reason: null,
      created_by: null,
      created_at: iso(Math.max(c.consentMs, c.createdMs)),
    });
  }
  ws.contacts.push(def);
  return def;
}

/** Contact rows, written once the call history has set opt-outs and call counts. */
export function contactRows(ws: WsDef): Row<"contacts">[] {
  return ws.contacts.map((c) => {
    const updated = Math.max(c.createdMs, c.optedOutMs ?? 0, c.lastCalledMs ?? 0);
    return {
      id: c.id,
      workspace_id: ws.id,
      phone_e164: c.phone,
      first_name: c.person.first,
      last_name: c.person.last,
      email: c.person.email,
      company: "",
      country: c.country,
      timezone: c.tz,
      state: c.state,
      language: c.language,
      fields: JSON.stringify(c.fields),
      tags: JSON.stringify(c.tags),
      source: c.source,
      opted_out_at: c.optedOutMs ? iso(c.optedOutMs) : null,
      last_called_at: c.lastCalledMs ? iso(c.lastCalledMs) : null,
      calls_count: c.callsCount,
      created_at: iso(c.createdMs),
      updated_at: iso(updated),
    };
  });
}

function list(s: Seed, ws: WsDef, key: string, name: string, description: string, members: ContactDef[], createdMs: number): void {
  const id = s.id("contact_lists");
  s.rows.contact_lists.push({ id, workspace_id: ws.id, name, description, created_at: iso(createdMs), updated_at: iso(createdMs) });
  for (const m of members) s.rows.list_members.push({ list_id: id, contact_id: m.id, workspace_id: ws.id, added_at: iso(createdMs) });
  ws.lists[key] = { id, members };
}

export function dnc(s: Seed, ws: WsDef | null, e: { phone: string; reason: string; source: string; listRef?: string; note?: string; expiresMs?: number | null; createdMs: number; by: number | null }): void {
  s.rows.dnc_entries.push({
    id: s.id("dnc_entries"),
    scope: ws ? "workspace" : "global",
    workspace_id: ws ? ws.id : 0,
    phone_e164: e.phone,
    reason: e.reason,
    source: e.source,
    list_ref: e.listRef ?? "",
    note: e.note ?? "",
    expires_at: e.expiresMs ? iso(e.expiresMs) : null,
    created_by: e.by,
    created_at: iso(e.createdMs),
  });
}

function compliance(s: Seed, ws: WsDef, c: { settings: Record<string, unknown>; state: "not_requested" | "pending" | "approved" | "rejected"; aupMs: number | null; by: number }): void {
  s.rows.compliance_settings.push({
    workspace_id: ws.id,
    settings: JSON.stringify(normalizeComplianceSettings(c.settings)),
    outbound_state: c.state,
    aup_accepted_at: c.aupMs ? iso(c.aupMs) : null,
    aup_accepted_by: c.aupMs ? c.by : null,
    kill_switch: 0,
    kill_reason: null,
    outbound_paused: 0,
    updated_at: iso((c.aupMs ?? ws.createdMs) + 2 * DAY),
  });
  if (c.aupMs) s.audit(ws.id, { type: "user", id: c.by }, "aup.accepted", "workspace", ws.id, {}, c.aupMs, "203.0.113.24");
}

function kyc(s: Seed, ws: WsDef, k: { business: string; address: string; website: string; country: string; useCase: string; consent: string; volume: string; script: string; submittedMs: number; by: number; decision: "approved" | "rejected" | null; note: string; reviewMs?: number }): void {
  const id = s.id("kyc_requests");
  s.rows.kyc_requests.push({
    id,
    workspace_id: ws.id,
    business_name: k.business,
    address: k.address,
    website: k.website,
    country: k.country,
    use_case: k.useCase,
    consent_method: k.consent,
    sample_script: k.script,
    expected_volume: k.volume,
    status: k.decision ?? "pending",
    review_note: k.decision ? k.note : null,
    reviewed_by: k.decision ? s.adminId : null,
    reviewed_at: k.decision && k.reviewMs ? iso(k.reviewMs) : null,
    submitted_by: k.by,
    created_at: iso(k.submittedMs),
    updated_at: iso(k.reviewMs ?? k.submittedMs),
  });
  s.audit(ws.id, { type: "user", id: k.by }, "outbound.requested", "kyc_request", id, { business: k.business, country: k.country }, k.submittedMs);
  if (k.decision && k.reviewMs) s.audit(ws.id, { type: "admin", id: s.adminId }, `outbound.${k.decision}`, "kyc_request", id, { note: k.note }, k.reviewMs);
}

function channel(s: Seed, ws: WsDef, type: "email" | "webhook", name: string, config: Record<string, string>, events: string[], createdMs: number, by: number): number {
  const id = s.id("notify_channels");
  s.rows.notify_channels.push({ id, workspace_id: ws.id, created_by: by, type, name, config: JSON.stringify(config), events: JSON.stringify(events), is_active: 1, created_at: iso(createdMs), updated_at: iso(createdMs) });
  if (type === "email") {
    ws.channels.email = id;
    ws.channels.emailEvents = events;
  } else {
    ws.channels.webhook = id;
    ws.channels.webhookEvents = events;
  }
  return id;
}

function apiKey(s: Seed, ws: WsDef, userId: number, name: string, createdMs: number, lastUsedMs: number): void {
  const key = `dz_${crypto.randomBytes(30).toString("base64url").replace(/[-_]/g, "x").slice(0, 40)}`;
  s.rows.api_keys.push({ id: s.id("api_keys"), workspace_id: ws.id, user_id: userId, name, key_hash: crypto.createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 10), last_used_at: iso(lastUsedMs), created_at: iso(createdMs) });
}

// ── Brightline Dental ──

const DENTAL_KB = {
  services: `Brightline Dental: services and prices (without insurance)
- Cleaning and exam (adults): $145. Children under 14: $95.
- New patient visit (exam, full x-rays and cleaning, about 90 minutes): $210.
- Emergency exam with one x-ray: $95. We keep emergency slots every weekday.
- Fillings (tooth-colored): from $180 per surface.
- Crowns (porcelain): $1,250. Bite adjustments after a crown are free within 30 days.
- In-office whitening (90 minutes): $399. Take-home whitening trays with gel: $249.
- Invisalign consultation: free. Treatment from $4,200, monthly plans available.
- Night guards: $395.
Dentists: Dr. Anika Patel (general and cosmetic) and Dr. James Nguyen (general, emergencies, crowns). Hygienists: Maria, Kevin and Alyssa.`,
  insurance: `Insurance and payment policy
- In network (PPO): Delta Dental PPO, Cigna Dental PPO, MetLife PDP, Aetna Dental PPO, Guardian Dental.
- We do not accept HMO plans (Kaiser Dental HMO, DeltaCare USA HMO). Patients with other PPO plans can be seen out of network; we send the claim for them.
- Preventive care (cleanings, exams, x-rays) is usually covered at 100% by PPO plans, but coverage depends on the plan.
- Payment: all major cards, HSA and FSA cards, and CareCredit (6 or 12 months interest-free on treatments over $300).
- Cancellations: please give 24 hours notice. Missed appointments without notice are charged $50.
- Billing and claim questions are handled by the front desk team (transfer the call during opening hours).`,
  hours: `Clinic hours and location
- Address: 1840 Union Street, San Francisco, CA 94123 (between Laguna and Octavia).
- Hours: Monday to Wednesday 8 AM to 6 PM, Thursday 8 AM to 7 PM, Friday 8 AM to 4 PM, Saturday 9 AM to 2 PM, closed on Sunday.
- Parking: the Union Street garage next door, validated for 2 hours. Bus lines 41 and 45 stop at the corner.
- After hours: the AI assistant takes urgent messages for the on-call dentist (swelling, trauma, a knocked-out tooth). For difficulty breathing or swallowing, call 911.
- Spanish-speaking patients can call our Spanish line or ask for Lucía at the front desk.`,
};

const PATIENT_CONSENT: Record<"paper" | "web" | "verbal", ConsentSpec> = {
  paper: { type: "pec", purpose: "informational", source: "paper", url: "", text: "Patient intake form, section 6: I agree that Brightline Dental may call or text me at the number above about my appointments, recalls and care, including with automated or AI-voice calls. I can opt out at any time." },
  web: { type: "pewc", purpose: "any", source: "web_form", url: "https://brightlinedental.example/new-patient", text: "By checking this box I agree that Brightline Dental may call me at the number above, including calls made with an artificial or AI voice, about appointments, recalls and offers. Consent is not a condition of any purchase. I can opt out at any time by telling the caller or replying STOP." },
  verbal: { type: "pec", purpose: "informational", source: "inbound_call", url: "", text: "Verbal consent given on a call with the front desk to receive appointment reminder and recall calls, including automated or AI-voice calls." },
};

export function seedBrightline(s: Seed, people: People): WsDef {
  const { NOW } = s;
  const admin = people.admin.id;
  const created = NOW - 62 * DAY - 5 * HOUR;
  const ws = workspace(s, { key: "brightline", name: "Brightline Dental", ownerId: admin, ownerIsAdmin: true, tz: "America/Los_Angeles", createdMs: created, includedMin: -1, hours: DENTAL.hours, pool: new PhonePool(s.r, bayArea), nameSet: "en" }, !people.adminHasPersonal, {
    defaultCountry: "US",
    defaultLanguage: "en-US",
    weekStart: 7,
    branding: { companyName: "Brightline Dental", logo: "", color: "#0e7490" },
  });
  // Team: an office manager (admin) and a hygienist (viewer).
  for (const [i, uid] of people.team.slice(0, 2).entries()) s.rows.workspace_members.push({ id: s.id("workspace_members"), workspace_id: ws.id, user_id: uid, role: i === 0 ? "admin" : "viewer", created_at: iso(created + (3 + i * 9) * DAY) });

  const toolMs = created + 3 * HOUR;
  const bookTool = tool(s, ws, "cal_com", "book_appointment", 'Checks free appointment times in the clinic calendar and books one. First call with action "availability" and a date, read the options to the caller, then call with action "book" and the chosen start time.', { apiKey: "cal_demo_brightline_7c41e9a2", eventTypeId: 1184207, timezone: ws.tz, apiBase: "" }, toolMs, admin, NOW - 40 * MIN);
  const crmTool = tool(s, ws, "webhook", "log_to_crm", "Saves the caller's details and what was agreed (booking, message, callback) to the patient CRM.", {
    url: "https://crm.example/hooks",
    method: "POST",
    headers: { "X-Api-Key": "demo-crm-key-brightline" },
    secret: "whsec_demo_brightline_crm",
    timeoutMs: 3000,
    parameters: [
      { name: "caller_name", type: "string", description: "The caller's full name.", required: true },
      { name: "phone", type: "string", description: "The caller's phone number.", required: false },
      { name: "reason", type: "string", description: "Why the caller called and what was agreed.", required: true },
      { name: "appointment_time", type: "string", description: "ISO time of the booked appointment, if any.", required: false },
    ],
  }, toolMs + MIN, admin, NOW - 40 * MIN);
  const transferTool = tool(s, ws, "transfer", "transfer_to_front_desk", "Transfers the call to the front desk team when the caller asks for a person, has a billing question or an urgent problem the agent can't handle.", { number: DENTAL.staffLine, mode: "warm", whisper: "Brightline AI assistant here with a patient on the line." }, toolMs + 2 * MIN, admin, NOW - 26 * HOUR);

  const fdFields = [
    field("caller_name", "Caller name", "string", "The caller's full name, if given."),
    field("reason", "Reason for calling", "string", "One sentence describing why they called.", [], true),
    field("appointment_booked", "Appointment booked", "boolean", "True when an appointment was booked or moved."),
    field("appointment_time", "Appointment time", "date", "Date and time of the booked appointment, ISO-8601."),
    field("service", "Service", "string", "Cleaning, new patient visit, emergency exam, whitening…"),
    field("new_patient", "New patient", "boolean", "True when the caller has never been to the clinic."),
    field("insurance", "Insurance", "string", "The dental insurance the caller mentioned."),
    field("callback_requested", "Callback requested", "boolean", "True when the caller asked to be called back."),
    field("message", "Message", "string", "The message for the team, if any."),
  ];
  const site = (() => {
    try {
      return s.siteUrl ? new URL(s.siteUrl).hostname.toLowerCase() : "";
    } catch {
      return "";
    }
  })();
  const domains = [...new Set([site, "brightlinedental.example", "localhost", "127.0.0.1"].filter(Boolean))];
  agent(
    s,
    ws,
    {
      key: "frontDesk",
      name: "Front desk",
      template: "receptionist",
      language: "en-US",
      voiceId: "sim-ava",
      voiceName: "Ava · warm, conversational",
      firstMessage: "Thanks for calling Brightline Dental. I'm the clinic's AI assistant. I can book or change appointments and answer questions about our services. How can I help you today?",
      prompt: `You are the front-desk receptionist of {{business_name}}, a family dental clinic in San Francisco with two dentists and three hygienists.

## Your job
- Answer questions about services, prices, insurance, hours and parking from the knowledge base.
- Book, move or cancel appointments with the booking tool: ask for the full name, offer two or three free times, confirm the day and time, then save the result with the CRM tool.
- Urgent problems (swelling, trauma, severe pain): offer the first emergency slot. Difficulty breathing or swallowing: transfer to the front desk team and mention 911.
- Billing and claim questions, or a caller who wants a person: transfer to the front desk team during opening hours; after hours, take a message for the next morning.

## Style
Warm, calm and efficient. Most calls should take two or three minutes.`,
      settings: { maxDurationSec: 600, silenceTimeoutSec: 20, interruptionSensitivity: "medium", temperature: 0.4, transferNumber: DENTAL.staffLine, recording: true, businessName: "Brightline Dental", successCriteria: "The caller's question was answered, an appointment was booked or moved, or a complete message was taken.", analysisFields: fdFields, widget: { enabled: true, allowedDomains: domains, title: "Talk to Brightline", color: "#0e7490", position: "bottom-right" } },
      createdMs: created + 4 * HOUR,
      tools: { book: "book_appointment", crm: "log_to_crm", transfer: "transfer_to_front_desk" },
      toolIds: [bookTool, crmTool, transferTool],
    },
    admin,
  );
  agent(
    s,
    ws,
    {
      key: "recall",
      name: "Recall reminders",
      template: "reminder_confirmation",
      language: "en-US",
      voiceId: "sim-noah",
      voiceName: "Noah · calm, clear",
      firstMessage: "Hi {{contact.first_name|there}}, this is the AI assistant of Brightline Dental, calling about your next dental visit. Do you have a minute?",
      prompt: `You call existing patients of {{business_name}} who agreed to receive reminder and recall calls.

## Two kinds of calls
- The contact has an appointment on file ({{contact.appointment_time}}): remind them of it, confirm it, or move it with the booking tool.
- No appointment on file: they are due for their six-month cleaning. Offer to book it with the booking tool.

## Notes
- Confirm you are speaking with {{contact.first_name|the patient}} before sharing any details. If someone else answers, only ask them to have the patient call back.
- If you reach voicemail, leave the short message configured for this agent, without private details.
- A clear "no" or "don't call me" ends the call politely. Keep calls under two minutes.`,
      settings: { maxDurationSec: 240, voicemailAction: "leave_message", voicemailMessage: "Hi {{contact.first_name|there}}, this is the AI assistant of Brightline Dental, calling about your next dental visit. Please call us back at (415) 555-0100 or book online. Thank you!", businessName: "Brightline Dental", successCriteria: "A cleaning was booked, or the appointment was confirmed, moved or cancelled.", analysisFields: [field("appointment_booked", "Appointment booked", "boolean", "True when a cleaning was booked on the call."), field("appointment_time", "Appointment time", "date", "Date and time of the booked cleaning, ISO-8601."), field("confirmed", "Confirmed", "boolean", "True when the patient confirmed the appointment on file.", [], true), field("rescheduled", "Rescheduled", "boolean", "True when the appointment was moved."), field("new_time", "New time", "date", "The new appointment time, ISO-8601, if moved."), field("cancel_requested", "Cancellation requested", "boolean", "True when the patient wants to cancel."), field("callback_requested", "Callback requested", "boolean", "True when the patient asked to be called back later.")] },
      createdMs: created + 6 * HOUR,
      tools: { book: "book_appointment" },
      toolIds: [bookTool],
    },
    admin,
  );
  if (supports("es")) {
    agent(
      s,
      ws,
      {
        key: "spanish",
        name: "Spanish line",
        template: "receptionist",
        language: "es-MX",
        voiceId: "sim-luna",
        voiceName: "Luna · multilingual",
        firstMessage: "Gracias por llamar a Brightline Dental. Soy el asistente de inteligencia artificial de la clínica y puedo ayudarle con citas y preguntas. ¿En qué le puedo ayudar?",
        prompt: `Eres la recepcionista en español de {{business_name}}, una clínica dental familiar en San Francisco. Responde siempre en español.

## Tu trabajo
- Responde preguntas sobre servicios, precios, seguros, horarios y estacionamiento con la base de conocimiento.
- Agenda, cambia o cancela citas con la herramienta de reservas.
- Si la persona quiere hablar con alguien, transfiere la llamada a Lucía en la recepción (habla español).`,
        settings: { maxDurationSec: 600, transferNumber: DENTAL.staffLine, businessName: "Brightline Dental", successCriteria: "La pregunta fue respondida o se agendó la cita.", analysisFields: fdFields.slice(0, 4) },
        createdMs: created + 9 * DAY,
        tools: { book: "book_appointment", transfer: "transfer_to_front_desk" },
        toolIds: [bookTool, transferTool],
      },
      admin,
    );
  }
  const kbMs = created + 5 * HOUR;
  kb(s, ws, "Services and prices", DENTAL_KB.services, kbMs, admin);
  kb(s, ws, "Insurance and payment policy", DENTAL_KB.insurance, kbMs + 4 * MIN, admin);
  kb(s, ws, "Clinic hours and location", DENTAL_KB.hours, kbMs + 7 * MIN, admin);

  phoneNumber(s, ws, { key: "main", e164: "+14155550100", country: "US", label: "Main line", inbound: ws.agents.frontDesk.id, outbound: ws.agents.recall.id, outboundEnabled: true, cap: 250, monthly: 0, createdMs: created + 7 * HOUR, userId: admin });
  phoneNumber(s, ws, { key: "spanish", e164: "+14155550147", country: "US", label: ws.agents.spanish ? "Línea en español" : "Second line", inbound: (ws.agents.spanish ?? ws.agents.frontDesk).id, outbound: null, outboundEnabled: false, cap: 100, monthly: 0, createdMs: created + 9 * DAY + HOUR, userId: admin });
  ws.pool.reserve(DENTAL.staffLine);

  // Patients: imported from the practice software, plus a few added later.
  const importMs = created + 6 * DAY;
  const insurance = [...DENTAL.insuranceIn, ...DENTAL.insuranceIn, "Self-pay"];
  for (let i = 0; i < 252; i++) {
    const spanish = i % 7 === 3;
    const later = i >= 236;
    const cMs = later ? importMs + (6 + Math.floor(s.r() * 45)) * DAY : importMs;
    const tz = spanish || s.r() < 0.92 ? "America/Los_Angeles" : s.pick(["America/Denver", "America/Phoenix", "America/New_York", "America/Chicago"]);
    const monthsAgo = 4 + Math.floor(s.r() * 14);
    const lastVisit = new Date(s.NOW - monthsAgo * 30 * DAY).toISOString().slice(0, 10);
    const x = s.r();
    const consent = i % 41 === 7 ? null : x < 0.62 ? PATIENT_CONSENT.paper : x < 0.88 ? PATIENT_CONSENT.web : PATIENT_CONSENT.verbal;
    const tags = ["patient", ...(monthsAgo >= 5 && monthsAgo <= 9 ? ["cleaning-due"] : []), ...(monthsAgo >= 16 ? ["lapsed"] : []), ...(spanish ? ["spanish"] : [])];
    contact(s, ws, {
      set: spanish ? "es" : "en",
      phone: ws.pool.take(),
      tz,
      state: tz === "America/Los_Angeles" ? "CA" : "",
      country: "US",
      language: spanish ? "es" : "en",
      createdMs: cMs,
      source: later ? s.pick(["manual", "widget", "api"] as const) : "csv",
      fields: { last_visit: lastVisit, insurance: s.pick(insurance), hygienist: s.pick(DENTAL.hygienists), patient_since: String(2016 + Math.floor(s.r() * 9)) },
      tags,
      consent,
      consentMs: later ? cMs : cMs - Math.floor(s.between(60, 900)) * DAY,
    });
  }
  s.audit(ws.id, { type: "user", id: admin }, "contacts.imported", "import", "patients-export.csv", { created: 236, updated: 0, list: null }, importMs);
  s.audit(ws.id, { type: "user", id: admin }, "consent.imported", "import", "patients-export.csv", { consents: ws.contacts.filter((c) => c.hasConsent && c.createdMs === importMs).length }, importMs + 2000);

  const english = ws.contacts.filter((c) => c.language === "en");
  const due = english.filter((c) => !c.tags.includes("lapsed")).slice(0, 140);
  list(s, ws, "due", "Patients due for cleaning", "Six-month recall: last cleaning 5 to 9 months ago.", due, importMs + 2 * HOUR);
  const nov = english.filter((c) => !due.slice(30).includes(c)).slice(0, 90);
  list(s, ws, "nov", `${monthName(s.NOW + 15 * DAY)} appointments`, "Patients with an appointment next month (reminder calls two weeks ahead).", nov, s.NOW - 4 * DAY);
  list(s, ws, "lapsed", "Lapsed patients (16+ months)", "No visit for 16 months or more: re-engagement offer.", english.filter((c) => c.tags.includes("lapsed")).slice(0, 40), s.NOW - 2 * DAY);

  compliance(s, ws, {
    settings: {
      businessName: "Brightline Dental",
      callbackNumber: "+14155550100",
      callingHours: { start: "09:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] },
      usStatePresets: true,
      holidays: holidays(s.NOW),
      maxCallsPer24h: 2,
      maxCallsPer30d: 6,
      recordingDisclosure: true,
      recordingDisclosureText: "This call may be recorded for quality and training.",
      euRequireConsent: true,
      allowedCountries: ["US"],
      optOutPhrases: ["take me off your list", "no me llamen", "quítenme de la lista"],
      recordingRetentionDays: 90,
      transcriptRetentionDays: 365,
    },
    state: "approved",
    aupMs: created + 26 * HOUR,
    by: admin,
  });
  s.audit(ws.id, { type: "user", id: admin }, "compliance.updated", "workspace", ws.id, { callingHours: "09:00-19:00 Mon-Sat", maxCallsPer24h: 2 }, created + 27 * HOUR);
  kyc(s, ws, {
    business: "Brightline Dental Group, P.C.",
    address: "1840 Union Street, San Francisco, CA 94123, United States",
    website: "https://brightlinedental.example",
    country: "US",
    useCase: "Appointment reminders two weeks ahead and six-month cleaning recalls for existing patients of the clinic. Calls are made on weekdays and Saturday mornings only.",
    consent: "Every patient signs the intake form (section 6: calls and texts about appointments, including automated or AI-voice calls). New patients who book online tick a separate, unticked consent box. Records are kept for 5 years.",
    volume: "About 1,500 calls a month",
    script: "Hi Emily, this is the AI assistant of Brightline Dental, calling about your next dental visit. I'm calling to confirm your appointment on Tuesday, November 3 at 10:30 AM with Maria. Can you still make it? ... If you'd rather not get these calls, just tell me and I'll remove your number.",
    submittedMs: created + 28 * HOUR,
    by: admin,
    decision: "approved",
    note: "Existing-patient reminders with written intake consent. Approved.",
    reviewMs: created + 2 * DAY + 3 * HOUR,
  });

  // DNC: the national registry scrub, a complaint and a staff number (opt-outs come from calls).
  const scrubMs = s.NOW - 21 * DAY;
  const scrubbed = due[23];
  for (const phone of [scrubbed.phone, ws.pool.take(), ws.pool.take()]) dnc(s, ws, { phone, reason: "national_dnc", source: "upload", listRef: `National DNC Registry · SAN 4412-8821 · ${new Date(scrubMs).toISOString().slice(0, 10)}`, expiresMs: scrubMs + 31 * DAY, createdMs: scrubMs, by: admin });
  s.audit(ws.id, { type: "user", id: admin }, "dnc.uploaded", "dnc", "National DNC Registry", { scope: "workspace", reason: "national_dnc", added: 3, existing: 0, expires: iso(scrubMs + 31 * DAY) }, scrubMs);
  const complaint = ws.pool.take();
  dnc(s, ws, { phone: complaint, reason: "complaint", source: "user", note: "Asked by email not to be called (former patient).", createdMs: s.NOW - 33 * DAY, by: admin });
  s.audit(ws.id, { type: "user", id: admin }, "dnc.added", "dnc", complaint, { scope: "workspace", reason: "complaint", source: "user" }, s.NOW - 33 * DAY);
  dnc(s, ws, { phone: DENTAL.staffLine, reason: "manual", source: "user", note: "Front desk staff line: never dial.", createdMs: created + 8 * HOUR, by: admin });
  s.audit(ws.id, { type: "user", id: admin }, "dnc.added", "dnc", DENTAL.staffLine, { scope: "workspace", reason: "manual", source: "user" }, created + 8 * HOUR);
  // The operator's global list.
  for (const [i, phone] of ["+12025550119", "+13055550142"].entries()) {
    dnc(s, null, { phone, reason: "admin", source: "admin", listRef: "Known complainants", note: i ? "Reported a call as unwanted to the carrier." : "Litigation risk: never dial.", createdMs: s.NOW - (45 - i * 17) * DAY, by: admin });
    s.audit(null, { type: "admin", id: admin }, "dnc.added", "dnc", phone, { scope: "global", reason: "admin", source: "admin" }, s.NOW - (45 - i * 17) * DAY);
  }

  channel(s, ws, "email", "Clinic manager", { to: "manager@brightlinedental.example, frontdesk@brightlinedental.example" }, ["call_failed", "opt_out", "campaign_finished", "low_balance", "agent_sync_failed", "outbound_decided", "quota_warning", "quota_reached"], created + 30 * HOUR, admin);
  channel(s, ws, "webhook", "Patient CRM (bookings)", { url: "https://hooks.brightlinedental.example/dialzen", secret: "whsec_demo_brightline_hooks" }, ["booking_made", "opt_out", "campaign_finished"], s.NOW - 32 * DAY, admin);
  apiKey(s, ws, admin, "Patient CRM sync (Zapier)", s.NOW - 31 * DAY, s.NOW - 2 * HOUR - 13 * MIN);
  return ws;
}

export function monthName(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(ms);
}

function holidays(now: number): string[] {
  const y = new Date(now).getUTCFullYear();
  return [`${y}-12-24`, `${y}-12-25`, `${y}-12-31`, `${y + 1}-01-01`];
}

// ── Harbor Realty (Dubai) ──

const HARBOR_KB = {
  listings: `Harbor Realty: current listings (prices in AED)
- Marina Heights, Dubai Marina: 2-bedroom on the 18th floor, 1,450 sq ft, marina view, for sale AED 2.4M. More 2-bedrooms from AED 2.2M to 2.9M; 1-bedrooms from AED 1.45M.
- Palm View Residences, Palm Jumeirah: 1-bedroom with sea view for rent, AED 115,000 a year, up to 4 cheques.
- Creek Residences, Dubai Creek Harbour (off-plan): 3-bedrooms from AED 3.1M, handover Q4 2027, 10% down payment, 60/40 payment plan.
- Arabian Ranches: 4-bedroom villa with garden, AED 4.2M.
- Sold recently: the Jumeirah Park villa (no longer available).`,
  fees: `Fees, viewings and financing
- Buyers: 2% agency fee plus VAT; Dubai Land Department fee 4%.
- Renters: 5% agency fee, 5% security deposit; rent in up to 4 cheques.
- Viewings: Monday to Friday 10 AM to 7 PM and Saturday 10 AM to 4 PM, booked with the calendar tool. The agent meets the client in the building lobby.
- Mortgages: we work with three partner banks; buyers should get a pre-approval before making an offer.
- Price negotiations are handled by the listing agent only (transfer the call).`,
};

export function seedHarbor(s: Seed, owner: { id: number; includedMin: number }): WsDef {
  const { NOW } = s;
  const created = NOW - 50 * DAY - 3 * HOUR;
  const ws = workspace(s, { key: "harbor", name: "Harbor Realty", ownerId: owner.id, ownerIsAdmin: false, tz: "Asia/Dubai", createdMs: created, includedMin: owner.includedMin, hours: HARBOR_HOURS, pool: new PhonePool(s.r, uaeMobile), nameSet: "ar" }, true, {
    defaultCountry: "AE",
    defaultLanguage: supports("ar") ? "ar-SA" : "en-GB",
    weekStart: 1,
    branding: { companyName: "Harbor Realty", logo: "", color: "#1d4ed8" },
  });
  const book = tool(s, ws, "cal_com", "book_viewing", "Checks free viewing and consultation times and books one for the caller.", { apiKey: "cal_demo_harbor_93d0b5e1", eventTypeId: 2290531, timezone: ws.tz, apiBase: "" }, created + 2 * HOUR, owner.id, NOW - 5 * HOUR);
  const transfer = tool(s, ws, "transfer", "transfer_to_agent", "Transfers the call to the listing agent for price negotiations or when the caller asks for a person.", { number: "+97145550100", mode: "warm", whisper: "Harbor AI assistant with a buyer on the line." }, created + 2 * HOUR + MIN, owner.id, NOW - 3 * DAY);
  const arabic = supports("ar");
  agent(
    s,
    ws,
    {
      key: "property",
      name: "Property inquiries",
      template: "real_estate_inquiry",
      language: arabic ? "ar-SA" : "en-GB",
      voiceId: arabic ? "sim-layla" : "sim-noah",
      voiceName: arabic ? "Layla · Gulf Arabic" : "Noah · British",
      firstMessage: arabic ? "مرحبًا بك في Harbor Realty. أنا المساعد الذكي لعقاراتنا، وأعمل بالذكاء الاصطناعي. عن أي عقار تتصل؟" : "Hello, thanks for calling Harbor Realty. I'm the AI assistant for our listings. Which property are you calling about?",
      prompt: arabic
        ? `أنت مساعد العقارات في {{business_name}}، وكالة عقارية في دبي. تحدث دائمًا بالعربية بلهجة مهذبة وواضحة.

## مهامك
- أجب عن أسئلة العقارات المعروضة من قاعدة المعرفة: السعر والمساحة والموقع والتوفر والرسوم.
- اسأل إن كان المتصل يريد الشراء أو الإيجار، وعن ميزانيته وموعد انتقاله والتمويل.
- احجز موعد معاينة بأداة الحجز، وأكد العنوان والوقت.
- لا تتفاوض على الأسعار: حوّل المكالمة إلى الوكيل المسؤول.`
        : (getTemplate("real_estate_inquiry")?.systemPrompt ?? ""),
      settings: { maxDurationSec: 600, transferNumber: "+97145550100", businessName: "Harbor Realty", successCriteria: "The caller's questions were answered and a viewing was booked if they were interested.", widget: { enabled: true, allowedDomains: ["harborrealty.example", "localhost"], title: "تحدث معنا", color: "#1d4ed8", position: "bottom-left" } },
      createdMs: created + 3 * HOUR,
      tools: { book: "book_viewing", transfer: "transfer_to_agent" },
      toolIds: [book, transfer],
    },
    owner.id,
  );
  agent(
    s,
    ws,
    {
      key: "lead",
      name: "Lead qualification",
      template: "lead_qualification",
      language: "en-GB",
      voiceId: "sim-noah",
      voiceName: "Noah · British",
      firstMessage: "Hi {{contact.first_name|there}}, this is the AI assistant of Harbor Realty, following up on the request you sent us about Marina Heights. Is now a good time for a couple of quick questions?",
      prompt: (getTemplate("lead_qualification")?.systemPrompt ?? "").replace("book it with the booking tool", "book a call with a property consultant with the booking tool (Dubai time)"),
      settings: { maxDurationSec: 480, voicemailAction: "hangup", businessName: "Harbor Realty" },
      createdMs: created + 10 * DAY,
      tools: { book: "book_viewing" },
      toolIds: [book],
    },
    owner.id,
  );
  kb(s, ws, "Current listings", HARBOR_KB.listings, created + 4 * HOUR, owner.id);
  kb(s, ws, "Fees, viewings and financing", HARBOR_KB.fees, created + 4 * HOUR + 5 * MIN, owner.id);
  phoneNumber(s, ws, { key: "main", e164: "+97145550123", country: "AE", label: "Dubai office", inbound: ws.agents.property.id, outbound: ws.agents.lead.id, outboundEnabled: true, cap: 150, monthly: s.rentalMicros, createdMs: created + 26 * HOUR, userId: owner.id, kyc: "approved" });
  ws.pool.reserve("+97145550100");

  const formMs = created + 11 * DAY;
  const uk = new PhonePool(s.r, ukDrama);
  for (let i = 0; i < 120; i++) {
    const kind = i < 58 ? "ar" : i < 92 ? "expat" : "uk";
    const cMs = formMs + Math.floor(s.r() * 26) * DAY + Math.floor(s.r() * 12) * HOUR;
    const consent: ConsentSpec = kind === "uk"
      ? { type: "ai_voice", purpose: "telemarketing", source: "web_form", url: "https://harborrealty.example/marina-heights", text: "I agree that Harbor Realty may call me, including with automated AI-voice calls, about Marina Heights and similar properties. I can withdraw my consent at any time." }
      : { type: "pewc", purpose: "any", source: "web_form", url: "https://harborrealty.example/marina-heights", text: "I agree that Harbor Realty may contact me by phone, including automated AI-voice calls, about Marina Heights and similar properties. Consent is not a condition of purchase. I can withdraw it at any time." };
    contact(s, ws, {
      set: kind === "ar" ? "ar" : "uk",
      phone: kind === "uk" ? uk.take() : ws.pool.take(),
      tz: kind === "uk" ? "Europe/London" : "Asia/Dubai",
      state: "",
      country: kind === "uk" ? "GB" : "AE",
      language: kind === "ar" ? "ar" : "en",
      createdMs: cMs,
      source: s.chance(0.8) ? "api" : "manual",
      fields: { interest: s.pick(["Marina Heights 2BR", "Marina Heights 1BR", "Creek Residences 3BR", "Palm View rental"]), budget_aed: s.pick(["1.5M", "2M", "2.5M", "3M+"]), lead_source: s.pick(["Website form", "Property Finder", "Bayut", "Instagram ad"]) },
      tags: ["lead", kind === "uk" ? "overseas" : "uae"],
      consent,
      consentMs: cMs,
      emailDomain: "example.com",
    });
  }
  const leads = ws.contacts.filter((c) => c.language === "en").slice(0, 56);
  list(s, ws, "launch", "Marina Heights launch leads", "Website and portal leads who asked to be contacted about Marina Heights.", leads, NOW - 13 * DAY);
  compliance(s, ws, {
    settings: { businessName: "Harbor Realty", callbackNumber: "+97145550123", callingHours: { start: "10:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] }, maxCallsPer24h: 2, maxCallsPer30d: 4, euRequireConsent: true, blockedCountries: ["IN"], optOutPhrases: ["لا تتصلوا بي", "remove my number"] },
    state: "approved",
    aupMs: created + 30 * HOUR,
    by: owner.id,
  });
  kyc(s, ws, {
    business: "Harbor Realty Real Estate Brokers L.L.C.",
    address: "Office 1204, Marina Plaza, Dubai Marina, Dubai, UAE",
    website: "https://harborrealty.example",
    country: "AE",
    useCase: "Follow-up calls to leads who filled in our website or property portal forms and asked to be contacted about specific listings.",
    consent: "Website and portal forms with an unticked consent checkbox for phone and AI-voice calls; UK leads give separate consent to automated calls (PECR). Consent records are pushed to the platform through the API with the form URL and IP.",
    volume: "About 400 calls a month",
    script: "Hi Oliver, this is the AI assistant of Harbor Realty, following up on the request you sent us about Marina Heights. Is now a good time for a couple of quick questions? ... If you'd rather we didn't call again, just say so.",
    submittedMs: created + 31 * HOUR,
    by: owner.id,
    decision: "approved",
    note: "Opt-in portal leads with consent records; UK consent covers automated calls. Approved.",
    reviewMs: created + 2 * DAY + 5 * HOUR,
  });
  dnc(s, ws, { phone: ws.pool.take(), reason: "manual", source: "user", note: "Developer's sales office: don't call.", createdMs: created + 12 * DAY, by: owner.id });
  channel(s, ws, "email", "Sales team", { to: "sales@harborrealty.example" }, ["call_failed", "booking_made", "opt_out", "campaign_finished", "low_balance", "outbound_decided", "quota_warning", "quota_reached"], created + 30 * HOUR, owner.id);
  return ws;
}

// ── Two small customers ──

export function seedSharma(s: Seed, owner: { id: number; includedMin: number }): WsDef {
  const created = s.NOW - 28 * DAY - 6 * HOUR;
  const hindi = supports("hi");
  const ws = workspace(s, { key: "sharma", name: "Sharma Electronics", ownerId: owner.id, ownerIsAdmin: false, tz: "Asia/Kolkata", createdMs: created, includedMin: owner.includedMin, hours: { 1: [10, 20], 2: [10, 20], 3: [10, 20], 4: [10, 20], 5: [10, 20], 6: [10, 20] }, pool: new PhonePool(s.r, indiaMobile), nameSet: "hi" }, true, { defaultCountry: "IN", defaultLanguage: hindi ? "hi-IN" : "en-IN", weekStart: 1, branding: { companyName: "", logo: "", color: "" } });
  const lookup = tool(s, ws, "webhook", "lookup_order", "Looks up an order by its number in the shop system and returns its status.", { url: "https://api.sharmaelectronics.example/orders/lookup", method: "POST", headers: {}, secret: "whsec_demo_sharma", timeoutMs: 3000, parameters: [{ name: "order_number", type: "string", description: "The order number, e.g. SE-48213.", required: true }] }, created + HOUR, owner.id, s.NOW - 9 * HOUR);
  const transfer = tool(s, ws, "transfer", "transfer_to_support", "Transfers damaged-item and refund cases to the support team.", { number: "+912255550100", mode: "cold", whisper: "" }, created + HOUR + MIN, owner.id, s.NOW - 4 * DAY);
  agent(
    s,
    ws,
    {
      key: "orders",
      name: "Order help",
      template: "order_status",
      language: hindi ? "hi-IN" : "en-IN",
      voiceId: "sim-priya",
      voiceName: "Priya · Indian",
      firstMessage: hindi ? "नमस्ते, Sharma Electronics में आपका स्वागत है। मैं एआई असिस्टेंट हूँ और आपके ऑर्डर की जानकारी दे सकती हूँ। क्या आपके पास ऑर्डर नंबर है?" : "Hello, welcome to Sharma Electronics. I'm the AI assistant and I can check on your order. Do you have your order number handy?",
      prompt: getTemplate("order_status")?.systemPrompt ?? "",
      settings: { maxDurationSec: 480, transferNumber: "+912255550100", businessName: "Sharma Electronics" },
      createdMs: created + 2 * HOUR,
      tools: { lookup: "lookup_order", transfer: "transfer_to_support" },
      toolIds: [lookup, transfer],
    },
    owner.id,
  );
  kb(s, ws, "Delivery and returns policy", "Delivery in 2-5 working days across India (Delhivery, Blue Dart). Returns within 7 days of delivery for unused items in the original box; refunds 5-7 working days after pickup. Items damaged in transit are replaced: transfer the call to support. Store: Lamington Road, Mumbai, open Monday to Saturday 10 AM to 8 PM.", created + 2 * HOUR, owner.id);
  phoneNumber(s, ws, { key: "main", e164: "+912255550123", country: "IN", label: "Customer care", inbound: ws.agents.orders.id, outbound: null, outboundEnabled: false, cap: 100, monthly: s.rentalMicros, createdMs: created + 3 * HOUR, userId: owner.id });
  for (let i = 0; i < 18; i++) contact(s, ws, { set: "hi", phone: ws.pool.take(), tz: "Asia/Kolkata", state: "MH", country: "IN", language: "hi", createdMs: created + (2 + i) * DAY, source: "csv", fields: { city: s.pick(["Mumbai", "Pune", "Thane", "Nashik"]) }, tags: ["customer"], consent: null, consentMs: created });
  compliance(s, ws, { settings: { businessName: "Sharma Electronics", callbackNumber: "+912255550123", indiaDltRoute: "" }, state: "rejected", aupMs: s.NOW - 7 * DAY, by: owner.id });
  kyc(s, ws, {
    business: "Sharma Electronics Pvt. Ltd.",
    address: "214 Lamington Road, Grant Road East, Mumbai 400007, India",
    website: "https://sharmaelectronics.example",
    country: "IN",
    useCase: "Promotional calls about Diwali offers to our customer list.",
    consent: "Customers gave their phone numbers at billing in the store.",
    volume: "About 5,000 calls during the festival season",
    script: "Namaste, this is Sharma Electronics calling with our Diwali offers on TVs and phones...",
    submittedMs: s.NOW - 7 * DAY + HOUR,
    by: owner.id,
    decision: "rejected",
    note: "Promotional calls need recorded consent to promotional calls and a DLT-registered route in India. Numbers given at billing are not consent. Resubmit with consent records and your DLT header.",
    reviewMs: s.NOW - 6 * DAY,
  });
  return ws;
}

export function seedPinecrest(s: Seed, owner: { id: number; includedMin: number }): WsDef {
  const created = s.NOW - 21 * DAY - 2 * HOUR;
  const ws = workspace(s, { key: "pinecrest", name: "Pinecrest Plumbing", ownerId: owner.id, ownerIsAdmin: false, tz: "America/Chicago", createdMs: created, includedMin: owner.includedMin, hours: { 1: [7, 17], 2: [7, 17], 3: [7, 17], 4: [7, 17], 5: [7, 17] }, pool: new PhonePool(s.r, chicago), nameSet: "en" }, true, { defaultCountry: "US", defaultLanguage: "en-US", weekStart: 7, branding: { companyName: "", logo: "", color: "" } });
  const transfer = tool(s, ws, "transfer", "transfer_to_on_call", "Transfers emergencies (burst pipes, flooding, no water, gas smell) to the on-call plumber.", { number: "+13125550190", mode: "warm", whisper: "Emergency call from the after-hours line." }, created + HOUR, owner.id, s.NOW - 2 * DAY);
  agent(
    s,
    ws,
    {
      key: "afterHours",
      name: "After-hours line",
      template: "receptionist",
      language: "en-US",
      voiceId: "sim-ava",
      voiceName: "Ava · warm, conversational",
      firstMessage: "Thanks for calling Pinecrest Plumbing. I'm the AI assistant for our after-hours line. Is this an emergency, or can I help you schedule service?",
      prompt: `You answer the after-hours line of {{business_name}}, a plumbing company in Chicago.
- Emergencies (burst pipe, flooding, sewage backup, no water, gas smell): help the caller stop the water if it's safe, then transfer to the on-call plumber.
- Everything else: take the name, address and problem, and book the first service call of the next morning.`,
      settings: { maxDurationSec: 600, transferNumber: "+13125550190", businessName: "Pinecrest Plumbing" },
      createdMs: created + 2 * HOUR,
      tools: { transfer: "transfer_to_on_call" },
      toolIds: [transfer],
    },
    owner.id,
  );
  kb(s, ws, "Services and service area", "Service area: Chicago and the north and west suburbs. Emergency call-out after hours: $149 plus parts and labor. Standard service call: $89. Water heater repair and replacement, drain cleaning, leak repair, fixture installation, sump pumps. Office hours Monday to Friday 7 AM to 5 PM.", created + 3 * HOUR, owner.id);
  phoneNumber(s, ws, { key: "main", e164: "+13125550188", country: "US", label: "After-hours line", inbound: ws.agents.afterHours.id, outbound: null, outboundEnabled: false, cap: 100, monthly: s.rentalMicros, createdMs: created + 3 * HOUR, userId: owner.id });
  ws.pool.reserve("+13125550190");
  for (let i = 0; i < 26; i++) contact(s, ws, { set: "en", phone: ws.pool.take(), tz: "America/Chicago", state: "IL", country: "US", language: "en", createdMs: created + 2 * DAY, source: "csv", fields: { last_service: s.pick(["Water heater", "Drain cleaning", "Leak repair", "Sump pump"]) }, tags: ["customer"], consent: { type: "pec", purpose: "informational", source: "paper", url: "", text: "Work order signature: I agree that Pinecrest Plumbing may call me about this job and future maintenance reminders, including automated or AI-voice calls." }, consentMs: created - 90 * DAY });
  compliance(s, ws, { settings: { businessName: "Pinecrest Plumbing", callbackNumber: "+13125550188", callingHours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] } }, state: "pending", aupMs: s.NOW - DAY - 5 * HOUR, by: owner.id });
  kyc(s, ws, {
    business: "Pinecrest Plumbing & Heating Inc.",
    address: "4410 N Elston Ave, Chicago, IL 60630, United States",
    website: "https://pinecrestplumbing.example",
    country: "US",
    useCase: "Annual water heater and sump pump maintenance reminders to existing customers, and follow-up calls the day after a service visit.",
    consent: "Customers sign the work order, which includes consent to calls about the job and maintenance reminders (including automated calls). We'd upload the signed consent with each contact.",
    volume: "About 300 calls a month",
    script: "Hi Michael, this is the AI assistant of Pinecrest Plumbing. Your water heater is due for its yearly flush. Would you like us to book a visit? You can say stop at any time and we won't call again.",
    submittedMs: s.NOW - DAY - 4 * HOUR,
    by: owner.id,
    decision: null,
    note: "",
  });
  return ws;
}
