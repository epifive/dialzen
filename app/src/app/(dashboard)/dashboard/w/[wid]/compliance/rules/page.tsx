import type { Metadata } from "next";
import { CallingRulesForm, CountryRulesForm } from "@/components/dashboard/compliance-forms";
import { ComplianceDisclaimer, ComplianceTabs } from "@/components/dashboard/compliance-tabs";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { getCompliance } from "@/lib/compliance";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.compliance.tab.rules") };
}

/** Calling hours, state presets, holidays, frequency caps and the country pack. */
export default async function ComplianceRulesPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, state] = await Promise.all([getT(), getCompliance(workspace)]);
  const base = `/dashboard/w/${workspace.id}/compliance`;
  const canManage = roleCan(role, "compliance.manage");
  return (
    <>
      <DashHeader title={t("dash.nav.compliance")} description={t("dash.compliance.subtitle")} />
      <ComplianceTabs base={base} active="rules" t={t} />
      {!canManage ? (
        <Alert tone="info" className="mb-6">
          {t("dash.compliance.adminsOnly")}
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title={t("dash.compliance.hoursTitle")} description={t("dash.compliance.hoursText")}>
          <CallingRulesForm workspaceId={workspace.id} settings={state.settings} weekStart={workspace.settings.weekStart} disabled={!canManage} />
        </Panel>
        <div className="space-y-6">
          <Panel title={t("dash.compliance.countryTitle")} description={t("dash.compliance.countryText")}>
            <CountryRulesForm workspaceId={workspace.id} settings={state.settings} disabled={!canManage} />
          </Panel>
          <Panel title={t("dash.compliance.presetsTitle")}>
            <ul className="space-y-1.5 text-sm text-muted">
              <li>{t("dash.compliance.preset.fl")}</li>
              <li>{t("dash.compliance.preset.tx")}</li>
              <li>{t("dash.compliance.preset.south")}</li>
              <li>{t("dash.compliance.preset.ri")}</li>
            </ul>
            <p className="mt-3 text-xs text-muted">{t("dash.compliance.presetsNote")}</p>
          </Panel>
        </div>
      </div>
      <ComplianceDisclaimer t={t} />
    </>
  );
}
