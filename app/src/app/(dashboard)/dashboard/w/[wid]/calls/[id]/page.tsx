import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Bot, CircleCheck, CircleHelp, CircleX, Clock, Gauge, Globe, PhoneIncoming, PhoneOutgoing, Trash2, Wrench } from "lucide-react";
import { addCallerToDncAction, deleteCallRecordingAction, eraseCallAction } from "@/app/actions/dashboard/calls";
import { ActionButton } from "@/components/dashboard/actions";
import { CallTranscriptPlayer } from "@/components/dashboard/call-player";
import { KNOWN_OUTCOMES } from "@/components/dashboard/call-query";
import { LocalTime } from "@/components/dashboard/local-time";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { getAgent } from "@/lib/agents";
import { getCall } from "@/lib/calls";
import { dncMatches } from "@/lib/compliance";
import { getContact } from "@/lib/contacts";
import { formatDateTime, formatNumber } from "@/lib/dash-format";
import { getDb } from "@/lib/db";
import { requireWorkspace } from "@/lib/dashboard";
import type { MessageKey } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { recordingForPlayer } from "@/lib/voice-bridge";
import { callStatusTone, formatDuration, formatMicros, providerName, sentimentTone } from "@/voice/format";
import { detectOptOut, formatPhone, roleCan } from "@/voice/normalize";
import type { AnalysisField } from "@/voice/types";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.call.title") };
}

const DIRECTION_ICON = { inbound: PhoneIncoming, outbound: PhoneOutgoing, web: Globe } as const;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

function Check({ state, yes, no, unknown }: { state: boolean | null; yes: string; no: string; unknown: string }) {
  const Icon = state === null ? CircleHelp : state ? CircleCheck : CircleX;
  return (
    <span className={cn("inline-flex items-center gap-1.5", state === null ? "text-muted" : state ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {state === null ? unknown : state ? yes : no}
    </span>
  );
}

/** One call: recording / simulated audio, transcript, analysis, tool calls, costs and compliance facts. */
export default async function CallDetailPage({ params }: { params: Promise<{ wid: string; id: string }> }) {
  const { wid, id } = await params;
  const { user, workspace, role } = await requireWorkspace(wid);
  const [t, locale, settings, call] = await Promise.all([getT(), getLocale(), getSettings(), getCall(workspace.id, Number(id))]);
  if (!call) notFound();
  const lc = locale.code;
  const [agent, contact] = await Promise.all([call.agentId ? getAgent(workspace.id, call.agentId) : undefined, call.contactId ? getContact(workspace.id, call.contactId) : undefined]);
  const db = await getDb();
  const campaign = call.campaignId ? await db.selectFrom("campaigns").select(["id", "name"]).where("id", "=", call.campaignId).where("workspace_id", "=", workspace.id).executeTakeFirst() : undefined;
  const other = call.direction === "inbound" ? call.from : call.to;
  const dnc = other ? await dncMatches(workspace.id, other) : [];
  const optOut = detectOptOut(call.transcript);
  const optedOut = optOut.optOut || call.endReason === "opt_out" || call.outcome === "opt_out" || call.outcome === "opted_out";
  const isSiteAdmin = user.role === "admin";
  const currency = settings.currency || "USD";
  const base = `/dashboard/w/${workspace.id}/calls`;
  const Icon = DIRECTION_ICON[call.direction];
  const contactName = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company : "";
  const fields: AnalysisField[] = agent?.settings.analysisFields ?? [];
  const extractedKeys = [...new Set([...fields.map((f) => f.key), ...Object.keys(call.extracted)])].filter((k) => k in call.extracted);
  const fieldOf = new Map(fields.map((f) => [f.key, f]));
  const recording = await recordingForPlayer(call);
  const yes = t("dash.call.yes");
  const no = t("dash.call.no");
  const unknown = t("dash.call.unknown");
  const outcomeLabel = call.outcome ? ((KNOWN_OUTCOMES as readonly string[]).includes(call.outcome) ? t(`dash.call.outcome.${call.outcome}` as MessageKey) : call.outcome.replace(/_/g, " ")) : "";
  const recordingNotice = agent ? agent.settings.recording : null;
  const webSource = String(call.metadata.web_source ?? call.metadata.source ?? "");

  const value = (key: string): ReactNode => {
    const v = call.extracted[key];
    const field = fieldOf.get(key);
    if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
    if (typeof v === "boolean" || field?.type === "boolean") return v === true || v === "true" ? yes : no;
    if (field?.type === "date" && typeof v === "string" && !Number.isNaN(Date.parse(v))) return formatDateTime(v, lc, /T\d/.test(v));
    if (typeof v === "number") return <bdi>{formatNumber(v, lc)}</bdi>;
    if (typeof v === "object") return <code dir="ltr" className="text-xs">{JSON.stringify(v)}</code>;
    return <span dir="auto">{String(v)}</span>;
  };

  return (
    <>
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.nav.calls")}
      </Link>
      <DashHeader
        title={contactName || (other ? formatPhone(other) : webSource === "widget" ? t("dash.calls.webWidget") : call.direction === "web" ? t("dash.calls.webTest") : t(`dash.call.dir.${call.direction}`))}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <Icon className="size-4" aria-hidden />
              {t(`dash.call.dir.${call.direction}`)}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", callStatusTone(call.status))}>{t(`dash.call.status.${call.status}`)}</span>
            {outcomeLabel && call.outcome !== call.status ? <span className="rounded-full bg-line/70 px-2 py-0.5 text-xs">{outcomeLabel}</span> : null}
            {call.sentiment !== "unknown" ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", sentimentTone(call.sentiment))}>{t(`dash.call.sentiment.${call.sentiment}`)}</span> : null}
            <span>
              <LocalTime iso={call.startedAt ?? call.createdAt} locale={lc} />
            </span>
          </span>
        }
        actions={
          other && roleCan(role, "contacts.manage") && !dnc.some((d) => d.scope === "workspace") ? (
            <ActionButton action={addCallerToDncAction} fields={{ wid: workspace.id, call_id: call.id }} confirmText={t("dash.call.dncConfirm", { phone: formatPhone(other) })} showSuccess>
              <Ban aria-hidden />
              {t("dash.call.addDnc")}
            </ActionButton>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {call.summary ? (
            <Panel title={t("dash.call.summary")}>
              <p dir="auto" className="text-sm leading-relaxed whitespace-pre-wrap">
                {call.summary}
              </p>
            </Panel>
          ) : null}
          <Panel title={t("dash.call.transcript")} description={call.provider === "simulated" ? t("dash.call.simulatedHint") : undefined}>
            <CallTranscriptPlayer turns={call.transcript} recordingSrc={recording.src} recordingUnavailable={recording.unavailable} simulated={call.provider === "simulated"} language={agent?.language ?? workspace.settings.defaultLanguage} />
          </Panel>
          {extractedKeys.length ? (
            <Panel title={t("dash.call.extracted")} padded={false}>
              <dl className="divide-y divide-line">
                {extractedKeys.map((k) => (
                  <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
                    <dt className="text-sm text-muted" dir="auto">
                      {fieldOf.get(k)?.label ?? k.replace(/_/g, " ")}
                    </dt>
                    <dd className="text-sm font-medium break-words">{value(k)}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
          {call.toolCalls.length ? (
            <Panel title={t("dash.call.toolCalls")}>
              <ol className="relative space-y-4 border-s border-line ps-5">
                {call.toolCalls.map((tc, i) => (
                  <li key={i} className="relative">
                    <span className={cn("absolute -start-[1.72rem] top-0.5 grid size-5 place-items-center rounded-full ring-4 ring-surface", tc.ok ? "bg-emerald-500 text-white" : "bg-red-500 text-white")} aria-hidden>
                      <Wrench className="size-3" />
                    </span>
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <code dir="ltr" className="font-semibold">
                        {tc.name}
                      </code>
                      <span className="text-xs text-muted tabular-nums">
                        <bdi>{formatDuration(tc.at)}</bdi> · <bdi>{t("dash.call.toolMs", { ms: formatNumber(tc.durationMs, lc) })}</bdi>
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs", tc.ok ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300")}>{tc.ok ? t("dash.call.toolOk") : t("dash.call.toolFailed")}</span>
                    </p>
                    <details className="mt-1.5 text-xs">
                      <summary className="cursor-pointer text-muted">{t("dash.call.toolDetails")}</summary>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="min-w-0">
                          <p className="mb-1 font-medium">{t("dash.call.toolRequest")}</p>
                          <pre dir="ltr" className="max-h-48 overflow-auto rounded-lg bg-paper p-2 text-start">{JSON.stringify(tc.args, null, 2)}</pre>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 font-medium">{t("dash.call.toolResponse")}</p>
                          <pre dir="auto" className="max-h-48 overflow-auto rounded-lg bg-paper p-2 text-start whitespace-pre-wrap wrap-anywhere">{tc.result || "—"}</pre>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("dash.call.details")}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label={t("dash.call.agent")}>{agent ? <Link href={`/dashboard/w/${workspace.id}/agents/${agent.id}`} className="text-primary hover:underline" dir="auto">{agent.name}</Link> : "—"}</Fact>
              <Fact label={t("dash.call.provider")}>{providerName(call.provider, t)}</Fact>
              <Fact label={t("dash.call.from")}>{call.from ? <bdi dir="ltr">{formatPhone(call.from)}</bdi> : "—"}</Fact>
              <Fact label={t("dash.call.to")}>{call.to ? <bdi dir="ltr">{formatPhone(call.to)}</bdi> : "—"}</Fact>
              {contact ? (
                <Fact label={t("dash.call.contact")}>
                  <span dir="auto">{contactName || formatPhone(contact.phone)}</span>
                </Fact>
              ) : null}
              {campaign ? (
                <Fact label={t("dash.call.campaign")}>
                  <span dir="auto">{campaign.name}</span>
                </Fact>
              ) : null}
              <Fact label={t("dash.call.duration")}>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5 text-muted" aria-hidden />
                  <bdi className="tabular-nums">{formatDuration(call.durationSec)}</bdi>
                </span>
              </Fact>
              <Fact label={t("dash.call.latency")}>
                <span className="inline-flex items-center gap-1">
                  <Gauge className="size-3.5 text-muted" aria-hidden />
                  {call.latencyMs !== null ? <bdi>{t("dash.call.ms", { ms: formatNumber(call.latencyMs, lc) })}</bdi> : "—"}
                </span>
              </Fact>
              <Fact label={t("dash.call.endReason")}>{call.endReason ? t(`dash.call.end.${call.endReason}`) : "—"}</Fact>
              <Fact label={t("dash.call.ended")}>{call.endedAt ? <LocalTime iso={call.endedAt} locale={lc} /> : "—"}</Fact>
            </dl>
            {call.error ? (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300" dir="auto">
                {call.error}
              </p>
            ) : null}
          </Panel>

          <Panel title={t("dash.call.billing")}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label={t("dash.call.billedTime")}>
                <bdi className="tabular-nums">{formatDuration(call.billedSeconds)}</bdi>
              </Fact>
              <Fact label={t("dash.call.includedTime")}>
                <bdi className="tabular-nums">{formatDuration(call.includedSeconds)}</bdi>
              </Fact>
              <Fact label={t("dash.call.credits")}>
                <bdi>{formatMicros(call.creditsSettledMicros, currency, lc)}</bdi>
              </Fact>
              <Fact label={t("dash.call.price")}>
                <bdi>{call.pricePerMinMicros ? t("dash.call.perMin", { price: formatMicros(call.pricePerMinMicros, currency, lc, true) }) : "—"}</bdi>
              </Fact>
              {isSiteAdmin ? (
                <>
                  <Fact label={t("dash.call.providerCost")}>
                    <bdi>{call.providerCostMicros !== null ? formatMicros(call.providerCostMicros, currency, lc, true) : "—"}</bdi>
                  </Fact>
                  <Fact label={t("dash.call.margin")}>
                    <bdi>{call.providerCostMicros !== null ? formatMicros(call.creditsSettledMicros - call.providerCostMicros, currency, lc, true) : "—"}</bdi>
                  </Fact>
                </>
              ) : null}
            </dl>
            {isSiteAdmin ? <p className="mt-3 text-xs text-muted">{t("dash.call.adminOnly")}</p> : null}
          </Panel>

          <Panel title={t("dash.call.compliance")}>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted">{t("dash.call.disclosure")}</dt>
                <dd className="mt-0.5">
                  <Check state={call.disclosurePlayed} yes={t("dash.call.disclosureYes")} no={t("dash.call.disclosureNo")} unknown={unknown} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("dash.call.recordingConsent")}</dt>
                <dd className="mt-0.5">
                  {recordingNotice === null ? <span className="text-muted">{unknown}</span> : recordingNotice ? <Check state={true} yes={t("dash.call.recordingNoticePlayed")} no="" unknown="" /> : <span className="text-muted">{t("dash.call.notRecorded")}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("dash.call.optOut")}</dt>
                <dd className="mt-0.5">
                  {optedOut ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <Ban className="size-4" aria-hidden />
                      {optOut.phrase ? t("dash.call.optOutPhrase", { phrase: optOut.phrase }) : t("dash.call.optOutYes")}
                    </span>
                  ) : (
                    <span className="text-muted">{t("dash.call.optOutNo")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{t("dash.call.dnc")}</dt>
                <dd className="mt-0.5">{dnc.length ? <span className="text-amber-700 dark:text-amber-300">{dnc.map((d) => t(`dash.call.dncScope.${d.scope}`)).join(" · ")}</span> : <span className="text-muted">{t("dash.call.dncNone")}</span>}</dd>
              </div>
            </dl>
          </Panel>
          {roleCan(role, "compliance.manage") && !["queued", "ringing", "in_progress"].includes(call.status) && !call.metadata.erased_at ? (
            <Panel title={t("dash.call.privacy")} description={t("dash.call.privacyText")}>
              <div className="flex flex-wrap gap-2">
                {recording ? (
                  <ActionButton action={deleteCallRecordingAction} fields={{ wid: workspace.id, call_id: call.id }} confirmText={t("dash.call.deleteRecordingConfirm")} showSuccess>
                    <Trash2 aria-hidden />
                    {t("dash.call.deleteRecording")}
                  </ActionButton>
                ) : null}
                <ActionButton action={eraseCallAction} fields={{ wid: workspace.id, call_id: call.id }} variant="danger" confirmText={t("dash.call.eraseConfirm")}>
                  <Trash2 aria-hidden />
                  {t("dash.call.erase")}
                </ActionButton>
              </div>
            </Panel>
          ) : null}
          {call.metadata.erased_at ? <p className="text-xs text-muted">{t("dash.call.erasedNote")}</p> : null}
          {call.direction === "web" ? (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Bot className="size-4" aria-hidden />
              {webSource === "widget" ? t("dash.call.webWidget") : t("dash.call.webTest")}
            </p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
