import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { OutboundRequestForm } from "@/components/dashboard/compliance-forms";
import { ComplianceDisclaimer, ComplianceTabs } from "@/components/dashboard/compliance-tabs";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { getCompliance, listKycRequests } from "@/lib/compliance";
import { formatDateTime } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { getSettings } from "@/lib/settings";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { kycStatusTone } from "@/voice/format";
import { COUNTRIES, roleCan } from "@/voice/normalize";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.compliance.tab.outbound") };
}

/** Outbound access: acceptable use + the business / use-case form, its review and history. */
export default async function OutboundAccessPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, locale, state, requests, entitlements, settings] = await Promise.all([getT(), getLocale(), getCompliance(workspace), listKycRequests({ workspaceId: workspace.id, limit: 20 }), getWorkspaceEntitlements(workspace), getSettings()]);
  const base = `/dashboard/w/${workspace.id}/compliance`;
  const canManage = roleCan(role, "compliance.manage");
  const pending = requests.find((r) => r.status === "pending");
  const countries = Object.values(COUNTRIES)
    .map((c) => ({ iso: c.iso, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const lc = locale.code;
  return (
    <>
      <DashHeader title={t("dash.nav.compliance")} description={t("dash.compliance.subtitle")} />
      <ComplianceTabs base={base} active="outbound" t={t} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {!entitlements.allowOutbound ? <Alert tone="warning">{t("dash.campaigns.blocked.plan")}</Alert> : null}
          {state.outboundState === "approved" ? (
            <Alert tone="success" title={t("dash.kyc.approvedTitle")}>
              {t("dash.kyc.approvedText")}
            </Alert>
          ) : pending ? (
            <Alert tone="info" title={t("dash.kyc.pendingTitle")}>
              {t("dash.kyc.pendingText", { date: formatDateTime(pending.created_at, lc) })}
            </Alert>
          ) : state.outboundState === "suspended" ? (
            <Alert tone="error" title={t("dash.kyc.suspendedTitle")}>
              {t("dash.kyc.suspendedText")}
            </Alert>
          ) : !settings.outbound_requires_approval ? (
            <Alert tone="info">{t("dash.kyc.notRequired")}</Alert>
          ) : null}
          {canManage && !pending && state.outboundState !== "approved" && state.outboundState !== "suspended" ? (
            <Panel title={t("dash.kyc.title")} description={t("dash.kyc.text")}>
              <OutboundRequestForm workspaceId={workspace.id} aupAccepted={Boolean(state.aupAcceptedAt)} defaults={{ businessName: state.settings.businessName || workspace.name, country: workspace.settings.defaultCountry }} countries={countries} />
            </Panel>
          ) : null}
          {!canManage ? <Alert tone="info">{t("dash.compliance.adminsOnly")}</Alert> : null}
        </div>
        <aside className="min-w-0 space-y-6">
          <Panel title={t("dash.kyc.history")} padded={false}>
            {requests.length ? (
              <ul className="divide-y divide-line">
                {requests.map((r) => (
                  <li key={r.id} className="space-y-1 px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium" dir="auto">
                        {r.business_name}
                      </span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", kycStatusTone(r.status))}>{t(`dash.compliance.state.${r.status}` as MessageKey)}</span>
                    </div>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      <Clock className="size-3" aria-hidden />
                      {formatDateTime(r.created_at, lc)}
                    </p>
                    {r.review_note ? (
                      <p className="rounded-lg bg-paper p-2 text-xs" dir="auto">
                        {r.review_note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">{t("dash.kyc.noRequests")}</p>
            )}
          </Panel>
          {state.aupAcceptedAt ? <p className="text-xs text-muted">{t("dash.kyc.aupAcceptedAt", { date: formatDateTime(state.aupAcceptedAt, lc) })}</p> : null}
        </aside>
      </div>
      <ComplianceDisclaimer t={t} />
    </>
  );
}
