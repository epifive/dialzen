import { LinkTabs } from "@/components/dashboard/ui";
import type { Translator } from "@/lib/i18n/messages";

export type ContactsTab = "contacts" | "lists" | "import" | "dnc" | "opt-outs";

/** Sub-navigation of Workspace → Contacts. */
export function ContactsTabs({ base, active, t, counts = {} }: { base: string; active: ContactsTab; t: Translator; counts?: Partial<Record<ContactsTab, number>> }) {
  const items: Array<{ key: ContactsTab; href: string; label: string }> = [
    { key: "contacts", href: base, label: t("dash.contacts.tab.contacts") },
    { key: "lists", href: `${base}/lists`, label: t("dash.contacts.tab.lists") },
    { key: "import", href: `${base}/import`, label: t("dash.contacts.tab.import") },
    { key: "dnc", href: `${base}/dnc`, label: t("dash.contacts.tab.dnc") },
    { key: "opt-outs", href: `${base}/opt-outs`, label: t("dash.contacts.tab.optOuts") },
  ];
  return (
    <div className="mb-6 overflow-x-auto">
      <LinkTabs label={t("dash.nav.contacts")} items={items.map((i) => ({ href: i.href, label: i.label, active: i.key === active, count: counts[i.key] }))} />
    </div>
  );
}
