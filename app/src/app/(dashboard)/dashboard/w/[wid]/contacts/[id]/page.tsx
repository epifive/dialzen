import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PhoneOff, ShieldBan, ShieldCheck, Trash2 } from "lucide-react";
import { deleteContactsAction, eraseContactAction, listMembershipAction, optOutContactAction, removeDncAction, revokeConsentAction } from "@/app/actions/dashboard/contacts";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { PopoverForm } from "@/components/dashboard/client-kit";
import { ConsentForm, ContactForm } from "@/components/dashboard/contact-forms";
import { DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { contactCampaigns } from "@/lib/campaigns";
import { listCalls } from "@/lib/calls";
import { contactConsents } from "@/lib/compliance";
import { getContact, listContactLists } from "@/lib/contacts";
import { formatDateTime, formatRelative } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { businessDaysAfter, dncStatus } from "@/lib/dnc";
import { getLocale, getT } from "@/lib/i18n/server";
import { plural, type MessageKey } from "@/lib/i18n/messages";
import { callStatusTone, campaignContactTone, formatDuration } from "@/voice/format";
import { formatPhone, roleCan, timeZoneOptions, zonesForContact } from "@/voice/normalize";
import type { CallStatus } from "@/voice/types";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ wid: string; id: string }> }): Promise<Metadata> {
  const t = await getT();
  void params;
  return { title: t("dash.contacts.detail") };
}

/** One contact: details, consent records, DNC status, lists, campaigns and calls. */
export default async function ContactPage({ params, searchParams }: { params: Promise<{ wid: string; id: string }>; searchParams: Promise<{ created?: string }> }) {
  const p = await params;
  const { workspace, role } = await requireWorkspace(p.wid);
  const contact = await getContact(workspace.id, Number(p.id));
  if (!contact) notFound();
  const [query, t, locale, consents, dnc, calls, lists, campaigns] = await Promise.all([
    searchParams,
    getT(),
    getLocale(),
    contactConsents(workspace.id, contact.id, contact.phone),
    dncStatus(workspace.id, contact.phone),
    listCalls(workspace.id, { contactId: contact.id, limit: 20 }),
    listContactLists(workspace.id),
    contactCampaigns(workspace.id, contact.id),
  ]);
  const db = await getDb();
  const memberOf = new Set((await db.selectFrom("list_members").select("list_id").where("contact_id", "=", contact.id).execute()).map((r) => r.list_id));
  const lc = locale.code;
  const base = `/dashboard/w/${workspace.id}`;
  const canManage = roleCan(role, "contacts.manage");
  const canCompliance = roleCan(role, "compliance.manage");
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || t("dash.contacts.noName");
  const zones = zonesForContact({ timezone: contact.timezone, country: contact.country, state: contact.state, phone: contact.phone });
  const nowIso = new Date().toISOString();

  return (
    <>
      {query.created === "1" ? (
        <>
          <RefreshOnce cleanUrl={`${base}/contacts/${contact.id}`} />
          <Alert tone="success" className="mb-6">
            {t("dash.contacts.created")}
          </Alert>
        </>
      ) : null}
      <DashHeader
        title={name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <bdi dir="ltr" className="font-mono">
              {formatPhone(contact.phone)}
            </bdi>
            {contact.country ? <Badge>{contact.country}</Badge> : null}
            {contact.optedOutAt ? <Badge tone="danger">{t("dash.contacts.optedOut")}</Badge> : null}
            {dnc.workspace || dnc.global ? <Badge tone="warning">{t("dash.dnc.short")}</Badge> : null}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`${base}/contacts`} variant="outline">
              <ArrowLeft className="rtl:rotate-180" aria-hidden />
              {t("dash.nav.contacts")}
            </ButtonLink>
            {canManage && !contact.optedOutAt ? (
              <PopoverForm
                action={optOutContactAction}
                fields={{ wid: workspace.id, contact_id: contact.id }}
                trigger={
                  <>
                    <PhoneOff aria-hidden />
                    {t("dash.contacts.optOut")}
                  </>
                }
                title={t("dash.contacts.optOutTitle")}
                submitLabel={t("dash.contacts.optOutConfirm")}
                submitVariant="danger"
              >
                <p className="text-xs text-muted">{t("dash.contacts.optOutText")}</p>
                <Input name="note" maxLength={200} placeholder={t("dash.contacts.optOutNote")} aria-label={t("dash.contacts.optOutNote")} />
              </PopoverForm>
            ) : null}
            {canManage ? (
              <ActionButton action={deleteContactsAction} fields={{ wid: workspace.id, contact_id: contact.id }} variant="ghost" size="md" confirmText={t("dash.contacts.deleteConfirm")}>
                <Trash2 aria-hidden />
                {t("dash.contacts.delete")}
              </ActionButton>
            ) : null}
            {canCompliance ? (
              <ActionButton action={eraseContactAction} fields={{ wid: workspace.id, contact_id: contact.id }} variant="danger" size="md" confirmText={t("dash.contacts.eraseConfirm")}>
                <Trash2 aria-hidden />
                {t("dash.contacts.erase")}
              </ActionButton>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title={t("dash.contacts.details")} description={t("dash.contacts.zones", { zones: zones.map((z) => z.replaceAll("_", " ")).join(", ") })}>
            {canManage ? (
              <ContactForm workspaceId={workspace.id} values={{ id: contact.id, phone: contact.phone, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, company: contact.company, timezone: contact.timezone, state: contact.state, language: contact.language, tags: contact.tags }} timezones={timeZoneOptions()} />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">{t("dash.contacts.email")}</dt>
                  <dd dir="ltr">{contact.email || "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">{t("dash.contacts.company")}</dt>
                  <dd dir="auto">{contact.company || "—"}</dd>
                </div>
              </dl>
            )}
            {Object.keys(contact.fields).length ? (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-2 text-xs font-medium text-muted">{t("dash.contacts.customFields")}</p>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {Object.entries(contact.fields).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="font-mono text-[12px] text-muted" dir="ltr">
                        {`{{contact.${k}}}`}
                      </dt>
                      <dd className="truncate" dir="auto" title={v}>
                        {v || "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </Panel>

          <Panel title={t("dash.contacts.callsTitle")} padded={false}>
            {calls.calls.length ? (
              <DTable minWidth={560} label={t("dash.contacts.callsTitle")}>
                <thead>
                  <tr>
                    <DTh>{t("dash.contacts.when")}</DTh>
                    <DTh>{t("dash.contacts.direction")}</DTh>
                    <DTh>{t("dash.contacts.duration")}</DTh>
                    <DTh>{t("dash.contacts.status")}</DTh>
                    <DTh>{t("dash.contacts.outcome")}</DTh>
                  </tr>
                </thead>
                <tbody>
                  {calls.calls.map((c) => (
                    <tr key={c.id}>
                      <DTd className="whitespace-nowrap">
                        <Link href={`${base}/calls/${c.id}`} className="hover:text-primary">
                          {formatDateTime(c.createdAt, lc)}
                        </Link>
                      </DTd>
                      <DTd>{t(`dash.call.dir.${c.direction}` as MessageKey)}</DTd>
                      <DTd className="tabular-nums">{formatDuration(c.durationSec)}</DTd>
                      <DTd>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", callStatusTone(c.status as CallStatus))}>{t(`dash.call.status.${c.status}` as MessageKey)}</span>
                      </DTd>
                      <DTd className="text-muted">{c.outcome ? t(`dash.analytics.outcome.${c.outcome}` as MessageKey) : "—"}</DTd>
                    </tr>
                  ))}
                </tbody>
              </DTable>
            ) : (
              <Empty title={t("dash.contacts.noCalls")} />
            )}
          </Panel>

          {campaigns.length ? (
            <Panel title={t("dash.contacts.campaignsTitle")} padded={false}>
              <ul className="divide-y divide-line">
                {campaigns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <Link href={`${base}/campaigns/${r.campaign_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary" dir="auto">
                      {r.campaign_name}
                    </Link>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", campaignContactTone(r.state))}>{t(`dash.campaigns.row.${r.state}` as MessageKey)}</span>
                    <span className="text-xs text-muted">{plural(t, "dash.campaigns.attempts", r.attempts)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel title={t("dash.dnc.status")}>
            {dnc.workspace || dnc.global || contact.optedOutAt ? (
              <ul className="space-y-3 text-sm">
                {contact.optedOutAt ? (
                  <li className="flex gap-2">
                    <PhoneOff className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden />
                    <span>
                      {t("dash.contacts.optedOutAt", { date: formatDateTime(contact.optedOutAt, lc) })}
                      <span className="block text-xs text-muted">{t("dash.optouts.honourBy", { date: formatDateTime(businessDaysAfter(contact.optedOutAt, 10), lc, false) })}</span>
                    </span>
                  </li>
                ) : null}
                {dnc.workspace ? (
                  <li className="flex gap-2">
                    <ShieldBan className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                    <span className="min-w-0 flex-1">
                      {t("dash.dnc.onWorkspace", { reason: t(`dash.dnc.reason.${dnc.workspace.reason}` as MessageKey) })}
                      <span className="block text-xs text-muted">
                        {formatDateTime(dnc.workspace.created_at, lc, false)}
                        {dnc.workspace.expires_at ? ` · ${t("dash.dnc.expires", { date: formatDateTime(dnc.workspace.expires_at, lc, false) })}` : ""}
                      </span>
                      {canCompliance ? (
                        <ActionButton action={removeDncAction} fields={{ wid: workspace.id, phone: contact.phone }} variant="ghost" confirmText={t("dash.dnc.removeConfirm")} className="mt-1">
                          {t("dash.dnc.remove")}
                        </ActionButton>
                      ) : null}
                    </span>
                  </li>
                ) : null}
                {dnc.global ? (
                  <li className="flex gap-2">
                    <ShieldBan className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden />
                    <span>{t("dash.dnc.onGlobal")}</span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted">
                <ShieldCheck className="size-4 text-emerald-500" aria-hidden />
                {t("dash.dnc.clear")}
              </p>
            )}
          </Panel>

          <Panel title={t("dash.consent.title")} description={t("dash.consent.evidence")} padded={false}>
            {consents.length ? (
              <ul className="divide-y divide-line">
                {consents
                  .slice()
                  .reverse()
                  .map((c) => {
                    const expired = Boolean(c.expiresAt && c.expiresAt <= nowIso);
                    return (
                      <li key={c.id} className="space-y-1.5 px-5 py-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={c.revokedAt || expired ? "neutral" : "success"}>{t(`dash.consent.type.${c.type}` as MessageKey)}</Badge>
                          <span className="text-xs text-muted">{t(`dash.consent.purpose.${c.purpose}` as MessageKey)}</span>
                          {c.revokedAt ? <Badge tone="danger">{t("dash.consent.revokedBadge")}</Badge> : expired ? <Badge tone="warning">{t("dash.consent.expiredBadge")}</Badge> : null}
                        </div>
                        <p className="text-xs text-muted">
                          {t(`dash.consent.source.${c.source}` as MessageKey)} · {formatDateTime(c.capturedAt, lc)}
                          {c.ip ? (
                            <>
                              {" · "}
                              <bdi dir="ltr">{c.ip}</bdi>
                            </>
                          ) : null}
                        </p>
                        <details className="text-xs">
                          <summary className="cursor-pointer text-primary">{t("dash.consent.wording")}</summary>
                          <p className="mt-1 rounded-lg bg-paper p-2 whitespace-pre-wrap" dir="auto">
                            {c.textSnapshot}
                          </p>
                          {c.sourceUrl ? (
                            <p className="mt-1 truncate" dir="ltr">
                              {c.sourceUrl}
                            </p>
                          ) : null}
                        </details>
                        {c.revokedAt ? <p className="text-xs text-muted">{t("dash.consent.revokedAt", { date: formatDateTime(c.revokedAt, lc) })}</p> : null}
                        {canManage && !c.revokedAt ? (
                          <PopoverForm action={revokeConsentAction} fields={{ wid: workspace.id, consent_id: c.id }} trigger={t("dash.consent.revoke")} triggerVariant="ghost" title={t("dash.consent.revokeTitle")} submitLabel={t("dash.consent.revoke")} submitVariant="danger">
                            <Input name="reason" maxLength={255} placeholder={t("dash.consent.revokeReason")} aria-label={t("dash.consent.revokeReason")} />
                          </PopoverForm>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">{t("dash.consent.noneYet")}</p>
            )}
            {canManage ? (
              <details className="border-t border-line px-5 py-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">{t("dash.consent.add")}</summary>
                <div className="pt-4">
                  <ConsentForm workspaceId={workspace.id} contactId={contact.id} />
                </div>
              </details>
            ) : null}
          </Panel>

          <Panel title={t("dash.contacts.lists")}>
            {lists.length ? (
              <ul className="space-y-2 text-sm">
                {lists.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span dir="auto" className={memberOf.has(l.id) ? "font-medium" : "text-muted"}>
                      {l.name}
                    </span>
                    {canManage ? (
                      <ActionButton action={listMembershipAction} fields={{ wid: workspace.id, list_id: l.id, contact_id: contact.id, op: memberOf.has(l.id) ? "remove" : "add" }} variant="ghost">
                        {memberOf.has(l.id) ? t("dash.contacts.removeFromListBtn") : t("dash.contacts.addToListBtn")}
                      </ActionButton>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t("dash.contacts.noLists")}</p>
            )}
            <p className="mt-3 text-xs text-muted">
              {t("dash.contacts.source", { source: t(`dash.contacts.source.${contact.source}` as MessageKey) })} · {formatRelative(contact.createdAt, lc)}
            </p>
          </Panel>
        </aside>
      </div>
    </>
  );
}
