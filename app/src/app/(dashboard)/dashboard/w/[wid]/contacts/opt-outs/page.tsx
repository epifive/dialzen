import type { Metadata } from "next";
import Link from "next/link";
import { PhoneOff } from "lucide-react";
import { ContactsTabs } from "@/components/dashboard/contact-tabs";
import { DashHeader, DTable, DTd, DTh, Empty, Pager, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatNumber, intParam } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { listOptOuts } from "@/lib/dnc";
import { getLocale, getT } from "@/lib/i18n/server";
import { formatPhone } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.contacts.tab.optOuts") };
}

const PER_PAGE = 50;

/** People who asked not to be called (in a call, to the team or by API), with the revocation time and deadline. */
export default async function OptOutsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ page?: string }> }) {
  const { workspace } = await requireWorkspace((await params).wid);
  const [query, t, locale] = await Promise.all([searchParams, getT(), getLocale()]);
  const page = intParam(query.page, 1);
  const { items, total } = await listOptOuts(workspace.id, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE });
  const base = `/dashboard/w/${workspace.id}/contacts`;
  const lc = locale.code;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const sourceLabel = (s: string) => (s.startsWith("call:") ? t("dash.optouts.fromCall") : s.startsWith("api") ? t("dash.optouts.fromApi") : s.startsWith("user:") ? t("dash.optouts.fromTeam") : s || "—");
  return (
    <>
      <DashHeader title={t("dash.nav.contacts")} description={t("dash.contacts.subtitle")} />
      <ContactsTabs base={base} active="opt-outs" t={t} />
      <Alert tone="info" className="mb-6" title={t("dash.optouts.ruleTitle")}>
        {t("dash.optouts.rule")}
      </Alert>
      <Panel title={t("dash.optouts.title", { n: formatNumber(total, lc) })} padded={false}>
        {items.length ? (
          <DTable minWidth={720} label={t("dash.contacts.tab.optOuts")}>
            <thead>
              <tr>
                <DTh>{t("dash.contacts.phone")}</DTh>
                <DTh>{t("dash.contacts.name")}</DTh>
                <DTh>{t("dash.optouts.how")}</DTh>
                <DTh>{t("dash.optouts.revokedAt")}</DTh>
                <DTh>{t("dash.optouts.deadline")}</DTh>
                <DTh>{t("dash.optouts.applied")}</DTh>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.phone}>
                  <DTd className="whitespace-nowrap">
                    <bdi dir="ltr" className="font-mono text-[13px]">
                      {formatPhone(o.phone)}
                    </bdi>
                  </DTd>
                  <DTd>
                    {o.contactId ? (
                      <Link href={`${base}/${o.contactId}`} className="hover:text-primary" dir="auto">
                        {o.name || t("dash.contacts.noName")}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </DTd>
                  <DTd className="text-muted">
                    {o.source.startsWith("call:") ? (
                      <Link href={`/dashboard/w/${workspace.id}/calls/${o.source.slice(5)}`} className="hover:text-primary">
                        {sourceLabel(o.source)}
                      </Link>
                    ) : (
                      sourceLabel(o.source)
                    )}
                    {o.revokedConsents ? <span className="block text-xs">{t("dash.optouts.consentsRevoked", { n: o.revokedConsents })}</span> : null}
                  </DTd>
                  <DTd className="whitespace-nowrap">{formatDateTime(o.at, lc)}</DTd>
                  <DTd className="whitespace-nowrap text-muted">{formatDateTime(o.honourBy, lc, false)}</DTd>
                  <DTd>
                    <Badge tone="success">{t("dash.optouts.immediately")}</Badge>
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<PhoneOff />} title={t("dash.optouts.emptyTitle")}>
            {t("dash.optouts.emptyText")}
          </Empty>
        )}
        <Pager
          page={page}
          pages={pages}
          href={(p) => `${base}/opt-outs?page=${p}`}
          labels={{ summary: t("dash.contacts.pageSummary", { page, pages, total: formatNumber(total, lc) }), previous: t("dash.pager.previous"), next: t("dash.pager.next"), nav: t("dash.pager.nav") }}
        />
      </Panel>
    </>
  );
}
