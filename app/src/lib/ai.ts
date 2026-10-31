import "server-only";
import { isDemoMode } from "./config";
import { getEntitlementsForUserId } from "./plans";
import { getSettings, type Settings } from "./settings";
import { getUsage, incrementUsage } from "./usage";
import { CALL_RULES } from "@/voice/templates";

/**
 * The AI adapter (bring your own key, configured in Admin → Settings → AI):
 * - OpenAI-compatible chat completions (OpenAI, Groq, OpenRouter, Together, local Ollama…)
 * - Anthropic Messages API
 * The key never leaves the server.
 *
 * Used by:
 * - the agent builder's prompt assistant (runAi: write a prompt from a business description,
 *   improve a prompt, suggest a first message). Each successful request counts once against the
 *   workspace owner's monthly AI quota (plan max_ai_monthly: -1 unlimited, 0 none).
 * - post-call analysis when a provider doesn't return the agent's fields (aiComplete with json).
 *
 * Test-only: AI_ANTHROPIC_BASE_URL overrides https://api.anthropic.com (mock servers).
 */

export const AI_ACTIONS = ["generate_prompt", "improve_prompt", "first_message"] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

export const AI_TONES = ["friendly", "professional", "warm", "concise", "upbeat"] as const;
export type AiTone = (typeof AI_TONES)[number];

export interface AiRequest {
  action: AiAction;
  /** Business description (generate) or the current prompt / first message (improve). */
  text: string;
  /** Name of the business, said in prompts and first messages. */
  businessName: string;
  /** Agent's spoken language (BCP-47, e.g. "hi-IN"). */
  language: string;
  /** What the agent is for ("appointment booking for a dental clinic"). */
  goal?: string;
  tone?: AiTone;
}

export interface AiResult {
  /** One or more suggestions to apply. */
  results: string[];
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "provider" | "auth" | "rate_limit" | "input" | "refusal" = "provider",
  ) {
    super(message);
  }
}

export function aiProvider(settings: Settings): "openai" | "anthropic" | null {
  if (settings.ai_provider === "openai" && settings.ai_base_url && settings.ai_model) return "openai";
  if (settings.ai_provider === "anthropic" && settings.ai_anthropic_key && settings.ai_anthropic_model) return "anthropic";
  return null;
}

/** True when the assistant can answer (a provider is configured, or demo mode's canned answers). */
export async function aiAvailable(): Promise<boolean> {
  return isDemoMode() || aiProvider(await getSettings()) !== null;
}

export type AiQuota = { ok: true; used: number; limit: number } | { ok: false; reason: "plan" | "quota"; used: number; limit: number };

/** The owner's AI allowance this month (-1 = unlimited, 0 = not included). */
export async function aiQuota(ownerId: number): Promise<AiQuota> {
  const [entitlements, usage] = await Promise.all([getEntitlementsForUserId(ownerId), getUsage(ownerId)]);
  const limit = entitlements.maxAiMonthly;
  if (limit === 0) return { ok: false, reason: "plan", used: usage.aiRequests, limit: 0 };
  if (limit > 0 && usage.aiRequests >= limit) return { ok: false, reason: "quota", used: usage.aiRequests, limit };
  return { ok: true, used: usage.aiRequests, limit };
}

export async function countAiRequest(ownerId: number): Promise<void> {
  await incrementUsage(ownerId, { aiRequests: 1 });
}

// ── Low-level completion ──

const TIMEOUT_MS = 45_000;

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    const msg = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message ?? "");
    return msg.slice(0, 300);
  } catch {
    return "";
  }
}

function statusError(status: number, detail: string): AiError {
  if (status === 401 || status === 403) return new AiError("The AI provider rejected the API key. Check Admin → Settings → AI.", "auth");
  if (status === 429) return new AiError("The AI provider is rate limiting requests. Try again in a minute.", "rate_limit");
  if (status === 529 || status === 503) return new AiError("The AI provider is overloaded. Try again in a minute.", "rate_limit");
  return new AiError(`The AI provider returned an error (HTTP ${status})${detail ? `: ${detail}` : ""}.`, "provider");
}

async function callOpenAi(settings: Settings, system: string, user: string, maxTokens: number, json: boolean): Promise<string> {
  const base = settings.ai_base_url.replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.ai_api_key) headers.Authorization = `Bearer ${settings.ai_api_key}`;
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.ai_model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
        temperature: json ? 0 : 0.6,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AiError("Could not reach the AI provider.", "provider");
  }
  if (!res.ok) throw statusError(res.status, await readError(res));
  const body = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> } | null;
  const content = body?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : "";
  if (!text.trim()) throw new AiError("The AI provider returned an empty answer.", "provider");
  return text;
}

async function callAnthropic(settings: Settings, system: string, user: string, maxTokens: number): Promise<string> {
  const base = (process.env.AI_ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": settings.ai_anthropic_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: settings.ai_anthropic_model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AiError("Could not reach the AI provider.", "provider");
  }
  if (!res.ok) throw statusError(res.status, await readError(res));
  const body = (await res.json().catch(() => null)) as { content?: Array<{ type?: string; text?: string }>; stop_reason?: string } | null;
  if (body?.stop_reason === "refusal") throw new AiError("The AI declined this request. Rephrase it and try again.", "refusal");
  const text = (body?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  if (!text.trim()) throw new AiError("The AI provider returned an empty answer.", "provider");
  return text;
}

/**
 * One completion with the configured provider. `json: true` asks for a JSON object (OpenAI
 * response_format; Anthropic follows the instruction in the prompt) — parse it with
 * parseAiJson(). Throws AiError. Doesn't check or count quotas.
 */
export async function aiComplete(input: { system: string; user: string; maxTokens?: number; json?: boolean }): Promise<string> {
  const settings = await getSettings();
  const provider = aiProvider(settings);
  if (!provider) throw new AiError("The AI assistant isn't set up on this site yet.", "not_configured");
  const cap = provider === "anthropic" ? 16000 : 8000;
  const maxTokens = Math.min(cap, Math.max(64, input.maxTokens ?? (settings.ai_max_tokens || 1024)));
  return provider === "openai" ? callOpenAi(settings, input.system, input.user, maxTokens, Boolean(input.json)) : callAnthropic(settings, input.system, input.user, maxTokens);
}

/** The first JSON object in a model answer (code fences and chatter around it are ignored); null when none. */
export function parseAiJson(answer: string): Record<string, unknown> | null {
  const s = answer.replace(/^```[a-z]*\n?|```$/gim, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Prompt assistant ──

const SYSTEM =
  "You write instructions for AI phone agents (voice assistants that talk to callers on the phone). You only output the requested text, with no preamble, explanations or quotes around it. Prompts use short markdown sections (## headings and - bullets) that a voice model follows well. Never invent facts about the business such as prices, addresses, opening hours or policies: write placeholders like [opening hours] where the owner must fill them in. Agents always tell callers they are an AI, never pressure anyone, and stop calling people who ask them to.";

/** System and user messages for an action. Exported for tests. */
export function buildPrompt(req: AiRequest): { system: string; user: string } {
  const lang = req.language || "en-US";
  const tone = req.tone ? `Tone: ${req.tone}.` : "";
  const business = req.businessName || "the business";
  let user: string;
  switch (req.action) {
    case "generate_prompt":
      user = `Write the system prompt of a phone agent for ${business}. ${req.goal ? `The agent's job: ${req.goal}.` : ""} ${tone}\nThe agent speaks ${lang}; write the prompt in English but tell the agent to answer in that language.\nStructure: who the agent is, its job step by step, what to collect, when to transfer or take a message, style. Don't add general safety rules: they are appended automatically.\n\nAbout the business:\n${req.text.trim()}`;
      break;
    case "improve_prompt":
      user = `Improve this phone agent prompt for ${business}: make it clearer and better suited to spoken conversation (short turns, confirming details, one question at a time), keep every fact and instruction it contains, and keep markdown sections. ${tone}\n\nPrompt:\n${req.text.trim()}`;
      break;
    case "first_message":
      user = `Suggest 3 different opening lines for a phone agent of ${business}${req.goal ? ` whose job is: ${req.goal}` : ""}. Each must say it is an AI assistant and name ${business}, end with a question, and take under 8 seconds to say. Write them in the language ${lang}. Answer with exactly 3 lines, one per line, no numbering. ${tone}${req.text.trim() ? `\n\nCurrent opening line:\n${req.text.trim()}` : ""}`;
      break;
  }
  return { system: SYSTEM, user: user.replace(/[ \t]+\n/g, "\n").trim() };
}

/** Cleans a model answer: code fences, wrapping quotes, "Here is…" preambles. */
export function cleanAnswer(raw: string): string {
  let s = raw.replace(/^```[a-z]*\n?|```$/gim, "").trim();
  s = s.replace(/^(here(?:'s| is| are)[^:\n]*:|sure[!,.][^\n]*\n)\s*/i, "").trim();
  if (/^["“][\s\S]*["”]$/.test(s) && !s.slice(1, -1).includes('"')) s = s.slice(1, -1).trim();
  return s;
}

function toResults(action: AiAction, answer: string): string[] {
  const text = cleanAnswer(answer);
  if (action === "first_message") {
    return text
      .split(/\n+/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["“]|["”]$/g, "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }
  return text ? [text] : [];
}

/** Canned answers for the public demo (no provider, no costs), built from the request's own words. */
function cannedAnswer(req: AiRequest): string {
  const business = req.businessName || "the business";
  const about = req.text.trim().replace(/\s+/g, " ").slice(0, 400);
  switch (req.action) {
    case "generate_prompt":
      return `You are the phone assistant of ${business}.\n\n## About ${business}\n${about || "[Describe the business, its services and opening hours]"}\n\n## Your job\n- Greet the caller and find out what they need${req.goal ? `: ${req.goal}` : ""}.\n- Answer questions from the knowledge base: services, prices, opening hours and location.\n- Collect the caller's name and phone number before booking or taking a message.\n- Offer to transfer the call to a team member when you can't help.\n\n## Style\nFriendly and brief: one or two sentences at a time, then let the caller speak.`;
    case "improve_prompt":
      return `${req.text.trim()}\n\n## Speaking style\n- Ask one question at a time and wait for the answer.\n- Repeat names, dates, times and numbers back to confirm them.\n- Keep answers to one or two short sentences.`;
    case "first_message":
      return [`Hi, you've reached ${business}. I'm the AI assistant, how can I help you today?`, `Thanks for calling ${business}! This is our AI assistant. What can I do for you?`, `Hello, ${business} here, you're speaking with an AI assistant. How may I help?`].join("\n");
  }
}

/** Runs one assistant action. Throws AiError (configuration, provider, input). Doesn't check quotas. */
export async function runAi(req: AiRequest): Promise<AiResult> {
  if (!req.text.trim() && req.action !== "first_message") throw new AiError("Write something first: describe the business or paste the prompt.", "input");
  if (req.text.length > 20_000) throw new AiError("The text is too long for the assistant (20,000 characters).", "input");
  if (isDemoMode()) return { results: toResults(req.action, cannedAnswer(req)) };
  const { system, user } = buildPrompt(req);
  const answer = await aiComplete({ system, user, maxTokens: req.action === "first_message" ? 400 : 2000 });
  const results = toResults(req.action, answer);
  if (!results.length) throw new AiError("The AI provider returned an empty answer.", "provider");
  return { results };
}

/** The shared call rules appended to every agent prompt (shown read-only in the builder). */
export const AGENT_CALL_RULES = CALL_RULES;
