"use client";

import { useState } from "react";
import { CalendarCheck, CalendarDays, ChevronDown, FlaskConical, Link2, PhoneForwarded, PhoneOff, Plug, Plus, Sheet, Trash, Unplug, Webhook, type LucideIcon } from "lucide-react";
import { deleteToolAction, saveToolAction, testToolAction, toggleAgentToolAction } from "@/app/actions/dashboard/agents";
import { ActionButton } from "@/components/dashboard/actions";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { TOOL_KINDS, type ToolKind, type ToolParameter } from "@/voice/types";

export interface ToolView {
  id: number;
  kind: ToolKind;
  name: string;
  description: string;
  status: "active" | "error" | "disabled";
  lastError: string | null;
  attached: boolean;
  /** Other agents using it. */
  usedByOthers: number;
  config: Record<string, unknown>;
  secretsSet: string[];
}

const ICONS: Record<ToolKind, LucideIcon> = {
  cal_com: CalendarCheck,
  google_calendar: CalendarDays,
  webhook: Webhook,
  google_sheets: Sheet,
  transfer: PhoneForwarded,
  end_call: PhoneOff,
};

const SERVER_TOOLS: ToolKind[] = ["cal_com", "google_calendar", "webhook", "google_sheets"];

const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** A secret input that keeps the stored value when left empty. */
function SecretField({ id, name, label, isSet, hint }: { id: string; name: string; label: string; isSet: boolean; hint?: string }) {
  const t = useT();
  return (
    <Field label={label} htmlFor={id} hint={isSet ? t("dash.tool.secretKept") : hint}>
      <Input id={id} name={name} type="password" autoComplete="off" spellCheck={false} dir="ltr" className="font-mono text-[13px]" placeholder={isSet ? "••••••••" : ""} />
    </Field>
  );
}

function ParametersEditor({ initial }: { initial: ToolParameter[] }) {
  const t = useT();
  const [rows, setRows] = useState<ToolParameter[]>(initial);
  const update = (i: number, patch: Partial<ToolParameter>) => setRows((r) => r.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div>
      <input type="hidden" name="parameters" value={JSON.stringify(rows)} />
      <p className="mb-1.5 text-sm font-medium">{t("dash.tool.parameters")}</p>
      <p className="mb-2 text-xs text-muted">{t("dash.tool.parametersHint")}</p>
      <ul className="space-y-2">
        {rows.map((p, i) => (
          <li key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_120px_2fr_auto] sm:items-center">
            <Input value={p.name} onChange={(e) => update(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) })} placeholder="order_number" aria-label={t("dash.tool.paramName")} className="font-mono text-[13px]" dir="ltr" />
            <Select value={p.type} onChange={(e) => update(i, { type: e.target.value as ToolParameter["type"] })} aria-label={t("dash.tool.paramType")}>
              <option value="string">{t("dash.agent.fieldType.string")}</option>
              <option value="number">{t("dash.agent.fieldType.number")}</option>
              <option value="boolean">{t("dash.agent.fieldType.boolean")}</option>
            </Select>
            <Input value={p.description} onChange={(e) => update(i, { description: e.target.value.slice(0, 200) })} placeholder={t("dash.tool.paramDescription")} aria-label={t("dash.tool.paramDescription")} dir="auto" />
            <div className="flex items-center gap-2">
              <Checkbox label={t("dash.agent.fieldRequired")} checked={p.required} onChange={(e) => update(i, { required: e.target.checked })} />
              <Button variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={t("dash.agent.fieldRemove")} className="hover:text-red-600">
                <Trash aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {rows.length < 20 ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setRows((r) => [...r, { name: "", type: "string", description: "", required: false }])}>
          <Plus aria-hidden />
          {t("dash.tool.paramAdd")}
        </Button>
      ) : null}
    </div>
  );
}

function HeadersEditor({ initial, isSet }: { initial: Record<string, unknown>; isSet: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<Array<{ name: string; value: string }>>(() => Object.keys(initial).map((name) => ({ name, value: "" })));
  const value = JSON.stringify(Object.fromEntries(rows.filter((r) => r.name.trim()).map((r) => [r.name.trim(), r.value])));
  return (
    <div>
      <input type="hidden" name="headers" value={value} />
      <p className="mb-1.5 text-sm font-medium">{t("dash.tool.headers")}</p>
      {isSet ? <p className="mb-2 text-xs text-muted">{t("dash.tool.headersKept")}</p> : null}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-col gap-2 sm:flex-row">
            <Input value={r.name} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value.replace(/[^A-Za-z0-9-]/g, "") } : y)))} placeholder="X-Api-Key" aria-label={t("dash.tool.headerName")} className="font-mono text-[13px] sm:w-48" dir="ltr" />
            <Input value={r.value} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} type="password" autoComplete="off" placeholder={isSet ? "••••••••" : ""} aria-label={t("dash.tool.headerValue")} className="font-mono text-[13px]" dir="ltr" />
            <Button variant="ghost" size="sm" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={t("dash.agent.fieldRemove")} className="self-end hover:text-red-600 sm:self-auto">
              <Trash aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {rows.length < 10 ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setRows((x) => [...x, { name: "", value: "" }])}>
          <Plus aria-hidden />
          {t("dash.tool.headerAdd")}
        </Button>
      ) : null}
    </div>
  );
}

/** Create / edit form of one tool kind. */
function ToolForm({ wid, agentId, kind, tool, timezones, defaultTimezone, googleConfigured, warmTransfer, onDone }: { wid: number; agentId: number; kind: ToolKind; tool?: ToolView; timezones: string[]; defaultTimezone: string; googleConfigured: boolean; warmTransfer: boolean; onDone?: () => void }) {
  const t = useT();
  const [state, action] = useRefreshingAction(async (prev: { error?: string; success?: string }, fd: FormData) => {
    const res = await saveToolAction(prev, fd);
    if (!res.error) onDone?.();
    return res;
  });
  const c = tool?.config ?? {};
  const set = (f: string) => tool?.secretsSet.includes(f) ?? false;
  const p = `tool-${tool?.id ?? `new-${kind}`}`;
  const tzSelect = (name: string, value: string) => (
    <Select id={`${p}-${name}`} name={name} defaultValue={value || defaultTimezone}>
      {timezones.map((z) => (
        <option key={z} value={z}>
          {z.replaceAll("_", " ")}
        </option>
      ))}
    </Select>
  );
  const hours = (c.hours ?? {}) as { start?: string; end?: string; days?: number[] };
  const google = kind === "google_calendar" || kind === "google_sheets";
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="wid" value={wid} />
      <input type="hidden" name="agent_id" value={agentId} />
      <input type="hidden" name="kind" value={kind} />
      {tool ? <input type="hidden" name="tool_id" value={tool.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.tool.name")} htmlFor={`${p}-name`} hint={t("dash.tool.nameHint")}>
          <Input id={`${p}-name`} name="name" defaultValue={tool?.name ?? ""} placeholder={t(`dash.tool.defaultName.${kind}`)} className="font-mono text-[13px]" dir="ltr" maxLength={40} />
        </Field>
        <Field label={t("dash.tool.description")} htmlFor={`${p}-desc`} hint={t("dash.tool.descriptionHint")}>
          <Input id={`${p}-desc`} name="description" defaultValue={tool?.description ?? ""} maxLength={500} dir="auto" />
        </Field>
      </div>

      {google ? (
        <div className="rounded-lg border border-line bg-paper p-3 text-sm">
          {!googleConfigured ? (
            <p className="text-amber-700 dark:text-amber-300">{t("dash.tool.googleNotConfigured")}</p>
          ) : tool && s(c.accountEmail) ? (
            <p className="flex flex-wrap items-center gap-2">
              <Plug className="size-4 text-emerald-600" aria-hidden />
              {t("dash.tool.googleConnected", { email: s(c.accountEmail) })}
              <ButtonLink variant="outline" size="sm" href={`/api/oauth/google/start?wid=${wid}&tool=${tool.id}&service=${kind}&agent=${agentId}`} prefetch={false}>
                {t("dash.tool.googleReconnect")}
              </ButtonLink>
            </p>
          ) : tool ? (
            <p className="flex flex-wrap items-center gap-2">
              <Unplug className="size-4 text-amber-600" aria-hidden />
              {t("dash.tool.googleNotConnected")}
              <ButtonLink size="sm" href={`/api/oauth/google/start?wid=${wid}&tool=${tool.id}&service=${kind}&agent=${agentId}`} prefetch={false}>
                {t("dash.tool.googleConnect")}
              </ButtonLink>
            </p>
          ) : (
            <p className="text-muted">{t("dash.tool.googleAfterSave")}</p>
          )}
        </div>
      ) : null}

      {kind === "cal_com" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SecretField id={`${p}-key`} name="api_key" label={t("dash.tool.calKey")} isSet={set("apiKey")} hint={t("dash.tool.calKeyHint")} />
          <Field label={t("dash.tool.calEvent")} htmlFor={`${p}-event`} hint={t("dash.tool.calEventHint")}>
            <Input id={`${p}-event`} name="event_type_id" type="number" min={1} defaultValue={s(c.eventTypeId) === "0" ? "" : s(c.eventTypeId)} dir="ltr" required />
          </Field>
          <Field label={t("dash.tool.timezone")} htmlFor={`${p}-timezone`}>
            {tzSelect("timezone", s(c.timezone))}
          </Field>
          <Field label={t("dash.tool.calBase")} htmlFor={`${p}-base`} hint={t("dash.tool.calBaseHint")}>
            <Input id={`${p}-base`} name="api_base" type="url" defaultValue={s(c.apiBase)} placeholder="https://api.cal.com" dir="ltr" />
          </Field>
        </div>
      ) : null}

      {kind === "google_calendar" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("dash.tool.calendarId")} htmlFor={`${p}-cal`} hint={t("dash.tool.calendarIdHint")}>
            <Input id={`${p}-cal`} name="calendar_id" defaultValue={s(c.calendarId) || "primary"} dir="ltr" />
          </Field>
          <Field label={t("dash.tool.duration")} htmlFor={`${p}-dur`}>
            <Input id={`${p}-dur`} name="duration_min" type="number" min={5} max={480} defaultValue={s(c.durationMin) || "30"} dir="ltr" />
          </Field>
          <Field label={t("dash.tool.buffer")} htmlFor={`${p}-buf`}>
            <Input id={`${p}-buf`} name="buffer_min" type="number" min={0} max={240} defaultValue={s(c.bufferMin) || "0"} dir="ltr" />
          </Field>
          <Field label={t("dash.tool.timezone")} htmlFor={`${p}-timezone`}>
            {tzSelect("timezone", s(c.timezone))}
          </Field>
          <Field label={t("dash.tool.hoursStart")} htmlFor={`${p}-hs`}>
            <Input id={`${p}-hs`} name="hours_start" type="time" defaultValue={hours.start ?? "09:00"} dir="ltr" />
          </Field>
          <Field label={t("dash.tool.hoursEnd")} htmlFor={`${p}-he`}>
            <Input id={`${p}-he`} name="hours_end" type="time" defaultValue={hours.end ?? "17:00"} dir="ltr" />
          </Field>
          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="mb-1.5 text-sm font-medium">{t("dash.tool.days")}</legend>
            <div className="flex flex-wrap gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <Checkbox key={d} name="hours_days" value={d} defaultChecked={(hours.days ?? [1, 2, 3, 4, 5]).includes(d)} label={t(`dash.tool.day.${d}` as `dash.tool.day.${1 | 2 | 3 | 4 | 5 | 6 | 7}`)} />
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}

      {kind === "webhook" ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label={t("dash.tool.url")} htmlFor={`${p}-url`} hint={t("dash.tool.urlPostHint")}>
              <Input id={`${p}-url`} name="url" type="url" required defaultValue={s(c.url)} placeholder="https://example.com/api/lookup" dir="ltr" />
            </Field>
            <Field label={t("dash.tool.timeout")} htmlFor={`${p}-timeout`}>
              <Input id={`${p}-timeout`} name="timeout_ms" type="number" min={500} max={10000} step={100} defaultValue={s(c.timeoutMs) || "3000"} dir="ltr" />
            </Field>
          </div>
          <SecretField id={`${p}-secret`} name="secret" label={t("dash.tool.secret")} isSet={set("secret")} hint={t("dash.tool.secretHint")} />
          <HeadersEditor initial={(c.headers ?? {}) as Record<string, unknown>} isSet={set("headers")} />
          <ParametersEditor initial={((c.parameters ?? []) as ToolParameter[]).map((x) => ({ ...x }))} />
        </div>
      ) : null}

      {kind === "google_sheets" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.tool.sheetId")} htmlFor={`${p}-sheet`} hint={t("dash.tool.sheetIdHint")}>
            <Input id={`${p}-sheet`} name="spreadsheet_id" required defaultValue={s(c.spreadsheetId)} dir="ltr" />
          </Field>
          <Field label={t("dash.tool.sheetName")} htmlFor={`${p}-tab`}>
            <Input id={`${p}-tab`} name="sheet_name" defaultValue={s(c.sheetName) || "Sheet1"} dir="auto" />
          </Field>
          <Field label={t("dash.tool.columns")} htmlFor={`${p}-cols`} hint={t("dash.tool.columnsHint")} className="sm:col-span-2">
            <Input id={`${p}-cols`} name="columns" defaultValue={((c.columns ?? []) as string[]).join(", ")} placeholder="caller_name, caller_number, summary" dir="ltr" />
          </Field>
        </div>
      ) : null}

      {kind === "transfer" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("dash.tool.transferNumber")} htmlFor={`${p}-num`} hint={t("dash.tool.transferNumberHint")}>
            <Input id={`${p}-num`} name="number" type="tel" required defaultValue={s(c.number)} placeholder="+14155550123" dir="ltr" />
          </Field>
          <Field label={t("dash.tool.transferMode")} htmlFor={`${p}-mode`} hint={warmTransfer ? undefined : t("dash.tool.warmUnsupported")}>
            <Select id={`${p}-mode`} name="mode" defaultValue={warmTransfer ? s(c.mode) || "cold" : "cold"}>
              <option value="cold">{t("dash.tool.mode.cold")}</option>
              <option value="warm" disabled={!warmTransfer}>
                {t("dash.tool.mode.warm")}
              </option>
            </Select>
          </Field>
          <Field label={t("dash.tool.whisper")} htmlFor={`${p}-whisper`} hint={t("dash.tool.whisperHint")} className="sm:col-span-2">
            <Input id={`${p}-whisper`} name="whisper" defaultValue={s(c.whisper)} maxLength={300} dir="auto" />
          </Field>
        </div>
      ) : null}

      {kind === "end_call" ? (
        <Field label={t("dash.tool.instructions")} htmlFor={`${p}-ins`} hint={t("dash.tool.instructionsHint")}>
          <Textarea id={`${p}-ins`} name="instructions" defaultValue={s(c.instructions)} rows={3} className="min-h-20" maxLength={500} dir="auto" />
        </Field>
      ) : null}

      <FormMessage state={state} />
      <SubmitButton pendingText={t("dash.agent.saving")}>{tool ? t("dash.tool.save") : t("dash.tool.createAttach")}</SubmitButton>
    </form>
  );
}

/** The Tools tab: tools of this agent, other workspace tools to attach, and new tools. */
export function ToolsPanel({
  wid,
  agentId,
  tools,
  endpointBase,
  timezones,
  defaultTimezone,
  googleConfigured,
  readOnly,
  warmTransfer = true,
}: {
  wid: number;
  agentId: number;
  tools: ToolView[];
  endpointBase: string;
  timezones: string[];
  defaultTimezone: string;
  googleConfigured: boolean;
  readOnly: boolean;
  /** The agent's provider can introduce the caller before transferring (Retell: cold transfers only). */
  warmTransfer?: boolean;
}) {
  const t = useT();
  const [adding, setAdding] = useState<ToolKind | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const attached = tools.filter((x) => x.attached);
  const others = tools.filter((x) => !x.attached);
  const props = { wid, agentId, timezones, defaultTimezone, googleConfigured, warmTransfer };

  const card = (tool: ToolView) => {
    const Icon = ICONS[tool.kind];
    return (
      <li key={tool.id} className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-48">
            <p className="flex flex-wrap items-center gap-2">
              <code dir="ltr" className="text-sm font-semibold break-all">
                {tool.name}
              </code>
              <Badge>{t(`dash.tool.kind.${tool.kind}`)}</Badge>
              {tool.status === "error" ? <Badge tone="danger">{t("dash.tool.statusError")}</Badge> : null}
              {tool.usedByOthers ? <Badge tone="primary">{t("dash.tool.usedBy", { n: tool.usedByOthers })}</Badge> : null}
            </p>
            <p className="mt-1 text-sm text-muted" dir="auto">
              {tool.description}
            </p>
            {tool.status === "error" && tool.lastError ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{tool.lastError}</p> : null}
          </div>
          {!readOnly ? (
            <div className="flex w-full flex-wrap items-start gap-2 lg:w-auto">
              {tool.kind !== "end_call" ? (
                <ActionButton action={testToolAction} fields={{ wid, tool_id: tool.id }} showSuccess>
                  <FlaskConical aria-hidden />
                  {t("dash.tool.test")}
                </ActionButton>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setEditing(editing === tool.id ? null : tool.id)} aria-expanded={editing === tool.id}>
                {t("dash.tool.edit")}
                <ChevronDown className={cn("transition-transform", editing === tool.id && "rotate-180")} aria-hidden />
              </Button>
              <ActionButton action={toggleAgentToolAction} fields={{ wid, agent_id: agentId, tool_id: tool.id, attach: tool.attached ? "0" : "1" }}>
                {tool.attached ? t("dash.tool.detach") : t("dash.tool.attach")}
              </ActionButton>
              <ActionButton
                action={deleteToolAction}
                fields={{ wid, agent_id: agentId, tool_id: tool.id }}
                confirmText={tool.usedByOthers ? t("dash.tool.deleteUsedConfirm", { name: tool.name, n: tool.usedByOthers }) : t("dash.tool.deleteConfirm", { name: tool.name })}
                label={t("dash.tool.delete")}
                variant="ghost"
                buttonClassName="hover:text-red-600"
              >
                <Trash aria-hidden />
              </ActionButton>
            </div>
          ) : null}
        </div>
        {editing === tool.id && !readOnly ? (
          <div className="space-y-4 border-t border-line p-4">
            {SERVER_TOOLS.includes(tool.kind) ? (
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">{t("dash.tool.endpoint")}</summary>
                <p className="mt-1">{t("dash.tool.endpointHint")}</p>
                <code dir="ltr" className="mt-1 block break-all rounded bg-paper px-2 py-1">
                  {`${endpointBase}/api/voice/tools/${tool.id}?agent=${agentId}`}
                </code>
              </details>
            ) : null}
            <ToolForm {...props} kind={tool.kind} tool={tool} onDone={() => setEditing(null)} />
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="tools-attached">
        <h3 id="tools-attached" className="mb-3 font-sans text-sm font-semibold">
          {t("dash.tool.attachedTitle")}
        </h3>
        {attached.length ? <ul className="space-y-3">{attached.map(card)}</ul> : <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t("dash.tool.noneAttached")}</p>}
      </section>
      {others.length ? (
        <section aria-labelledby="tools-other">
          <h3 id="tools-other" className="mb-1 font-sans text-sm font-semibold">
            {t("dash.tool.otherTitle")}
          </h3>
          <p className="mb-3 text-xs text-muted">{t("dash.tool.otherText")}</p>
          <ul className="space-y-3">{others.map(card)}</ul>
        </section>
      ) : null}
      {!readOnly ? (
        <section className="rounded-xl border border-line bg-surface p-5" aria-labelledby="tools-add">
          <h3 id="tools-add" className="mb-3 font-sans text-sm font-semibold">
            {t("dash.tool.addTitle")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_KINDS.map((kind) => {
              const Icon = ICONS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setAdding(adding === kind ? null : kind)}
                  aria-pressed={adding === kind}
                  className={cn("flex items-start gap-3 rounded-lg border p-3 text-start transition-colors", adding === kind ? "border-primary ring-1 ring-primary" : "border-line hover:border-primary-line")}
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(`dash.tool.kind.${kind}`)}</span>
                    <span className="block text-xs text-muted">{t(`dash.tool.kindText.${kind}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {adding ? (
            <div className="mt-5 border-t border-line pt-5">
              {adding === "transfer" || adding === "end_call" ? <Alert tone="info" className="mb-4">{t("dash.tool.systemNote")}</Alert> : null}
              <ToolForm key={adding} {...props} kind={adding} onDone={() => setAdding(null)} />
            </div>
          ) : null}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
            <Link2 className="size-3.5" aria-hidden />
            {t("dash.tool.reuseNote")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
