"use server";

import { redirect } from "next/navigation";
import { agentToolIds, createAgent, deleteAgent, getAgent, setAgentTools, updateAgent, type AgentInput, type AgentRecord } from "@/lib/agents";
import { aiQuota, AiError, countAiRequest, runAi, AI_TONES, type AiAction, type AiTone } from "@/lib/ai";
import { getCompliance } from "@/lib/compliance";
import { guardWorkspace } from "@/lib/dashboard";
import { getDb, now } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { addKbItem, deleteKbItem, MAX_KB_TEXT } from "@/lib/kb";
import { availableProviders } from "@/lib/providers";
import { rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { deleteTool, getTool, listTools, saveTool, testTool, TOOL_DEFAULTS } from "@/lib/tool-configs";
import { deleteAgentRemote, deleteKbItemRemote, listProviderVoices, simulatedChat, startWebCall, syncAgentNow } from "@/lib/voice-bridge";
import { hasAiDisclosure, isProvider, isToolKind, normalizeAgentSettings, normalizeAnalysisFields, normalizeLanguageTag, normalizeWidget, renderPromptVariables, text } from "@/voice/normalize";
import { getTemplate } from "@/voice/templates";
import type { Voice, WebCallSession } from "@/voice/types";
import type { FormState } from "../types";
import { decimalOf, idOf, intOf, parseJsonField, str } from "./helpers";

/**
 * Agents (Agents pages): create from a template, edit every tab of the builder, knowledge base,
 * tools, the prompt assistant and browser test calls. Building agents needs agents.manage
 * (editor and up). Every save marks the agent for re-sync and pushes it to its provider.
 */

const agentsBase = (wid: number) => `/dashboard/w/${wid}/agents`;

async function loadAgent(formData: FormData, options: { allowInDemo?: boolean } = {}) {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "agents.manage", allowInDemo: options.allowInDemo });
  if (!guard.ok) return { guard, agent: undefined, t: await getT() } as const;
  const agent = await getAgent(guard.workspace.id, idOf(formData.get("agent_id")));
  return { guard, agent, t: await getT() } as const;
}

function limitError(t: Translator, limit?: number): string {
  return t("dash.agents.err.limit", { limit: limit ?? 0 });
}

/** "New agent": from a template or blank. */
export async function createAgentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "agents.manage" });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const templateId = str(formData.get("template"));
  const template = templateId ? getTemplate(templateId) : undefined;
  if (templateId && !template) return { error: t("dash.agents.err.template") };
  const name = str(formData.get("name")).trim() || (template ? template.name : t("dash.agents.blankName"));
  if (name.length > 120) return { error: t("dash.agents.err.name") };
  const provider = str(formData.get("provider"));
  const providers = await availableProviders();
  if (provider && (!isProvider(provider) || !providers.includes(provider))) return { error: t("dash.agents.err.provider") };
  const result = await createAgent(
    { id: guard.workspace.id, name: guard.workspace.name, ownerId: guard.workspace.ownerId, settings: guard.workspace.settings },
    guard.entitlements,
    { name, template: template?.id, provider: provider || undefined, language: str(formData.get("language")) || undefined },
    guard.user.id,
  );
  if (!result.ok) return { error: result.error === "limit" ? limitError(t, result.limit) : result.error === "provider" ? t("dash.agents.err.provider") : t("dash.agents.err.name") };
  // Template tools: attach the workspace's existing tools of the suggested kinds.
  if (template) {
    const tools = await listTools(guard.workspace.id);
    const ids = tools.filter((tool) => template.suggestedTools.includes(tool.kind)).map((tool) => tool.id);
    if (ids.length) await setAgentTools(guard.workspace.id, result.agent.id, ids);
  }
  await syncAgentNow(result.agent.id).catch(() => undefined);
  redirect(`${agentsBase(guard.workspace.id)}/${result.agent.id}?created=1`);
}

/** Copies an agent (prompt, settings, tools, text and URL knowledge); the copy's widget is off. */
export async function duplicateAgentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const result = await createAgent(
    { id: guard.workspace.id, name: guard.workspace.name, ownerId: guard.workspace.ownerId, settings: guard.workspace.settings },
    guard.entitlements,
    {
      name: t("dash.agents.copyName", { name: agent.name }).slice(0, 120),
      template: agent.template || undefined,
      provider: agent.provider,
      language: agent.language,
      voiceId: agent.voiceId,
      voiceName: agent.voiceName,
      firstMessage: agent.firstMessage,
      systemPrompt: agent.systemPrompt,
      llm: agent.llm,
      settings: { ...agent.settings, widget: { ...agent.settings.widget, enabled: false } },
    },
    guard.user.id,
  );
  if (!result.ok) return { error: result.error === "limit" ? limitError(t, result.limit) : t("dash.agents.err.provider") };
  const tools = await agentToolIds(agent.id);
  if (tools.length) await setAgentTools(guard.workspace.id, result.agent.id, tools);
  const db = await getDb();
  const kb = await db.selectFrom("kb_items").selectAll().where("workspace_id", "=", guard.workspace.id).where("agent_id", "=", agent.id).where("kind", "in", ["text", "url"]).execute();
  const ts = now();
  for (const item of kb) {
    await db
      .insertInto("kb_items")
      .values({ workspace_id: guard.workspace.id, agent_id: result.agent.id, kind: item.kind, name: item.name, url: item.url, media_id: null, content: item.content, size_bytes: item.size_bytes, provider: null, provider_doc_id: null, status: "pending", error: null, created_at: ts, updated_at: ts })
      .execute();
  }
  await syncAgentNow(result.agent.id).catch(() => undefined);
  redirect(`${agentsBase(guard.workspace.id)}/${result.agent.id}?created=1`);
}

/** Deletes an agent (refused while a campaign uses it); the provider's copy goes first. */
export async function deleteAgentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const db = await getDb();
  const busy = await db.selectFrom("campaigns").select("id").where("workspace_id", "=", guard.workspace.id).where("agent_id", "=", agent.id).where("status", "in", ["scheduled", "running", "paused"]).executeTakeFirst();
  if (busy) return { error: t("dash.agents.err.inUse") };
  await deleteAgentRemote(agent).catch(() => undefined);
  const result = await deleteAgent(guard.workspace.id, agent.id, guard.user.id);
  if (!result.ok) return { error: result.error === "in_use" ? t("dash.agents.err.inUse") : t("dash.agents.err.notFound") };
  redirect(`${agentsBase(guard.workspace.id)}?deleted=1`);
}

export async function setAgentStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const status = str(formData.get("status"));
  if (status !== "active" && status !== "paused" && status !== "draft") return { error: t("dash.agents.err.generic") };
  await updateAgent(guard.workspace, agent.id, { status }, guard.user.id);
  await syncAgentNow(agent.id).catch(() => undefined);
  return { success: t(`dash.agent.statusSaved.${status}`) };
}

/** Syncs and reports the outcome in the form message. */
async function syncAndReport(agentId: number, t: Translator, savedKey: MessageKey, extra = ""): Promise<FormState> {
  const result = await syncAgentNow(agentId).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "" }));
  const saved = `${t(savedKey)}${extra ? ` ${extra}` : ""}`;
  if (result.ok) return { success: `${saved} ${t("dash.agent.synced")}` };
  return { success: `${saved} ${t("dash.agent.syncLater")}` };
}

/** "Sync now" in the editor header. */
export async function syncAgentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  if (!rateLimit(`dz-sync:${guard.user.id}`, 20, 60_000)) return { error: t("dash.agents.err.rate") };
  const result = await syncAgentNow(agent.id).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "" }));
  return result.ok ? { success: t("dash.agent.syncDone") } : { error: t("dash.agent.syncFailed", { error: result.error || t("dash.agents.err.generic") }) };
}

/**
 * Saves one tab of the editor (section = basics | prompt | behaviour | analysis | widget).
 * The first message always keeps its AI disclosure: the reply says when one was added.
 */
export async function saveAgentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const section = str(formData.get("section"));
  const patch: Partial<AgentInput> = {};
  let extra = "";
  switch (section) {
    case "basics": {
      const name = str(formData.get("name")).trim();
      if (!name || name.length > 120) return { error: t("dash.agents.err.name") };
      const provider = str(formData.get("provider"));
      if (provider !== agent.provider) {
        if (!isProvider(provider) || !(await availableProviders()).includes(provider)) return { error: t("dash.agents.err.provider") };
      }
      patch.name = name;
      patch.provider = provider;
      patch.language = normalizeLanguageTag(str(formData.get("language")), agent.language);
      patch.voiceId = str(formData.get("voice_id")).trim().slice(0, 190);
      patch.voiceName = str(formData.get("voice_name")).trim().slice(0, 190);
      patch.llm = str(formData.get("llm")).trim().slice(0, 80);
      break;
    }
    case "prompt": {
      const prompt = str(formData.get("system_prompt"));
      if (prompt.length > 50_000) return { error: t("dash.agent.err.promptLong") };
      const first = str(formData.get("first_message")).trim();
      if (!first) return { error: t("dash.agent.err.firstMessage") };
      if (first.length > 2000) return { error: t("dash.agent.err.firstLong") };
      patch.systemPrompt = prompt;
      patch.firstMessage = first;
      patch.settings = { businessName: str(formData.get("business_name")).trim().slice(0, 120) };
      if (!hasAiDisclosure(first)) extra = t("dash.agent.disclosureAdded");
      break;
    }
    case "behaviour": {
      const maxMin = decimalOf(formData.get("max_duration_min"));
      const silence = intOf(formData.get("silence_timeout"), 5, 120);
      if (!Number.isFinite(maxMin) || maxMin < 1 || maxMin > 60) return { error: t("dash.agent.err.maxDuration") };
      if (!Number.isFinite(silence)) return { error: t("dash.agent.err.silence") };
      const conditions = str(formData.get("end_conditions"))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (conditions.length > 10) return { error: t("dash.agent.err.conditions") };
      const transfer = str(formData.get("transfer_number")).trim();
      const settings = normalizeAgentSettings({
        ...agent.settings,
        maxDurationSec: Math.round(maxMin * 60),
        silenceTimeoutSec: silence,
        interruptionSensitivity: str(formData.get("interruption")),
        temperature: decimalOf(formData.get("temperature")),
        speed: decimalOf(formData.get("speed")),
        voicemailAction: str(formData.get("voicemail_action")),
        voicemailMessage: str(formData.get("voicemail_message")),
        endCallConditions: conditions,
        transferNumber: transfer,
        recording: formData.get("recording") === "on",
      });
      if (transfer && !settings.transferNumber) return { error: t("dash.agent.err.transfer") };
      if (settings.voicemailAction === "leave_message" && !settings.voicemailMessage.trim()) return { error: t("dash.agent.err.voicemail") };
      patch.settings = settings;
      break;
    }
    case "analysis": {
      const raw = parseJsonField(formData.get("fields"));
      const list = Array.isArray(raw) ? raw : [];
      const fields = normalizeAnalysisFields(list);
      if (fields.length < list.length) return { error: t("dash.agent.err.fields") };
      patch.settings = { analysisFields: fields, successCriteria: str(formData.get("success_criteria")) };
      break;
    }
    case "widget": {
      const domains = str(formData.get("allowed_domains"))
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      const widget = normalizeWidget({
        enabled: formData.get("enabled") === "on",
        allowedDomains: domains,
        title: str(formData.get("title")),
        color: formData.get("use_color") === "on" ? str(formData.get("color")) : "",
        position: str(formData.get("position")),
      });
      if (widget.allowedDomains.length < domains.length) return { error: t("dash.widget.err.domains") };
      if (widget.enabled && !widget.allowedDomains.length) return { error: t("dash.widget.err.noDomains") };
      patch.settings = { widget };
      break;
    }
    default:
      return { error: t("dash.agents.err.generic") };
  }
  const updated = await updateAgent(guard.workspace, agent.id, patch, guard.user.id);
  if (!updated) return { error: t("dash.agents.err.notFound") };
  return syncAndReport(agent.id, t, "dash.agent.saved", extra);
}

// ── Voices ──

export async function listVoicesAction(input: { wid: number; provider: string; language: string }): Promise<{ voices: Voice[] } | { error: string }> {
  const guard = await guardWorkspace(input.wid, { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  if (!isProvider(input.provider)) return { error: t("dash.agents.err.provider") };
  if (!rateLimit(`dz-voices:${guard.user.id}`, 30, 60_000)) return { error: t("dash.agents.err.rate") };
  const voices = await listProviderVoices(guard.workspace.id, input.provider, normalizeLanguageTag(input.language), guard.entitlements);
  return voices ? { voices: voices.slice(0, 300) } : { error: t("dash.agent.voicesUnavailable") };
}

// ── Prompt assistant ──

export async function aiAssistAction(input: { wid: number; agentId: number; action: AiAction; text: string; goal?: string; tone?: string }): Promise<{ results: string[]; used: number; limit: number } | { error: string }> {
  const guard = await guardWorkspace(input.wid, { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const agent = await getAgent(guard.workspace.id, Number(input.agentId));
  if (!agent) return { error: t("dash.agents.err.notFound") };
  if (!["generate_prompt", "improve_prompt", "first_message"].includes(input.action)) return { error: t("dash.agents.err.generic") };
  if (!rateLimit(`dz-ai:${guard.user.id}`, 10, 60_000)) return { error: t("dash.agents.err.rate") };
  const quota = await aiQuota(guard.workspace.ownerId);
  if (!quota.ok) return { error: quota.reason === "plan" ? t("dash.ai.err.plan") : t("dash.ai.err.quota", { limit: quota.limit }) };
  const compliance = await getCompliance(guard.workspace);
  try {
    const result = await runAi({
      action: input.action,
      text: text(input.text, 20_000),
      businessName: agent.settings.businessName || compliance.settings.businessName || guard.workspace.name,
      language: agent.language,
      goal: text(input.goal ?? "", 300),
      tone: (AI_TONES as readonly string[]).includes(input.tone ?? "") ? (input.tone as AiTone) : undefined,
    });
    await countAiRequest(guard.workspace.ownerId);
    return { results: result.results, used: quota.used + 1, limit: quota.limit };
  } catch (e) {
    if (e instanceof AiError) {
      const key: MessageKey = e.code === "not_configured" ? "dash.ai.err.notConfigured" : e.code === "input" ? "dash.ai.err.input" : e.code === "rate_limit" ? "dash.ai.err.busy" : "dash.ai.err.provider";
      return { error: t(key) };
    }
    return { error: t("dash.ai.err.provider") };
  }
}

// ── Knowledge base ──

export async function addKbAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const kind = str(formData.get("kind"));
  const shared = formData.get("shared") === "on";
  const result =
    kind === "text"
      ? await addKbItem(guard.workspace.id, agent.id, { kind: "text", name: str(formData.get("name")), text: str(formData.get("text")) }, guard.user.id, shared)
      : kind === "url"
        ? await addKbItem(guard.workspace.id, agent.id, { kind: "url", url: str(formData.get("url")), name: str(formData.get("name")) }, guard.user.id, shared)
        : kind === "file"
          ? await addKbItem(guard.workspace.id, agent.id, { kind: "file", mediaId: idOf(formData.get("media_id")) }, guard.user.id, shared)
          : null;
  if (!result) return { error: t("dash.agents.err.generic") };
  if (!result.ok) return { error: t(`dash.kb.err.${result.error}`, { max: MAX_KB_TEXT.toLocaleString("en") }) };
  return syncAndReport(agent.id, t, "dash.kb.added");
}

export async function deleteKbAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const itemId = idOf(formData.get("item_id"));
  await deleteKbItemRemote(guard.workspace.id, itemId).catch(() => undefined);
  const item = await deleteKbItem(guard.workspace.id, itemId, guard.user.id);
  if (!item) return { error: t("dash.kb.err.notFound") };
  return syncAndReport(agent.id, t, "dash.kb.deleted");
}

// ── Tools ──

function toolConfigFromForm(kind: string, formData: FormData): Record<string, unknown> {
  const get = (k: string) => str(formData.get(k)).trim();
  switch (kind) {
    case "cal_com":
      return { apiKey: get("api_key"), eventTypeId: Number(get("event_type_id")) || 0, timezone: get("timezone"), apiBase: get("api_base") };
    case "google_calendar":
      return {
        calendarId: get("calendar_id"),
        durationMin: Number(get("duration_min")) || 30,
        bufferMin: Number(get("buffer_min")) || 0,
        timezone: get("timezone"),
        hours: { start: get("hours_start"), end: get("hours_end"), days: formData.getAll("hours_days").map(Number) },
      };
    case "webhook":
      return {
        url: get("url"),
        method: "POST",
        secret: get("secret"),
        timeoutMs: Number(get("timeout_ms")) || 3000,
        headers: parseJsonField(formData.get("headers")),
        parameters: parseJsonField(formData.get("parameters")),
      };
    case "google_sheets":
      return {
        spreadsheetId: get("spreadsheet_id").replace(/^.*\/d\/([A-Za-z0-9_-]+).*$/, "$1"),
        sheetName: get("sheet_name"),
        columns: get("columns")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      };
    case "transfer":
      return { number: get("number"), mode: get("mode"), whisper: get("whisper") };
    case "end_call":
      return { instructions: get("instructions") };
    default:
      return {};
  }
}

/** Creates or edits a workspace tool; a new tool is attached to the agent it was created from. */
export async function saveToolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const toolId = str(formData.get("tool_id")) ? idOf(formData.get("tool_id")) : undefined;
  const existing = toolId ? await getTool(guard.workspace.id, toolId) : undefined;
  if (toolId && !existing) return { error: t("dash.tool.err.not_found") };
  const kind = existing?.kind ?? str(formData.get("kind"));
  if (!isToolKind(kind)) return { error: t("dash.tool.err.kind") };
  const result = await saveTool(
    guard.workspace.id,
    { kind, name: str(formData.get("name")) || TOOL_DEFAULTS[kind].name, description: str(formData.get("description")), config: toolConfigFromForm(kind, formData) },
    guard.user.id,
    toolId,
  );
  if (!result.ok) return { error: t(`dash.tool.err.${result.error}`) };
  if (!existing) {
    const ids = await agentToolIds(agent.id);
    await setAgentTools(guard.workspace.id, agent.id, [...ids, result.tool.id]);
  }
  return syncAndReport(agent.id, t, existing ? "dash.tool.saved" : "dash.tool.created");
}

export async function deleteToolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  if (!(await deleteTool(guard.workspace.id, idOf(formData.get("tool_id")), guard.user.id))) return { error: t("dash.tool.err.not_found") };
  return syncAndReport(agent.id, t, "dash.tool.deleted");
}

/** Attaches (attach=1) or detaches a workspace tool from the agent. */
export async function toggleAgentToolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { guard, agent, t } = await loadAgent(formData);
  if (!guard.ok) return { error: guard.error };
  if (!agent) return { error: t("dash.agents.err.notFound") };
  const tool = await getTool(guard.workspace.id, idOf(formData.get("tool_id")));
  if (!tool) return { error: t("dash.tool.err.not_found") };
  const ids = await agentToolIds(agent.id);
  const attach = formData.get("attach") === "1";
  await setAgentTools(guard.workspace.id, agent.id, attach ? [...new Set([...ids, tool.id])] : ids.filter((id) => id !== tool.id));
  return syncAndReport(agent.id, t, attach ? "dash.tool.attached" : "dash.tool.detached");
}

export async function testToolAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardWorkspace(formData.get("wid"), { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return { error: guard.error };
  const t = await getT();
  const tool = await getTool(guard.workspace.id, idOf(formData.get("tool_id")));
  if (!tool) return { error: t("dash.tool.err.not_found") };
  if (!rateLimit(`dz-tooltest:${guard.user.id}`, 10, 60_000)) return { error: t("dash.agents.err.rate") };
  const settings = await getSettings();
  const result = await testTool(tool, fetch, { google: { clientId: settings.google_client_id, clientSecret: settings.google_client_secret } });
  if (result.ok) return { success: result.simulated ? t("dash.tool.testDemo") : t("dash.tool.testOk", { detail: result.detail }) };
  return { error: t(`dash.tool.test.${result.error}`, { detail: result.detail }) };
}

// ── Browser test call ──

export type TestCallStart = { ok: true; callId: number; session: WebCallSession; dynamicVariables: Record<string, string>; greeting: string } | { ok: false; error: string };

/** Starts a browser test call (provider web SDK, or the simulated text chat). Allowed in the demo. */
export async function startTestCallAction(input: { wid: number; agentId: number }): Promise<TestCallStart> {
  const guard = await guardWorkspace(input.wid, { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return { ok: false, error: guard.error };
  const t = await getT();
  const agent = await getAgent(guard.workspace.id, Number(input.agentId));
  if (!agent) return { ok: false, error: t("dash.agents.err.notFound") };
  if (!rateLimit(`dz-testcall:${guard.user.id}`, 10, 10 * 60_000)) return { ok: false, error: t("dash.test.err.rate") };
  const result = await startWebCall({ workspace: guard.workspace, agent, entitlements: guard.entitlements, source: "test" });
  if (!result.ok) {
    const error =
      result.error === "concurrency" ? t("dash.test.err.concurrency") : result.error === "funds" ? t("dash.test.err.funds") : result.error === "unavailable" ? t("dash.test.err.unavailable") : t("dash.test.err.provider", { error: result.message ?? "" });
    return { ok: false, error };
  }
  return { ok: true, callId: result.callId, session: result.session, dynamicVariables: result.dynamicVariables, greeting: result.greeting || firstGreeting(agent, guard.workspace.name) };
}

function firstGreeting(agent: AgentRecord, workspaceName: string): string {
  const business = agent.settings.businessName || workspaceName;
  return renderPromptVariables(agent.firstMessage, null, { business_name: business, today: new Date().toISOString().slice(0, 10) });
}

/** One message of the simulated text chat (or end=true to hang up). */
export async function testChatAction(input: { wid: number; callId: number; message?: string; end?: boolean }): Promise<{ ok: true; reply: string; end: boolean } | { ok: false; error: string }> {
  const guard = await guardWorkspace(input.wid, { capability: "agents.manage", allowInDemo: true });
  if (!guard.ok) return { ok: false, error: guard.error };
  const t = await getT();
  if (!rateLimit(`dz-testchat:${guard.user.id}`, 60, 60_000)) return { ok: false, error: t("dash.test.err.rate") };
  const result = await simulatedChat({ workspaceId: guard.workspace.id, callId: Number(input.callId), message: text(input.message ?? "", 1000), end: Boolean(input.end) });
  if (!result) return { ok: false, error: t("dash.test.err.ended") };
  return { ok: true, ...result };
}
