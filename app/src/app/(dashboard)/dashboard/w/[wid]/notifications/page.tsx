import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Pencil, Plus, Send, Trash } from "lucide-react";
import { deleteNotifyChannelAction, testNotifyChannelAction, toggleNotifyChannelAction } from "@/app/actions/dashboard/notifications";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { NotifyIcon } from "@/components/dashboard/notify-forms";
import { DashHeader, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { getNotifyChannels, type NotifyChannelRecord } from "@/lib/notify-channels";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { roleCan } from "@/voice/normalize";
import type { MessageKey } from "@/lib/i18n/messages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.notifications") };
}

/** Short, safe summary of where a channel delivers (no secrets). */
function destination(c: NotifyChannelRecord): string {
  const cfg = c.config as Record<string, string>;
  if (c.type === "email") return cfg.to;
  if (c.type === "telegram") return `chat ${cfg.chatId}`;
  const raw = c.type === "webhook" ? cfg.url : cfg.webhookUrl;
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname.length > 1 ? "/…" : ""}`;
  } catch {
    return "";
  }
}

export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ created?: string; saved?: string; deleted?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [query, t, channels] = await Promise.all([searchParams, getT(), getNotifyChannels(workspace.id)]);
  const base = `/dashboard/w/${workspace.id}/notifications`;
  const canManage = roleCan(role, "settings.manage");
  const notice = query.created === "1" ? t("dash.notify.created") : query.saved === "1" ? t("dash.notify.saved") : query.deleted === "1" ? t("dash.notify.deleted") : "";

  return (
    <>
      {notice ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {notice}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={t("dash.nav.notifications")}
        description={t("dash.notify.subtitle")}
        actions={
          canManage ? (
            <ButtonLink href={`${base}/new`}>
              <Plus aria-hidden />
              {t("dash.notify.add")}
            </ButtonLink>
          ) : null
        }
      />
      <Panel padded={false}>
        {channels.length ? (
          <ul className="divide-y divide-line">
            {channels.map((c) => {
              return (
                <li key={c.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    <NotifyIcon type={c.type} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`${base}/${c.id}`} dir="auto" className="font-medium hover:text-primary">
                        {c.name}
                      </Link>
                      <Badge>{t(`dash.notify.type.${c.type}` as MessageKey)}</Badge>
                      {!c.isActive ? <Badge tone="warning">{t("dash.notify.off")}</Badge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted" dir="ltr">
                      {destination(c)}
                    </p>
                    <p className="mt-1 text-xs text-muted">{t("dash.notify.eventsCount", { n: c.events.length })}</p>
                  </div>
                  {canManage ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <ActionButton action={testNotifyChannelAction} fields={{ wid: workspace.id, channel_id: c.id }} showSuccess>
                      <Send aria-hidden />
                      {t("dash.notify.test")}
                    </ActionButton>
                    <ActionButton action={toggleNotifyChannelAction} fields={{ wid: workspace.id, channel_id: c.id, active: c.isActive ? "0" : "1" }}>
                      {c.isActive ? t("dash.notify.disable") : t("dash.notify.enable")}
                    </ActionButton>
                    <ButtonLink href={`${base}/${c.id}`} variant="outline" size="sm" aria-label={t("dash.notify.editShort")} title={t("dash.notify.editShort")}>
                      <Pencil aria-hidden />
                    </ButtonLink>
                    <ActionButton
                      action={deleteNotifyChannelAction}
                      fields={{ wid: workspace.id, channel_id: c.id }}
                      confirmText={t("dash.notify.deleteConfirm", { name: c.name })}
                      label={t("dash.notify.delete")}
                      buttonClassName="hover:border-red-300 hover:text-red-600"
                    >
                      <Trash aria-hidden />
                    </ActionButton>
                  </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty icon={<BellRing />} title={t("dash.notify.emptyTitle")} action={canManage ? <ButtonLink href={`${base}/new`}>{t("dash.notify.add")}</ButtonLink> : null}>
            {t("dash.notify.emptyText")}
          </Empty>
        )}
      </Panel>
    </>
  );
}
