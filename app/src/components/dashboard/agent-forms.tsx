"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Braces, Check, CircleAlert, Pause, Play, Plus, Search, ShieldCheck, Sparkles, Trash, Wand2 } from "lucide-react";
import { aiAssistAction, listVoicesAction, saveAgentAction } from "@/app/actions/dashboard/agents";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Hint, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { AGENT_LANGUAGES, providerName } from "@/voice/format";
import { ensureDisclosure, hasAiDisclosure, promptVariableNames, renderPromptVariables } from "@/voice/normalize";
import { ANALYSIS_FIELD_TYPES, INTERRUPTION_LEVELS, type AgentSettings, type AnalysisField, type AnalysisFieldType, type InterruptionSensitivity, type ProviderId, type Voice } from "@/voice/types";

/** The agent as the editor forms receive it (no secrets). */
export interface AgentFormValues {
  id: number;
  name: string;
  provider: ProviderId;
  language: string;
  voiceId: string;
  voiceName: string;
  llm: string;
  firstMessage: string;
  systemPrompt: string;
  settings: AgentSettings;
}

function useSave() {
  return useRefreshingAction(saveAgentAction);
}

function Hidden({ wid, agentId, section }: { wid: number; agentId: number; section: string }) {
  return (
    <>
      <input type="hidden" name="wid" value={wid} />
      <input type="hidden" name="agent_id" value={agentId} />
      <input type="hidden" name="section" value={section} />
    </>
  );
}

/** Save button row shared by the editor tabs. */
function SaveRow({ state, readOnly, children }: { state: { error?: string; success?: string }; readOnly: boolean; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-3">
      <FormMessage state={state} />
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText={t("dash.agent.saving")}>{t("dash.agent.save")}</SubmitButton>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Basics ──

/** Model suggestions per provider (free text: providers add models often). */
const LLM_SUGGESTIONS: Partial<Record<ProviderId, string[]>> = {
  elevenlabs: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gemini-2.0-flash", "gemini-2.5-flash", "claude-3-5-sonnet", "claude-sonnet-4"],
  retell: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "claude-3.7-sonnet", "gemini-2.0-flash"],
};

function VoicePicker({ wid, provider, language, voiceId, voiceName, disabled }: { wid: number; provider: ProviderId; language: string; voiceId: string; voiceName: string; disabled: boolean }) {
  const t = useT();
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState("");
  const [loading, startLoading] = useTransition();
  const [selected, setSelected] = useState({ id: voiceId, name: voiceName });
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const listId = useId();

  useEffect(() => {
    let cancelled = false;
    startLoading(async () => {
      const res = await listVoicesAction({ wid, provider, language });
      if (cancelled) return;
      if ("voices" in res) {
        setVoices(res.voices);
        setError("");
      } else {
        setVoices(null);
        setError(res.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [wid, provider, language]);

  useEffect(() => () => audio.current?.pause(), []);

  const preview = (v: Voice) => {
    audio.current?.pause();
    if (playing === v.id) {
      setPlaying("");
      return;
    }
    const a = new Audio(v.previewUrl);
    audio.current = a;
    a.onended = () => setPlaying("");
    a.play().then(
      () => setPlaying(v.id),
      () => setPlaying(""),
    );
  };

  const q = query.trim().toLowerCase();
  const shown = (voices ?? []).filter((v) => !q || `${v.name} ${v.accent} ${v.gender}`.toLowerCase().includes(q)).slice(0, 80);

  return (
    <div>
      <input type="hidden" name="voice_id" value={selected.id} />
      <input type="hidden" name="voice_name" value={selected.name} />
      {voices ? (
        <div className="rounded-lg border border-line">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dash.agent.voiceSearch")}
              aria-label={t("dash.agent.voiceSearch")}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              disabled={disabled}
            />
            <span className="text-xs whitespace-nowrap text-muted">{t("dash.agent.voiceCount", { n: voices.length })}</span>
          </div>
          <ul id={listId} role="radiogroup" aria-label={t("dash.agent.voice")} className="max-h-72 divide-y divide-line overflow-y-auto">
            <li>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-paper">
                <input type="radio" name="voice_choice" checked={!selected.id} onChange={() => setSelected({ id: "", name: "" })} disabled={disabled} className="accent-[var(--primary)]" />
                <span className="text-muted">{t("dash.agents.defaultVoice")}</span>
              </label>
            </li>
            {shown.map((v) => (
              <li key={v.id} className="flex items-center gap-2 pe-2 hover:bg-paper">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                  <input type="radio" name="voice_choice" checked={selected.id === v.id} onChange={() => setSelected({ id: v.id, name: v.name })} disabled={disabled} className="accent-[var(--primary)]" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium" dir="auto">
                      {v.name}
                    </span>
                    <span className="block truncate text-xs text-muted">{[v.gender ? t(`dash.agent.gender.${v.gender}`) : "", v.accent, v.languages.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || t("dash.agent.multilingual")}</span>
                  </span>
                </label>
                {v.previewUrl ? (
                  <Button variant="ghost" size="sm" onClick={() => preview(v)} aria-label={t("dash.agent.voicePreview", { name: v.name })} title={t("dash.agent.voicePreview", { name: v.name })}>
                    {playing === v.id ? <Pause aria-hidden /> : <Play aria-hidden />}
                  </Button>
                ) : null}
              </li>
            ))}
            {!shown.length ? <li className="px-3 py-4 text-sm text-muted">{t("dash.agent.voiceNone")}</li> : null}
          </ul>
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            value={selected.id}
            onChange={(e) => setSelected({ id: e.target.value.trim(), name: e.target.value.trim() })}
            placeholder={loading ? t("dash.agent.voiceLoading") : t("dash.agent.voiceIdPlaceholder")}
            aria-label={t("dash.agent.voiceId")}
            dir="ltr"
            className="font-mono text-[13px]"
            disabled={disabled}
          />
          {error && !loading ? <Hint>{error}</Hint> : null}
        </div>
      )}
    </div>
  );
}

export function AgentBasicsForm({ wid, agent, providers, readOnly }: { wid: number; agent: AgentFormValues; providers: ProviderId[]; readOnly: boolean }) {
  const t = useT();
  const [state, action] = useSave();
  const [provider, setProvider] = useState<ProviderId>(agent.provider);
  const [language, setLanguage] = useState(agent.language);
  const options = providers.includes(agent.provider) ? providers : [agent.provider, ...providers];
  const llmList = useId();
  return (
    <form action={action} className="space-y-5">
      <Hidden wid={wid} agentId={agent.id} section="basics" />
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.agents.nameLabel")} htmlFor="a-name">
            <Input id="a-name" name="name" defaultValue={agent.name} maxLength={120} required dir="auto" />
          </Field>
          <Field label={t("dash.agents.language")} htmlFor="a-lang" hint={t("dash.agent.languageHint")}>
            <Select id="a-lang" name="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {AGENT_LANGUAGES.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("dash.agents.provider")} htmlFor="a-provider" hint={provider !== agent.provider ? t("dash.agent.providerSwitch") : !providers.includes(agent.provider) ? t("dash.agent.providerOff") : undefined}>
            <Select id="a-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
              {options.map((p) => (
                <option key={p} value={p}>
                  {providerName(p, t)}
                </option>
              ))}
            </Select>
          </Field>
          {provider !== "simulated" ? (
            <Field label={t("dash.agent.llm")} htmlFor="a-llm" hint={t("dash.agent.llmHint")}>
              <Input id="a-llm" name="llm" defaultValue={agent.llm} list={llmList} dir="ltr" placeholder={t("dash.agent.llmDefault")} maxLength={80} />
              <datalist id={llmList}>
                {(LLM_SUGGESTIONS[provider] ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
          ) : (
            <div>
              <input type="hidden" name="llm" value={agent.llm} />
              <Alert tone="info">{t("dash.agent.simulatedNote")}</Alert>
            </div>
          )}
        </div>
        <Field label={t("dash.agent.voice")} hint={t("dash.agent.voiceHint")}>
          <VoicePicker key={`${provider}:${language}`} wid={wid} provider={provider} language={language} voiceId={provider === agent.provider ? agent.voiceId : ""} voiceName={provider === agent.provider ? agent.voiceName : ""} disabled={readOnly} />
        </Field>
      </fieldset>
      <SaveRow state={state} readOnly={readOnly} />
    </form>
  );
}

// ── Prompt ──

const VARIABLES: Array<{ token: string; key: MessageKey }> = [
  { token: "{{contact.first_name|there}}", key: "dash.agent.var.firstName" },
  { token: "{{contact.name}}", key: "dash.agent.var.name" },
  { token: "{{contact.phone}}", key: "dash.agent.var.phone" },
  { token: "{{contact.email}}", key: "dash.agent.var.email" },
  { token: "{{contact.company}}", key: "dash.agent.var.company" },
  { token: "{{contact.your_field}}", key: "dash.agent.var.custom" },
  { token: "{{business_name}}", key: "dash.agent.var.business" },
  { token: "{{today}}", key: "dash.agent.var.today" },
  { token: "{{timezone}}", key: "dash.agent.var.timezone" },
  { token: "{{contact_number}}", key: "dash.agent.var.contactNumber" },
  { token: "{{caller_number}}", key: "dash.agent.var.caller" },
];

const RULES_HEADING = "## Rules for every call";

type AiAction = "generate_prompt" | "improve_prompt" | "first_message";

export function AgentPromptForm({
  wid,
  agent,
  defaultBusiness,
  callRules,
  ai,
  readOnly,
}: {
  wid: number;
  agent: AgentFormValues;
  defaultBusiness: string;
  callRules: string;
  ai: { available: boolean; used: number; limit: number };
  readOnly: boolean;
}) {
  const t = useT();
  const [state, action] = useSave();
  const [prompt, setPrompt] = useState(agent.systemPrompt);
  const [first, setFirst] = useState(agent.firstMessage);
  const [business, setBusiness] = useState(agent.settings.businessName);
  const [target, setTarget] = useState<"prompt" | "first">("prompt");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const firstRef = useRef<HTMLTextAreaElement>(null);
  const [aiState, setAiState] = useState<{ action: AiAction; results: string[]; error: string } | null>(null);
  const [aiUsage, setAiUsage] = useState({ used: ai.used, limit: ai.limit });
  const [aiPending, startAi] = useTransition();
  const [about, setAbout] = useState("");
  const [goal, setGoal] = useState("");
  const [tone, setTone] = useState("friendly");

  const businessName = business.trim() || defaultBusiness;
  const disclosed = hasAiDisclosure(first);
  const named = first.toLowerCase().includes(businessName.toLowerCase()) || /\{\{\s*business_name/.test(first);
  const fixed = useMemo(() => (first.trim() ? ensureDisclosure(first.replace(/\{\{\s*business_name\s*(\|[^}]*)?\}\}/g, businessName), businessName, agent.language) : ""), [first, businessName, agent.language]);
  const variables = useMemo(() => promptVariableNames(`${prompt}\n${first}`), [prompt, first]);
  const sample = useMemo(
    () =>
      renderPromptVariables(first, { firstName: "Maria", lastName: "Lopez", phone: "+14155550123", email: "maria@example.com", company: "Lopez Dental", fields: { appointment_time: "Tuesday at 3 pm" } }, {
        business_name: businessName,
        today: new Date().toISOString().slice(0, 10),
        timezone: "America/New_York",
        caller_number: "+14155550123",
        contact_number: "+14155550123",
      }),
    [first, businessName],
  );

  const insert = (token: string) => {
    const el = target === "first" ? firstRef.current : promptRef.current;
    const set = target === "first" ? setFirst : setPrompt;
    const value = target === "first" ? first : prompt;
    if (!el) return set(value + token);
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const runAssistant = (kind: AiAction) => {
    const input = kind === "generate_prompt" ? about : kind === "improve_prompt" ? prompt : first;
    startAi(async () => {
      const res = await aiAssistAction({ wid, agentId: agent.id, action: kind, text: input, goal, tone });
      if ("results" in res) {
        setAiState({ action: kind, results: res.results, error: "" });
        setAiUsage({ used: res.used, limit: res.limit });
      } else setAiState({ action: kind, results: [], error: res.error });
    });
  };

  const apply = (value: string) => {
    if (aiState?.action === "first_message") setFirst(value);
    else setPrompt(value);
    setAiState(null);
  };

  return (
    <form action={action} className="space-y-6">
      <Hidden wid={wid} agentId={agent.id} section="prompt" />
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Field label={t("dash.agent.business")} htmlFor="p-business" hint={t("dash.agent.businessHint", { name: defaultBusiness })}>
            <Input id="p-business" name="business_name" value={business} onChange={(e) => setBusiness(e.target.value)} maxLength={120} placeholder={defaultBusiness} dir="auto" />
          </Field>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="p-first" className="text-sm font-medium">
              {t("dash.agent.firstMessage")}
            </label>
            {!readOnly && ai.available ? (
              <Button variant="ghost" size="sm" onClick={() => runAssistant("first_message")} disabled={aiPending}>
                <Wand2 aria-hidden />
                {t("dash.ai.firstMessage")}
              </Button>
            ) : null}
          </div>
          <Textarea id="p-first" ref={firstRef} name="first_message" value={first} onChange={(e) => setFirst(e.target.value)} onFocus={() => setTarget("first")} rows={3} className="min-h-20" maxLength={2000} dir="auto" required />
          <div className={cn("mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", disclosed && named ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200")} role="status">
            {disclosed && named ? <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{disclosed && named ? t("dash.agent.disclosureOk") : t("dash.agent.disclosureMissing")}</p>
              {!(disclosed && named) && fixed ? (
                <p>
                  {t("dash.agent.disclosureWillBe")} <q dir="auto" className="italic">{fixed}</q>
                </p>
              ) : null}
              <p className="opacity-90">{t("dash.agent.disclosureWhy")}</p>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="p-prompt" className="text-sm font-medium">
              {t("dash.agent.systemPrompt")}
            </label>
            <span className="text-xs text-muted tabular-nums">{t("dash.agent.chars", { n: prompt.length.toLocaleString() })}</span>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t("dash.agent.variables")}>
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <Braces className="size-3.5" aria-hidden />
              {t("dash.agent.insertInto", { field: target === "first" ? t("dash.agent.firstMessage") : t("dash.agent.systemPrompt") })}
            </span>
            {VARIABLES.map((v) => (
              <button
                key={v.token}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(v.token)}
                title={v.token}
                className="rounded-md border border-line bg-paper px-2 py-1 text-xs hover:border-primary-line hover:text-primary"
              >
                {t(v.key)}
              </button>
            ))}
          </div>
          <Textarea id="p-prompt" ref={promptRef} name="system_prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} onFocus={() => setTarget("prompt")} rows={16} className="font-mono text-[13px]" dir="auto" />
          <Hint>{t("dash.agent.variablesHint")}</Hint>
          {variables.length ? (
            <p className="mt-1 text-xs text-muted">
              {t("dash.agent.variablesUsed")}{" "}
              {variables.map((v) => (
                <code key={v} dir="ltr" className="me-1 rounded bg-line/60 px-1">
                  {v}
                </code>
              ))}
            </p>
          ) : null}
          {!prompt.includes(RULES_HEADING) ? (
            <details className="mt-3 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">{t("dash.agent.rulesTitle")}</summary>
              <p className="mt-2 text-xs text-muted">{t("dash.agent.rulesText")}</p>
              <pre dir="ltr" className="mt-2 max-h-48 overflow-auto text-start text-xs whitespace-pre-wrap">{callRules}</pre>
              {!readOnly ? (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => setPrompt(`${prompt.trim()}\n\n${callRules}`.trim())}>
                  <Plus aria-hidden />
                  {t("dash.agent.rulesAdd")}
                </Button>
              ) : null}
            </details>
          ) : null}
          <details className="mt-3 rounded-lg border border-line px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">{t("dash.agent.previewTitle")}</summary>
            <p className="mt-2 text-xs text-muted">{t("dash.agent.previewText")}</p>
            <p dir="auto" className="mt-2 rounded-md bg-paper px-3 py-2">
              {sample}
            </p>
          </details>
        </div>

        {!readOnly ? (
          <section className="rounded-xl border border-primary-line bg-primary-soft/40 p-4" aria-labelledby="ai-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="ai-title" className="flex items-center gap-2 font-sans text-sm font-semibold">
                <Sparkles className="size-4 text-primary" aria-hidden />
                {t("dash.ai.title")}
              </h3>
              {ai.available ? <span className="text-xs text-muted">{aiUsage.limit < 0 ? t("dash.ai.usageUnlimited", { used: aiUsage.used }) : t("dash.ai.usage", { used: aiUsage.used, limit: aiUsage.limit })}</span> : null}
            </div>
            {ai.available ? (
              <div className="mt-3 space-y-3">
                <Field label={t("dash.ai.about")} htmlFor="ai-about" hint={t("dash.ai.aboutHint")}>
                  <Textarea id="ai-about" value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className="min-h-20" maxLength={4000} dir="auto" placeholder={t("dash.ai.aboutPlaceholder")} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("dash.ai.goal")} htmlFor="ai-goal">
                    <Input id="ai-goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={300} dir="auto" placeholder={t("dash.ai.goalPlaceholder")} />
                  </Field>
                  <Field label={t("dash.ai.tone")} htmlFor="ai-tone">
                    <Select id="ai-tone" value={tone} onChange={(e) => setTone(e.target.value)}>
                      {(["friendly", "professional", "warm", "concise", "upbeat"] as const).map((k) => (
                        <option key={k} value={k}>
                          {t(`dash.ai.tone.${k}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => runAssistant("generate_prompt")} disabled={aiPending || !about.trim()}>
                    <Sparkles aria-hidden />
                    {t("dash.ai.generate")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runAssistant("improve_prompt")} disabled={aiPending || !prompt.trim()}>
                    <Wand2 aria-hidden />
                    {t("dash.ai.improve")}
                  </Button>
                  {aiPending ? <span className="self-center text-xs text-muted" role="status">{t("dash.ai.working")}</span> : null}
                </div>
                {aiState?.error ? <Alert tone="error">{aiState.error}</Alert> : null}
                {aiState?.results.length ? (
                  <div className="space-y-2" aria-live="polite">
                    <p className="text-xs font-medium text-muted">{aiState.action === "first_message" ? t("dash.ai.pickFirst") : t("dash.ai.resultTitle")}</p>
                    {aiState.results.map((r, i) => (
                      <div key={i} className="rounded-lg border border-line bg-surface p-3">
                        <p dir="auto" className="max-h-64 overflow-y-auto text-sm whitespace-pre-wrap">
                          {r}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => apply(r)}>
                            <Check aria-hidden />
                            {aiState.action === "first_message" ? t("dash.ai.useFirst") : t("dash.ai.usePrompt")}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setAiState(null)}>
                            {t("dash.ai.discard")}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Hint>{t("dash.ai.reviewHint")}</Hint>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">{t("dash.ai.notConfigured")}</p>
            )}
          </section>
        ) : null}
      </fieldset>
      <SaveRow state={state} readOnly={readOnly} />
    </form>
  );
}

// ── Behaviour ──

export function AgentBehaviourForm({
  wid,
  agent,
  recordingNotice,
  voicemailSupported,
  readOnly,
}: {
  wid: number;
  agent: AgentFormValues;
  recordingNotice: string;
  voicemailSupported: boolean;
  readOnly: boolean;
}) {
  const t = useT();
  const [state, action] = useSave();
  const s = agent.settings;
  const [interruption, setInterruption] = useState<InterruptionSensitivity>(s.interruptionSensitivity);
  const [voicemail, setVoicemail] = useState(s.voicemailAction);
  const [recording, setRecording] = useState(s.recording);
  const [temperature, setTemperature] = useState(s.temperature);
  const [speed, setSpeed] = useState(s.speed);
  return (
    <form action={action} className="space-y-6">
      <Hidden wid={wid} agentId={agent.id} section="behaviour" />
      <input type="hidden" name="interruption" value={interruption} />
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("dash.agent.maxDuration")} htmlFor="b-max" hint={t("dash.agent.maxDurationHint")}>
            <Input id="b-max" name="max_duration_min" type="number" min={1} max={60} step={1} defaultValue={Math.round(s.maxDurationSec / 60)} dir="ltr" />
          </Field>
          <Field label={t("dash.agent.silence")} htmlFor="b-silence" hint={t("dash.agent.silenceHint")}>
            <Input id="b-silence" name="silence_timeout" type="number" min={5} max={120} step={1} defaultValue={s.silenceTimeoutSec} dir="ltr" />
          </Field>
          <Field label={t("dash.agent.transfer")} htmlFor="b-transfer" hint={t("dash.agent.transferHint")}>
            <Input id="b-transfer" name="transfer_number" type="tel" defaultValue={s.transferNumber} placeholder="+14155550123" dir="ltr" />
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t("dash.agent.interruption")}</p>
          <Segmented<InterruptionSensitivity>
            value={interruption}
            onChange={setInterruption}
            label={t("dash.agent.interruption")}
            options={INTERRUPTION_LEVELS.map((l) => ({ value: l, label: t(`dash.agent.interruption.${l}`) }))}
          />
          <Hint>{t("dash.agent.interruptionHint")}</Hint>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.agent.temperature", { value: temperature.toFixed(2) })} htmlFor="b-temp" hint={t("dash.agent.temperatureHint")}>
            <input id="b-temp" name="temperature" type="range" min={0} max={1} step={0.05} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
          </Field>
          <Field label={t("dash.agent.speed", { value: speed.toFixed(2) })} htmlFor="b-speed" hint={t("dash.agent.speedHint")}>
            <input id="b-speed" name="speed" type="range" min={0.7} max={1.3} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
          </Field>
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("dash.agent.voicemail")}</legend>
          {!voicemailSupported ? <Hint>{t("dash.agent.voicemailUnsupported")}</Hint> : null}
          <div className="flex flex-wrap gap-4">
            {(["hangup", "leave_message"] as const).map((v) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm">
                <input type="radio" name="voicemail_action" value={v} checked={voicemail === v} onChange={() => setVoicemail(v)} className="accent-[var(--primary)]" />
                {t(`dash.agent.voicemail.${v}`)}
              </label>
            ))}
          </div>
          {voicemail === "leave_message" ? (
            <Textarea name="voicemail_message" defaultValue={s.voicemailMessage} rows={3} className="min-h-20" maxLength={600} dir="auto" placeholder={t("dash.agent.voicemailPlaceholder")} aria-label={t("dash.agent.voicemailMessage")} />
          ) : (
            <input type="hidden" name="voicemail_message" value={s.voicemailMessage} />
          )}
        </fieldset>
        <Field label={t("dash.agent.endConditions")} htmlFor="b-end" hint={t("dash.agent.endConditionsHint")}>
          <Textarea id="b-end" name="end_conditions" defaultValue={s.endCallConditions.join("\n")} rows={4} className="min-h-24" dir="auto" />
        </Field>
        <div className="rounded-xl border border-line p-4">
          <Switch name="recording" checked={recording} onChange={(e) => setRecording(e.target.checked)} label={t("dash.agent.recording")} description={t("dash.agent.recordingHint")} />
          {recording ? (
            <p className="mt-3 rounded-md bg-paper px-3 py-2 text-xs text-muted">
              {t("dash.agent.recordingNotice")} <q dir="auto">{recordingNotice}</q>
            </p>
          ) : null}
        </div>
      </fieldset>
      <SaveRow state={state} readOnly={readOnly} />
    </form>
  );
}

// ── Post-call analysis ──

interface FieldRow extends AnalysisField {
  uid: number;
}

let rowSeq = 0;
const toRows = (fields: AnalysisField[]): FieldRow[] => fields.map((f) => ({ ...f, uid: ++rowSeq }));

export function AgentAnalysisForm({ wid, agent, readOnly }: { wid: number; agent: AgentFormValues; readOnly: boolean }) {
  const t = useT();
  const [state, action] = useSave();
  const [rows, setRows] = useState<FieldRow[]>(() => toRows(agent.settings.analysisFields));
  const update = (uid: number, patch: Partial<AnalysisField>) => setRows((r) => r.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const next = [...r];
      const j = i + d;
      if (j < 0 || j >= next.length) return r;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const payload = JSON.stringify(rows.map((r) => ({ key: r.key || r.label, label: r.label, type: r.type, description: r.description, options: r.options, required: r.required })));
  return (
    <form action={action} className="space-y-5">
      <Hidden wid={wid} agentId={agent.id} section="analysis" />
      <input type="hidden" name="fields" value={payload} />
      <fieldset disabled={readOnly} className="space-y-5">
        <Alert tone="info">{t("dash.agent.analysisAlways")}</Alert>
        <Field label={t("dash.agent.success")} htmlFor="an-success" hint={t("dash.agent.successHint")}>
          <Textarea id="an-success" name="success_criteria" defaultValue={agent.settings.successCriteria} rows={2} className="min-h-16" maxLength={600} dir="auto" />
        </Field>
        <div>
          <p className="text-sm font-medium">{t("dash.agent.fields")}</p>
          <Hint className="mb-3">{t("dash.agent.fieldsHint")}</Hint>
          <ol className="space-y-3">
            {rows.map((row, i) => (
              <li key={row.uid} className="rounded-xl border border-line bg-surface p-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px]">
                  <Field label={t("dash.agent.fieldLabel")} htmlFor={`f-label-${row.uid}`}>
                    <Input id={`f-label-${row.uid}`} value={row.label} onChange={(e) => update(row.uid, { label: e.target.value })} maxLength={80} dir="auto" />
                  </Field>
                  <Field label={t("dash.agent.fieldKey")} htmlFor={`f-key-${row.uid}`}>
                    <Input
                      id={`f-key-${row.uid}`}
                      value={row.key}
                      onChange={(e) => update(row.uid, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) })}
                      placeholder={row.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}
                      className="font-mono text-[13px]"
                      dir="ltr"
                    />
                  </Field>
                  <Field label={t("dash.agent.fieldType")} htmlFor={`f-type-${row.uid}`}>
                    <Select id={`f-type-${row.uid}`} value={row.type} onChange={(e) => update(row.uid, { type: e.target.value as AnalysisFieldType })}>
                      {ANALYSIS_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`dash.agent.fieldType.${type}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("dash.agent.fieldDescription")} htmlFor={`f-desc-${row.uid}`} className="sm:col-span-2 lg:col-span-3">
                    <Input id={`f-desc-${row.uid}`} value={row.description} onChange={(e) => update(row.uid, { description: e.target.value })} maxLength={300} dir="auto" placeholder={t("dash.agent.fieldDescriptionPlaceholder")} />
                  </Field>
                  {row.type === "enum" ? (
                    <Field label={t("dash.agent.fieldOptions")} htmlFor={`f-opt-${row.uid}`} hint={t("dash.agent.fieldOptionsHint")} className="sm:col-span-2 lg:col-span-3">
                      <Input
                        id={`f-opt-${row.uid}`}
                        defaultValue={row.options.join(", ")}
                        onChange={(e) =>
                          update(row.uid, {
                            options: e.target.value
                              .split(",")
                              .map((o) => o.trim())
                              .filter(Boolean),
                          })
                        }
                        dir="auto"
                      />
                    </Field>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Checkbox label={t("dash.agent.fieldRequired")} checked={row.required} onChange={(e) => update(row.uid, { required: e.target.checked })} />
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("dash.agent.moveUp")} title={t("dash.agent.moveUp")}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={t("dash.agent.moveDown")} title={t("dash.agent.moveDown")}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((x) => x.uid !== row.uid))} aria-label={t("dash.agent.fieldRemove")} title={t("dash.agent.fieldRemove")} className="hover:text-red-600">
                      <Trash aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {!rows.length ? <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t("dash.agent.fieldsEmpty")}</p> : null}
          {!readOnly && rows.length < 25 ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setRows((r) => [...r, { uid: ++rowSeq, key: "", label: "", type: "string", description: "", options: [], required: false }])}>
              <Plus aria-hidden />
              {t("dash.agent.fieldAdd")}
            </Button>
          ) : null}
        </div>
      </fieldset>
      <SaveRow state={state} readOnly={readOnly} />
    </form>
  );
}
