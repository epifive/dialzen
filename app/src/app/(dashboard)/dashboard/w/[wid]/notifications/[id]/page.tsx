import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Send, Trash } from "lucide-react";
import { deleteNotifyChannelAction, testNotifyChannelAction } from "@/app/actions/dashboard/notifications";
import { ActionButton } from "@/components/dashboard/actions";
import { NotifyChannelForm } from "@/components/dashboard/notify-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { getNotifyChannel } from "@/lib/notify-channels";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.notify.edit") };
}

export default async function EditNotifyChannelPage({ params }: { params: Promise<{ wid: string; id: string }> }) {
  const { wid, id } = await params;
  const { workspace } = await requireWorkspace(wid, "admin");
  const channel = await getNotifyChannel(workspace.id, Number(id));
  if (!channel) notFound();
  const t = await getT();
  const base = `/dashboard/w/${workspace.id}/notifications`;
  return (
    <>
      <Link href={base} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.nav.notifications")}
      </Link>
      <DashHeader
        title={channel.name}
        description={t(`dash.notify.type.${channel.type}` as MessageKey)}
        actions={
          <>
            <ActionButton action={testNotifyChannelAction} fields={{ wid: workspace.id, channel_id: channel.id }} showSuccess>
              <Send aria-hidden />
              {t("dash.notify.test")}
            </ActionButton>
            <ActionButton
              action={deleteNotifyChannelAction}
              fields={{ wid: workspace.id, channel_id: channel.id }}
              confirmText={t("dash.notify.deleteConfirm", { name: channel.name })}
              label={t("dash.notify.delete")}
              buttonClassName="hover:border-red-300 hover:text-red-600"
            >
              <Trash aria-hidden />
            </ActionButton>
          </>
        }
      />
      <Panel>
        <NotifyChannelForm
          workspaceId={workspace.id}
          values={{ id: channel.id, type: channel.type, name: channel.name, config: channel.config as unknown as Record<string, string>, events: channel.events, isActive: channel.isActive }}
        />
      </Panel>
    </>
  );
}
