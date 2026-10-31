import type { AnalysisField, AgentSpec, ToolParameter } from "@/voice/types";

/**
 * Prompt variables as the providers understand them. Our prompts use {{contact.first_name}} and
 * {{contact.first_name|there}} (dots and fallbacks); providers want plain {{contact_first_name}}
 * names and get the fallbacks as default values (ElevenLabs dynamic-variable placeholders, Retell
 * dynamic variables). Pure.
 */

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g;

/** "contact.first_name" → "contact_first_name". */
export function providerVarName(name: string): string {
  return name.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
}

/** The text with provider-style variables, and every variable's default ("" when none). */
export function toProviderTemplate(text: string): { text: string; defaults: Record<string, string> } {
  const defaults: Record<string, string> = {};
  const out = text.replace(VAR_RE, (_m, name: string, fallback?: string) => {
    const v = providerVarName(name);
    const f = (fallback ?? "").trim();
    if (!(v in defaults) || (!defaults[v] && f)) defaults[v] = f;
    return `{{${v}}}`;
  });
  return { text: out, defaults };
}

/** Prompt, first message and voicemail text of an agent, converted, with the merged defaults. */
export function agentTemplates(agent: AgentSpec): { prompt: string; firstMessage: string; voicemail: string; defaults: Record<string, string> } {
  const prompt = toProviderTemplate(agent.systemPrompt);
  const first = toProviderTemplate(agent.firstMessage);
  const vm = toProviderTemplate(agent.settings.voicemailMessage);
  const defaults: Record<string, string> = {};
  for (const d of [prompt.defaults, first.defaults, vm.defaults]) for (const [k, v] of Object.entries(d)) if (!defaults[k]) defaults[k] = v;
  return { prompt: prompt.text, firstMessage: first.text, voicemail: vm.text, defaults };
}

/** Our call variables (dotted names allowed) → provider names, string values only. */
export function toProviderVariables(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[providerVarName(k)] = String(v ?? "");
  return out;
}

/** End-call instructions, success criteria and analysis fields appended to the prompt for providers that need them inline. */
export function promptAppendix(agent: AgentSpec): string {
  const parts: string[] = [];
  if (agent.settings.endCallConditions.length) parts.push(`## When to end the call\n${agent.settings.endCallConditions.map((c) => `- ${c}`).join("\n")}`);
  return parts.join("\n\n");
}

/** JSON schema of tool parameters (OpenAI function style). */
export function parametersSchema(params: ToolParameter[]): { type: "object"; properties: Record<string, { type: string; description: string }>; required: string[] } {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const p of params) properties[p.name] = { type: p.type, description: p.description || p.name.replace(/_/g, " ") };
  return { type: "object", properties, required: params.filter((p) => p.required).map((p) => p.name) };
}

/** An analysis field's description with its allowed values, for providers without enum support. */
export function fieldDescription(f: AnalysisField): string {
  const base = f.description || f.label;
  if (f.type === "enum" && f.options.length) return `${base} One of: ${f.options.join(", ")}.`;
  if (f.type === "date") return `${base} (ISO-8601 date or date-time)`;
  return base;
}
