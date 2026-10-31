import type { Metadata } from "next";
import { Search, ShieldBan } from "lucide-react";
import { removeDncAction } from "@/app/actions/dashboard/contacts";
import { ActionButton } from "@/components/dashboard/actions";
import { DncAddForm, DncUploadForm } from "@/components/dashboard/contact-forms";
import { ContactsTabs } from "@/components/dashboard/contact-tabs";
import { DashHeader, DTable, DTd, DTh, Empty, Pager, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { listDnc } from "@/lib/contacts";
import { formatDateTime, formatNumber, intParam } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { dncCounts } from "@/lib/dnc";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { formatPhone, roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.contacts.tab.dnc") };
}

const PER_PAGE = 50;

/** The workspace's do-not-call list: single numbers, uploaded national DNC / TPS extracts, internal lists. */
export default async function DncPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [query, t, locale] = await Promise.all([searchParams, getT(), getLocale()]);
  const page = intParam(query.page, 1);
  const [{ entries, total }, counts, globalCounts] = await Promise.all([listDnc("workspace", workspace.id, { q: query.q, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), dncCounts("workspace", workspace.id), dncCounts("global", 0)]);
  const base = `/dashboard/w/${workspace.id}/contacts`;
  const lc = locale.code;
  const canManage = roleCan(role, "contacts.manage");
  const canRemove = roleCan(role, "compliance.manage");
  const globalTotal = Object.values(globalCounts).reduce((a, b) => a + b, 0);
  const nowIso = new Date().toISOString();
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  return (
    <>
      <DashHeader title={t("dash.nav.contacts")} description={t("dash.contacts.subtitle")} />
      <ContactsTabs base={base} active="dnc" t={t} />
      <div className="mb-6 flex flex-wrap gap-2">
        {Object.entries(counts).map(([reason, n]) => (
          <Badge key={reason} tone="neutral" className="text-[13px]">
            {t(`dash.dnc.reason.${reason}` as MessageKey)}: <bdi className="tabular-nums">{formatNumber(n, lc)}</bdi>
          </Badge>
        ))}
        <Badge tone="primary" className="text-[13px]">
          {t("dash.dnc.globalCount", { n: formatNumber(globalTotal, lc) })}
        </Badge>
      </div>
      <Alert tone="info" className="mb-6" title={t("dash.dnc.howTitle")}>
        {t("dash.dnc.how")}
      </Alert>
      {canManage ? (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title={t("dash.dnc.addTitle")} description={t("dash.dnc.addText")}>
            <DncAddForm workspaceId={workspace.id} />
          </Panel>
          <Panel title={t("dash.dnc.uploadTitle")} description={t("dash.dnc.uploadText")}>
            <DncUploadForm workspaceId={workspace.id} />
          </Panel>
        </div>
      ) : null}
      <Panel title={t("dash.dnc.listTitle", { n: formatNumber(total, lc) })} padded={false}>
        <form method="get" className="flex gap-2 border-b border-line p-3" role="search">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={query.q ?? ""} placeholder={t("dash.dnc.search")} aria-label={t("dash.dnc.search")} className="ps-9" dir="ltr" inputMode="tel" />
          </div>
          <button type="submit" className={buttonClass("outline", "md")}>
            {t("dash.contacts.filter")}
          </button>
        </form>
        {entries.length ? (
          <DTable minWidth={700} label={t("dash.contacts.tab.dnc")}>
            <thead>
              <tr>
                <DTh>{t("dash.contacts.phone")}</DTh>
                <DTh>{t("dash.dnc.reason")}</DTh>
                <DTh>{t("dash.dnc.listRef")}</DTh>
                <DTh>{t("dash.dnc.addedAt")}</DTh>
                <DTh>{t("dash.dnc.expiresCol")}</DTh>
                <DTh className="text-end">
                  <span className="sr-only">{t("dash.api.actions")}</span>
                </DTh>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <DTd className="whitespace-nowrap">
                    <bdi dir="ltr" className="font-mono text-[13px]">
                      {formatPhone(e.phone_e164)}
                    </bdi>
                  </DTd>
                  <DTd>
                    <Badge tone={e.reason === "opt_out" ? "danger" : "warning"}>{t(`dash.dnc.reason.${e.reason}` as MessageKey)}</Badge>
                    {e.note ? (
                      <span className="mt-0.5 block max-w-52 truncate text-xs text-muted" dir="auto" title={e.note}>
                        {e.note}
                      </span>
                    ) : null}
                  </DTd>
                  <DTd className="max-w-52 truncate text-muted">
                    <span dir="auto">{e.list_ref || e.source || "—"}</span>
                  </DTd>
                  <DTd className="whitespace-nowrap text-muted">{formatDateTime(e.created_at, lc, false)}</DTd>
                  <DTd className="whitespace-nowrap text-muted">{e.expires_at ? (e.expires_at <= nowIso ? t("dash.dnc.expired") : formatDateTime(e.expires_at, lc, false)) : t("dash.dnc.never")}</DTd>
                  <DTd className="text-end">
                    {canRemove ? (
                      <ActionButton action={removeDncAction} fields={{ wid: workspace.id, phone: e.phone_e164 }} variant="ghost" confirmText={e.reason === "opt_out" ? t("dash.dnc.removeOptOutConfirm") : t("dash.dnc.removeConfirm")} className="items-end">
                        {t("dash.dnc.remove")}
                      </ActionButton>
                    ) : null}
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<ShieldBan />} title={query.q ? t("dash.contacts.noMatch") : t("dash.dnc.emptyTitle")}>
            {query.q ? null : t("dash.dnc.emptyText")}
          </Empty>
        )}
        <Pager
          page={page}
          pages={pages}
          href={(p) => `${base}/dnc?${new URLSearchParams({ ...(query.q ? { q: query.q } : {}), page: String(p) })}`}
          labels={{ summary: t("dash.contacts.pageSummary", { page, pages, total: formatNumber(total, lc) }), previous: t("dash.pager.previous"), next: t("dash.pager.next"), nav: t("dash.pager.nav") }}
        />
      </Panel>
    </>
  );
}
