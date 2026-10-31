import type { Metadata } from "next";
import Link from "next/link";
import { BookUser, Plus, Search, ShieldBan, Trash2, Upload } from "lucide-react";
import { bulkContactsAction } from "@/app/actions/dashboard/contacts";
import { RefreshOnce } from "@/components/dashboard/actions";
import { BulkForm, SelectAll } from "@/components/dashboard/client-kit";
import { ConfirmSubmit } from "@/components/dashboard/contact-forms";
import { ContactsTabs } from "@/components/dashboard/contact-tabs";
import { DashHeader, DTable, DTd, DTh, Empty, Pager, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { listContactLists, listContacts } from "@/lib/contacts";
import { formatNumber, formatRelative, intParam } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { formatPhone, roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.contacts") };
}

const PER_PAGE = 50;

/** Contacts of the workspace: search, filters, consent and DNC at a glance, bulk list actions. */
export default async function ContactsPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ q?: string; list?: string; tag?: string; status?: string; page?: string; deleted?: string; erased?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [query, t, locale] = await Promise.all([searchParams, getT(), getLocale()]);
  const base = `/dashboard/w/${workspace.id}/contacts`;
  const page = intParam(query.page, 1);
  const listId = Number(query.list) || undefined;
  const status = query.status === "opted_out" ? "opted_out" : query.status === "active" ? "active" : "all";
  const [{ contacts, total }, lists] = await Promise.all([
    listContacts(workspace.id, { q: query.q, listId, tag: query.tag, optedOut: status === "all" ? undefined : status === "opted_out", limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    listContactLists(workspace.id),
  ]);
  const canManage = roleCan(role, "contacts.manage");
  const lc = locale.code;

  // Consent and DNC of the rows shown.
  const phones = contacts.map((c) => c.phone);
  const db = await getDb();
  const nowIso = new Date().toISOString();
  const [consents, dnc] = phones.length
    ? await Promise.all([
        db.selectFrom("consents").select(["phone_e164", "type", "revoked_at", "expires_at"]).where("workspace_id", "=", workspace.id).where("phone_e164", "in", phones).execute(),
        db
          .selectFrom("dnc_entries")
          .select(["phone_e164", "scope", "expires_at"])
          .where("phone_e164", "in", phones)
          .where((eb) => eb.or([eb.and([eb("scope", "=", "workspace"), eb("workspace_id", "=", workspace.id)]), eb("scope", "=", "global")]))
          .execute(),
      ])
    : [[], []];
  const consentOf = new Map<string, Set<string>>();
  for (const c of consents) {
    if (c.revoked_at || (c.expires_at && c.expires_at <= nowIso)) continue;
    consentOf.set(c.phone_e164, (consentOf.get(c.phone_e164) ?? new Set()).add(c.type));
  }
  const dncOf = new Set(dnc.filter((d) => !d.expires_at || d.expires_at > nowIso).map((d) => d.phone_e164));

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const qs = (p: number) => {
    const sp = new URLSearchParams();
    if (query.q) sp.set("q", query.q);
    if (listId) sp.set("list", String(listId));
    if (query.tag) sp.set("tag", query.tag);
    if (status !== "all") sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const filtered = Boolean(query.q || listId || query.tag || status !== "all");

  return (
    <>
      {query.deleted === "1" || query.erased === "1" ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {query.erased === "1" ? t("dash.contacts.erased") : t("dash.contacts.deleted")}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={t("dash.nav.contacts")}
        description={t("dash.contacts.subtitle")}
        actions={
          canManage ? (
            <>
              <ButtonLink href={`${base}/import`} variant="outline">
                <Upload aria-hidden />
                {t("dash.contacts.import")}
              </ButtonLink>
              <ButtonLink href={`${base}/new`}>
                <Plus aria-hidden />
                {t("dash.contacts.add")}
              </ButtonLink>
            </>
          ) : null
        }
      />
      <ContactsTabs base={base} active="contacts" t={t} />

      <Panel padded={false}>
        <form method="get" className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_8rem_auto_auto] lg:items-center" role="search">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input name="q" defaultValue={query.q ?? ""} placeholder={t("dash.contacts.search")} aria-label={t("dash.contacts.search")} className="ps-9" />
          </div>
          <Select name="list" defaultValue={listId ? String(listId) : ""} aria-label={t("dash.contacts.filterList")}>
            <option value="">{t("dash.contacts.allLists")}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={status} aria-label={t("dash.contacts.filterStatus")}>
            <option value="all">{t("dash.contacts.statusAll")}</option>
            <option value="active">{t("dash.contacts.statusActive")}</option>
            <option value="opted_out">{t("dash.contacts.statusOptedOut")}</option>
          </Select>
          <Input name="tag" defaultValue={query.tag ?? ""} placeholder={t("dash.contacts.tag")} aria-label={t("dash.contacts.tag")} />
          <button type="submit" className={buttonClass("outline", "md")}>
            {t("dash.contacts.filter")}
          </button>
          {filtered ? (
            <Link href={base} className="px-2 text-sm text-muted hover:text-ink">
              {t("dash.contacts.clear")}
            </Link>
          ) : null}
        </form>

        {canManage && contacts.length ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
            <BulkForm id="contacts-bulk" action={bulkContactsAction} fields={{ wid: workspace.id }} className="w-full">
              <Select name="list_id" aria-label={t("dash.contacts.chooseList")} className="h-8 max-w-56 text-sm" defaultValue="">
                <option value="">{t("dash.contacts.chooseList")}</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
              <button type="submit" name="op" value="add" className={buttonClass("outline", "sm")}>
                {t("dash.contacts.addToListBtn")}
              </button>
              {listId ? (
                <button type="submit" name="op" value="remove" className={buttonClass("ghost", "sm")}>
                  {t("dash.contacts.removeFromListBtn")}
                </button>
              ) : null}
              <ConfirmSubmit name="op" value="delete" confirmText={t("dash.contacts.deleteSelectedConfirm")} className={buttonClass("ghost", "sm", "ms-auto")}>
                <Trash2 aria-hidden />
                {t("dash.contacts.deleteSelected")}
              </ConfirmSubmit>
            </BulkForm>
          </div>
        ) : null}

        {contacts.length ? (
          <DTable minWidth={820} label={t("dash.nav.contacts")}>
            <thead>
              <tr>
                {canManage ? (
                  <DTh className="w-10">
                    <SelectAll form="contacts-bulk" label={t("dash.contacts.selectAll")} />
                  </DTh>
                ) : null}
                <DTh>{t("dash.contacts.name")}</DTh>
                <DTh>{t("dash.contacts.phone")}</DTh>
                <DTh>{t("dash.consent.title")}</DTh>
                <DTh>{t("dash.contacts.tags")}</DTh>
                <DTh>{t("dash.contacts.lastCalled")}</DTh>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const types = [...(consentOf.get(c.phone) ?? [])];
                const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
                return (
                  <tr key={c.id}>
                    {canManage ? (
                      <DTd>
                        <input type="checkbox" name="ids" value={c.id} form="contacts-bulk" aria-label={t("dash.contacts.select", { name: name || c.phone })} className="size-4 rounded border-line accent-[var(--primary)]" />
                      </DTd>
                    ) : null}
                    <DTd>
                      <Link href={`${base}/${c.id}`} className="font-medium hover:text-primary" dir="auto">
                        {name || t("dash.contacts.noName")}
                      </Link>
                      {c.company ? (
                        <span className="block text-xs text-muted" dir="auto">
                          {c.company}
                        </span>
                      ) : null}
                    </DTd>
                    <DTd className="whitespace-nowrap">
                      <bdi dir="ltr" className="font-mono text-[13px]">
                        {formatPhone(c.phone)}
                      </bdi>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {c.optedOutAt ? <Badge tone="danger">{t("dash.contacts.optedOut")}</Badge> : null}
                        {dncOf.has(c.phone) ? (
                          <Badge tone="warning">
                            <ShieldBan className="size-3" aria-hidden />
                            {t("dash.dnc.short")}
                          </Badge>
                        ) : null}
                      </span>
                    </DTd>
                    <DTd>
                      {types.length ? (
                        <span className="flex flex-wrap gap-1">
                          {types.map((ty) => (
                            <Badge key={ty} tone="success">
                              {t(`dash.consent.short.${ty}` as MessageKey)}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">{t("dash.consent.none")}</span>
                      )}
                    </DTd>
                    <DTd>
                      <span className="flex max-w-52 flex-wrap gap-1">
                        {c.tags.slice(0, 4).map((tag) => (
                          <Link key={tag} href={`${base}?tag=${encodeURIComponent(tag)}`} className="rounded-full bg-line/70 px-2 py-0.5 text-xs text-muted hover:text-ink" dir="auto">
                            {tag}
                          </Link>
                        ))}
                      </span>
                    </DTd>
                    <DTd className="whitespace-nowrap text-muted">{c.lastCalledAt ? formatRelative(c.lastCalledAt, lc) : "—"}</DTd>
                  </tr>
                );
              })}
            </tbody>
          </DTable>
        ) : (
          <Empty
            icon={<BookUser />}
            title={filtered ? t("dash.contacts.noMatch") : t("dash.contacts.emptyTitle")}
            action={
              canManage && !filtered ? (
                <ButtonLink href={`${base}/import`} size="sm">
                  <Upload aria-hidden />
                  {t("dash.contacts.import")}
                </ButtonLink>
              ) : null
            }
          >
            {filtered ? null : t("dash.contacts.emptyText")}
          </Empty>
        )}
        <Pager
          page={page}
          pages={pages}
          href={qs}
          labels={{ summary: t("dash.contacts.pageSummary", { page, pages, total: formatNumber(total, lc) }), previous: t("dash.pager.previous"), next: t("dash.pager.next"), nav: t("dash.pager.nav") }}
        />
      </Panel>
    </>
  );
}
