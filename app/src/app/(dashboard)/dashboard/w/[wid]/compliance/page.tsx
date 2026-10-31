import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, OctagonX, Play } from "lucide-react";
import { setOutboundPausedAction } from "@/app/actions/dashboard/compliance";
import { ActionButton } from "@/components/dashboard/actions";
import { ComplianceDisclaimer, ComplianceTabs } from "@/components/dashboard/compliance-tabs";
import { DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { listAgents } from "@/lib/agents";
import { getCompliance, listKycRequests, outboundAccess } from "@/lib/compliance";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { getSettings } from "@/lib/settings";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { kycStatusTone } from "@/voice/format";
import { formatPhone, hasAiDisclosure, roleCan } from "@/voice/normalize";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.compliance") };
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden /> : <CircleX className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />}
      <span className={ok ? "text-muted" : undefined}>{children}</span>
    </li>
  );
}

/** Compliance overview: outbound access, warnings, the AI disclosure check of every agent. */
export default async function CompliancePage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, state, entitlements, agents, settings, requests] = await Promise.all([getT(), getCompliance(workspace), getWorkspaceEntitlements(workspace), listAgents(workspace.id), getSettings(), listKycRequests({ workspaceId: workspace.id, limit: 1 })]);
  const access = await outboundAccess(state, entitlements);
  const base = `/dashboard/w/${workspace.id}/compliance`;
  const canManage = roleCan(role, "compliance.manage");
  const s = state.settings;
  const recordingAgents = agents.filter((a) => a.settings.recording);
  const business = s.businessName || workspace.name;
  const warnings: string[] = [];
  if (!s.callbackNumber) warnings.push(t("dash.compliance.warn.callback"));
  if (!s.recordingDisclosure && recordingAgents.length) warnings.push(t("dash.compliance.warn.recording", { n: recordingAgents.length }));
  if (!s.euRequireConsent) warnings.push(t("dash.compliance.warn.eu"));
  if (s.maxCallsPer24h === 0 && s.maxCallsPer30d === 0) warnings.push(t("dash.compliance.warn.frequency"));
  if (agents.some((a) => !hasAiDisclosure(a.firstMessage))) warnings.push(t("dash.compliance.warn.disclosure"));
  const last = requests[0];

  return (
    <>
      <DashHeader title={t("dash.nav.compliance")} description={t("dash.compliance.subtitle")} />
      <ComplianceTabs base={base} active="overview" t={t} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={t("dash.compliance.outboundTitle")} description={access.ok ? t("dash.compliance.outboundOk") : t(`dash.campaigns.blocked.${access.reason}`)}>
          <ul className="space-y-2.5">
            <Check ok={entitlements.allowOutbound}>{t("dash.compliance.step.plan")}</Check>
            <Check ok={Boolean(state.aupAcceptedAt)}>{t("dash.compliance.step.aup")}</Check>
            <Check ok={!settings.outbound_requires_approval || state.outboundState === "approved"}>
              {t("dash.compliance.step.approval")}{" "}
              <span className={cn("ms-1 rounded-full px-2 py-0.5 text-xs font-medium", kycStatusTone(state.outboundState))}>{t(`dash.compliance.state.${state.outboundState}` as MessageKey)}</span>
            </Check>
            <Check ok={!state.killSwitch && !settings.outbound_kill_switch}>{state.killSwitch || settings.outbound_kill_switch ? t("dash.compliance.step.killed") : t("dash.compliance.step.noKill")}</Check>
            <Check ok={!state.outboundPaused}>{state.outboundPaused ? t("dash.compliance.step.paused") : t("dash.compliance.step.notPaused")}</Check>
          </ul>
          {last?.status === "rejected" && last.review_note ? (
            <Alert tone="error" className="mt-4" title={t("dash.compliance.rejectedNote")}>
              <span dir="auto">{last.review_note}</span>
            </Alert>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            {state.outboundState !== "approved" && state.outboundState !== "pending" && canManage ? (
              <Link href={`${base}/outbound`} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-white hover:bg-primary-strong">
                {t("dash.compliance.requestAccess")}
              </Link>
            ) : null}
            {canManage ? (
              state.outboundPaused ? (
                <ActionButton action={setOutboundPausedAction} fields={{ wid: workspace.id, on: 0 }} variant="primary" showSuccess>
                  <Play aria-hidden />
                  {t("dash.compliance.resumeOutbound")}
                </ActionButton>
              ) : (
                <ActionButton action={setOutboundPausedAction} fields={{ wid: workspace.id, on: 1 }} variant="danger" confirmText={t("dash.compliance.stopConfirm")} showSuccess>
                  <OctagonX aria-hidden />
                  {t("dash.compliance.stopOutbound")}
                </ActionButton>
              )
            ) : null}
          </div>
        </Panel>

        <Panel title={t("dash.compliance.summaryTitle")}>
          <dl className="space-y-2.5 text-sm">
            <Item label={t("dash.compliance.businessName")}>{business}</Item>
            <Item label={t("dash.compliance.callback")}>{s.callbackNumber ? <bdi dir="ltr">{formatPhone(s.callbackNumber)}</bdi> : "—"}</Item>
            <Item label={t("dash.compliance.hours")}>
              <bdi dir="ltr">
                {s.callingHours.start}–{s.callingHours.end}
              </bdi>{" "}
              · {s.callingHours.days.map((d) => t(`dash.campaigns.day.${d}` as MessageKey)).join(" ")}
            </Item>
            <Item label={t("dash.compliance.statePresets")}>{s.usStatePresets ? t("dash.compliance.on") : t("dash.compliance.off")}</Item>
            <Item label={t("dash.compliance.frequency")}>{t("dash.compliance.frequencyValue", { day: s.maxCallsPer24h || "∞", month: s.maxCallsPer30d || "∞" })}</Item>
            <Item label={t("dash.compliance.notice")}>{s.recordingDisclosure ? t("dash.compliance.on") : t("dash.compliance.off")}</Item>
            <Item label={t("dash.compliance.dlt")}>{s.indiaDltRoute || t("dash.compliance.dltNone")}</Item>
            <Item label={t("dash.compliance.retention")}>{t("dash.compliance.retentionValue", { rec: s.recordingRetentionDays || "∞", tr: s.transcriptRetentionDays || "∞" })}</Item>
          </dl>
        </Panel>
      </div>

      {warnings.length ? (
        <Alert tone="warning" title={t("dash.compliance.warningsTitle")} className="mt-6">
          <ul className="list-disc space-y-1 ps-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Panel title={t("dash.compliance.aiTitle")} description={t("dash.compliance.aiText")} padded={false} className="mt-6">
        {agents.length ? (
          <DTable minWidth={620} label={t("dash.compliance.aiTitle")}>
            <thead>
              <tr>
                <DTh>{t("dash.compliance.agent")}</DTh>
                <DTh>{t("dash.compliance.aiDisclosure")}</DTh>
                <DTh>{t("dash.compliance.businessNamed")}</DTh>
                <DTh>{t("dash.compliance.recording")}</DTh>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const disclosed = hasAiDisclosure(a.firstMessage);
                const named = a.firstMessage.toLowerCase().includes((a.settings.businessName || business).toLowerCase());
                return (
                  <tr key={a.id}>
                    <DTd>
                      <Link href={`/dashboard/w/${workspace.id}/agents/${a.id}`} className="font-medium hover:text-primary" dir="auto">
                        {a.name}
                      </Link>
                      <span className="mt-0.5 block max-w-80 truncate text-xs text-muted" dir="auto" title={a.firstMessage}>
                        {a.firstMessage}
                      </span>
                    </DTd>
                    <DTd>{disclosed ? <Badge tone="success">{t("dash.compliance.yes")}</Badge> : <Badge tone="danger">{t("dash.compliance.missing")}</Badge>}</DTd>
                    <DTd>{named ? <Badge tone="success">{t("dash.compliance.yes")}</Badge> : <Badge tone="warning">{t("dash.compliance.no")}</Badge>}</DTd>
                    <DTd>{a.settings.recording ? <Badge tone={s.recordingDisclosure ? "success" : "warning"}>{s.recordingDisclosure ? t("dash.compliance.recordedNotice") : t("dash.compliance.recordedNoNotice")}</Badge> : <Badge>{t("dash.compliance.notRecorded")}</Badge>}</DTd>
                  </tr>
                );
              })}
            </tbody>
          </DTable>
        ) : (
          <Empty title={t("dash.compliance.noAgents")} />
        )}
      </Panel>
      <ComplianceDisclaimer t={t} />
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0" dir="auto">
        {children}
      </dd>
    </div>
  );
}
