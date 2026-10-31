import type { Metadata } from "next";
import Link from "next/link";
import { Download, ScrollText } from "lucide-react";
import { ComplianceDisclaimer, ComplianceTabs } from "@/components/dashboard/compliance-tabs";
import { DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { listAudit } from "@/lib/audit";
import { AUDIT_CATEGORIES, auditActorNames, auditDetails, auditFilterFrom } from "@/lib/audit-view";
import { formatDateTime } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { roleAtLeast } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.compliance.tab.audit") };
}

const PER_PAGE = 50;

/** The append-only audit trail of the workspace, with filters and a CSV export. */
export default async function AuditLogPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ category?: string; from?: string; to?: string; entity?: string; before?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [query, t, locale] = await Promise.all([searchParams, getT(), getLocale()]);
  const filter = auditFilterFrom({ ...query, before: Number(query.before) || undefined }, workspace.timezone, PER_PAGE);
  const entries = await listAudit(workspace.id, filter);
  const names = await auditActorNames(entries);
  const base = `/dashboard/w/${workspace.id}/compliance`;
  const lc = locale.code;
  const qs = new URLSearchParams(Object.entries({ category: query.category ?? "", from: query.from ?? "", to: query.to ?? "", entity: query.entity ?? "" }).filter(([, v]) => v));
  const older = entries.length === PER_PAGE ? `${base}/audit?${new URLSearchParams([...qs, ["before", String(entries[entries.length - 1].id)]])}` : null;
  const actor = (type: string, id: number | null) => (id && names.get(id) ? names.get(id)! : t(`dash.audit.actor.${type}` as MessageKey));

  return (
    <>
      <DashHeader
        title={t("dash.nav.compliance")}
        description={t("dash.compliance.subtitle")}
        actions={
          roleAtLeast(role, "admin") ? (
            <a href={`${base}/audit/export?${qs}`} className={buttonClass("outline", "md")}>
              <Download aria-hidden />
              {t("dash.audit.export")}
            </a>
          ) : null
        }
      />
      <ComplianceTabs base={base} active="audit" t={t} />
      <Panel padded={false} title={t("dash.audit.title")} description={t("dash.audit.text")}>
        <form method="get" className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
          <label className="text-xs text-muted">
            {t("dash.audit.category")}
            <Select name="category" defaultValue={query.category ?? ""} className="mt-1">
              <option value="">{t("dash.audit.all")}</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`dash.audit.cat.${c.slice(0, -1)}` as MessageKey)}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs text-muted">
            {t("dash.audit.from")}
            <Input name="from" type="date" defaultValue={query.from ?? ""} className="mt-1" dir="ltr" />
          </label>
          <label className="text-xs text-muted">
            {t("dash.audit.to")}
            <Input name="to" type="date" defaultValue={query.to ?? ""} className="mt-1" dir="ltr" />
          </label>
          <label className="text-xs text-muted">
            {t("dash.audit.entity")}
            <Input name="entity" defaultValue={query.entity ?? ""} placeholder="+14155550123" className="mt-1" dir="ltr" />
          </label>
          <button type="submit" className={buttonClass("outline", "md")}>
            {t("dash.contacts.filter")}
          </button>
        </form>
        {entries.length ? (
          <DTable minWidth={820} label={t("dash.audit.title")}>
            <thead>
              <tr>
                <DTh>{t("dash.audit.time")}</DTh>
                <DTh>{t("dash.audit.action")}</DTh>
                <DTh>{t("dash.audit.actor")}</DTh>
                <DTh>{t("dash.audit.subject")}</DTh>
                <DTh>{t("dash.audit.details")}</DTh>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <DTd className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt, lc)}</DTd>
                  <DTd>
                    <code dir="ltr" className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px]">
                      {e.action}
                    </code>
                  </DTd>
                  <DTd className="whitespace-nowrap">{actor(e.actorType, e.actorId)}</DTd>
                  <DTd className="whitespace-nowrap">
                    <span className="text-muted">{e.entityType}</span>{" "}
                    <bdi dir="ltr" className="font-mono text-[12px]">
                      {e.entityId}
                    </bdi>
                  </DTd>
                  <DTd className="max-w-96 truncate text-xs text-muted">
                    <span dir="ltr" title={JSON.stringify(e.data)}>
                      {auditDetails(e.data)}
                    </span>
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<ScrollText />} title={t("dash.audit.empty")} />
        )}
        <div className="flex justify-between gap-3 px-5 py-3 text-sm">
          {query.before ? (
            <Link href={`${base}/audit?${qs}`} className="text-primary hover:underline">
              {t("dash.audit.newest")}
            </Link>
          ) : (
            <span />
          )}
          {older ? (
            <Link href={older} className="text-primary hover:underline">
              {t("dash.audit.older")}
            </Link>
          ) : null}
        </div>
      </Panel>
      <ComplianceDisclaimer t={t} />
    </>
  );
}
