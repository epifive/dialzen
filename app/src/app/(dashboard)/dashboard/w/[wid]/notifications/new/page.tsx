import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { NotifyChannelForm, NotifyIcon } from "@/components/dashboard/notify-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { isNotifyChannelType, roleCan } from "@/voice/normalize";
import { DEFAULT_NOTIFY_EVENTS, NOTIFY_CHANNEL_TYPES } from "@/voice/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.notify.add") };
}

export default async function NewNotifyChannelPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ type?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  if (!roleCan(role, "settings.manage")) notFound();
  const [query, t] = await Promise.all([searchParams, getT()]);
  const type = isNotifyChannelType(query.type) ? query.type : null;
  const base = `/dashboard/w/${workspace.id}/notifications`;

  return (
    <>
      <Link href={type ? `${base}/new` : base} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {type ? t("dash.notify.changeType") : t("dash.nav.notifications")}
      </Link>
      {type ? (
        <>
          <DashHeader title={t("dash.notify.addType", { type: t(`dash.notify.type.${type}` as MessageKey) })} description={t(`dash.notify.desc.${type}` as MessageKey)} />
          <Panel>
            <NotifyChannelForm workspaceId={workspace.id} values={{ type, name: "", config: {}, events: [...DEFAULT_NOTIFY_EVENTS], isActive: true }} />
          </Panel>
        </>
      ) : (
        <>
          <DashHeader title={t("dash.notify.add")} description={t("dash.notify.pick")} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NOTIFY_CHANNEL_TYPES.map((ty) => {
              return (
                <li key={ty}>
                  <Link
                    href={`${base}/new?type=${ty}`}
                    className="group flex h-full gap-4 rounded-xl border border-line bg-surface p-5 transition-colors hover:border-primary-line hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                      <NotifyIcon type={ty} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        {t(`dash.notify.type.${ty}` as MessageKey)}
                        <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden />
                      </span>
                      <span className="mt-1 block text-sm text-muted">{t(`dash.notify.desc.${ty}` as MessageKey)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
