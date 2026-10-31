import { LinkTabs } from "@/components/dashboard/ui";
import type { Translator } from "@/lib/i18n/messages";

export type ComplianceTab = "overview" | "rules" | "recording" | "outbound" | "audit";

/** Sub-navigation of Workspace → Compliance. */
export function ComplianceTabs({ base, active, t }: { base: string; active: ComplianceTab; t: Translator }) {
  const items: Array<{ key: ComplianceTab; href: string; label: string }> = [
    { key: "overview", href: base, label: t("dash.compliance.tab.overview") },
    { key: "rules", href: `${base}/rules`, label: t("dash.compliance.tab.rules") },
    { key: "recording", href: `${base}/recording`, label: t("dash.compliance.tab.recording") },
    { key: "outbound", href: `${base}/outbound`, label: t("dash.compliance.tab.outbound") },
    { key: "audit", href: `${base}/audit`, label: t("dash.compliance.tab.audit") },
  ];
  return (
    <div className="mb-6 overflow-x-auto">
      <LinkTabs label={t("dash.nav.compliance")} items={items.map((i) => ({ href: i.href, label: i.label, active: i.key === active }))} />
    </div>
  );
}

/** The responsibility disclaimer shown across the compliance center. */
export function ComplianceDisclaimer({ t }: { t: Translator }) {
  return (
    <p className="mt-8 rounded-xl border border-dashed border-line px-4 py-3 text-xs leading-relaxed text-muted">
      <span className="font-semibold text-ink">{t("dash.compliance.disclaimerTitle")}</span> {t("dash.compliance.disclaimer")}
    </p>
  );
}
