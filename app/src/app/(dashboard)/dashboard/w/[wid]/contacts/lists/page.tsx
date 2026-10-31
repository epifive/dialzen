import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, Trash2 } from "lucide-react";
import { deleteListAction } from "@/app/actions/dashboard/contacts";
import { ActionButton } from "@/components/dashboard/actions";
import { CreateListForm } from "@/components/dashboard/contact-forms";
import { ContactsTabs } from "@/components/dashboard/contact-tabs";
import { DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { listContactLists } from "@/lib/contacts";
import { formatDateTime, formatNumber } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.contacts.tab.lists") };
}

/** Contact lists: what campaigns call. */
export default async function ContactListsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, locale, lists] = await Promise.all([getT(), getLocale(), listContactLists(workspace.id)]);
  const base = `/dashboard/w/${workspace.id}/contacts`;
  const canManage = roleCan(role, "contacts.manage");
  return (
    <>
      <DashHeader title={t("dash.nav.contacts")} description={t("dash.contacts.subtitle")} />
      <ContactsTabs base={base} active="lists" t={t} />
      <div className="space-y-6">
        {canManage ? (
          <Panel title={t("dash.contacts.newList")} description={t("dash.contacts.newListText")}>
            <CreateListForm workspaceId={workspace.id} />
          </Panel>
        ) : null}
        <Panel title={t("dash.contacts.tab.lists")} padded={false}>
          {lists.length ? (
            <DTable minWidth={560} label={t("dash.contacts.tab.lists")}>
              <thead>
                <tr>
                  <DTh>{t("dash.contacts.listName")}</DTh>
                  <DTh>{t("dash.contacts.members")}</DTh>
                  <DTh>{t("dash.contacts.createdAt")}</DTh>
                  <DTh className="text-end">
                    <span className="sr-only">{t("dash.api.actions")}</span>
                  </DTh>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id}>
                    <DTd>
                      <Link href={`${base}?list=${l.id}`} className="font-medium hover:text-primary" dir="auto">
                        {l.name}
                      </Link>
                      {l.description ? (
                        <span className="block text-xs text-muted" dir="auto">
                          {l.description}
                        </span>
                      ) : null}
                    </DTd>
                    <DTd className="tabular-nums">{formatNumber(l.members, locale.code)}</DTd>
                    <DTd className="text-muted">{formatDateTime(l.createdAt, locale.code, false)}</DTd>
                    <DTd className="text-end">
                      {canManage ? (
                        <ActionButton action={deleteListAction} fields={{ wid: workspace.id, list_id: l.id }} variant="ghost" confirmText={t("dash.contacts.deleteListConfirm", { name: l.name })} className="items-end">
                          <Trash2 aria-hidden />
                          {t("dash.contacts.deleteList")}
                        </ActionButton>
                      ) : null}
                    </DTd>
                  </tr>
                ))}
              </tbody>
            </DTable>
          ) : (
            <Empty icon={<ListChecks />} title={t("dash.contacts.noListsTitle")}>
              {t("dash.contacts.noListsText")}
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
