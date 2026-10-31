import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ContactForm } from "@/components/dashboard/contact-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { listContactLists } from "@/lib/contacts";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { timeZoneOptions } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.contacts.addTitle") };
}

export default async function NewContactPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace } = await requireWorkspace((await params).wid, "editor");
  const [t, lists] = await Promise.all([getT(), listContactLists(workspace.id)]);
  const base = `/dashboard/w/${workspace.id}/contacts`;
  return (
    <>
      <DashHeader
        title={t("dash.contacts.addTitle")}
        description={t("dash.contacts.addHint")}
        actions={
          <ButtonLink href={base} variant="outline">
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
            {t("dash.nav.contacts")}
          </ButtonLink>
        }
      />
      <Panel>
        <ContactForm workspaceId={workspace.id} values={{ phone: "", firstName: "", lastName: "", email: "", company: "", timezone: "", state: "", language: "", tags: [] }} lists={lists} timezones={timeZoneOptions()} />
      </Panel>
    </>
  );
}
