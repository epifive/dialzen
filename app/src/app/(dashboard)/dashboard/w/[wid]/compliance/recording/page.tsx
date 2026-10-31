import type { Metadata } from "next";
import { RecordingForm } from "@/components/dashboard/compliance-forms";
import { ComplianceDisclaimer, ComplianceTabs } from "@/components/dashboard/compliance-tabs";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { getCompliance } from "@/lib/compliance";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.compliance.tab.recording") };
}

/** Recording notice and how long recordings and transcripts are kept. */
export default async function ComplianceRecordingPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, state] = await Promise.all([getT(), getCompliance(workspace)]);
  const base = `/dashboard/w/${workspace.id}/compliance`;
  const canManage = roleCan(role, "compliance.manage");
  return (
    <>
      <DashHeader title={t("dash.nav.compliance")} description={t("dash.compliance.subtitle")} />
      <ComplianceTabs base={base} active="recording" t={t} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title={t("dash.compliance.recordingTitle")} description={t("dash.compliance.recordingText")}>
          <RecordingForm workspaceId={workspace.id} settings={state.settings} disabled={!canManage} />
        </Panel>
        <aside className="space-y-4">
          <Alert tone="info" title={t("dash.compliance.allPartyTitle")}>
            {t("dash.compliance.allParty")}
          </Alert>
          <Alert tone="info" title={t("dash.compliance.retentionTitle")}>
            {t("dash.compliance.retentionText")}
          </Alert>
        </aside>
      </div>
      <ComplianceDisclaimer t={t} />
    </>
  );
}
