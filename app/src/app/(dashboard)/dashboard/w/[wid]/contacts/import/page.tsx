import type { Metadata } from "next";
import { ContactImportWizard } from "@/components/dashboard/contact-import";
import { ContactsTabs } from "@/components/dashboard/contact-tabs";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { listContactLists } from "@/lib/contacts";
import { MAX_IMPORT_ROWS } from "@/lib/contacts-import";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { COUNTRIES } from "@/voice/normalize";
import { roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.import.title") };
}

/** CSV import of contacts with consent columns: map → check (validation report) → import. */
export default async function ImportContactsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, lists] = await Promise.all([getT(), listContactLists(workspace.id)]);
  const base = `/dashboard/w/${workspace.id}/contacts`;
  const countries = Object.values(COUNTRIES)
    .map((c) => ({ iso: c.iso, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <DashHeader title={t("dash.nav.contacts")} description={t("dash.contacts.subtitle")} />
      <ContactsTabs base={base} active="import" t={t} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title={t("dash.import.title")} description={t("dash.import.subtitle", { n: MAX_IMPORT_ROWS.toLocaleString() })}>
          {roleCan(role, "contacts.manage") ? (
            <ContactImportWizard workspaceId={workspace.id} defaultCountry={workspace.settings.defaultCountry} countries={countries} lists={lists.map((l) => ({ id: l.id, name: l.name }))} contactsHref={base} />
          ) : (
            <Alert tone="info">{t("dash.contacts.viewOnly")}</Alert>
          )}
        </Panel>
        <aside className="space-y-4">
          <Panel title={t("dash.import.formatTitle")}>
            <ul className="list-disc space-y-1.5 ps-4 text-sm text-muted">
              <li>{t("dash.import.format1")}</li>
              <li>{t("dash.import.format2")}</li>
              <li>{t("dash.import.format3")}</li>
              <li>{t("dash.import.format4")}</li>
            </ul>
            <pre dir="ltr" className="mt-3 overflow-x-auto rounded-lg border border-line bg-paper p-3 text-[11px] leading-relaxed">
              {"phone,first_name,consent_type,consent_date,consent_text\n+14155550123,Ana,express written,2026-09-30,I agree to receive calls…"}
            </pre>
          </Panel>
          <Alert tone="warning" title={t("dash.import.consentTitle")}>
            {t("dash.import.consentNote")}
          </Alert>
        </aside>
      </div>
    </>
  );
}
