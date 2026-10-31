import type { Metadata } from "next";
import Link from "next/link";
import { Hash, PhoneIncoming, Trash } from "lucide-react";
import "@/lib/voice";
import { releaseNumberAction, simulateInboundAction } from "@/app/actions/dashboard/numbers";
import { ActionButton } from "@/components/dashboard/actions";
import { BuyNumberDialog, ImportNumberDialog, type NumberProviderOption } from "@/components/dashboard/number-dialogs";
import { NumberSettingsForm } from "@/components/dashboard/number-row";
import { DashHeader, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { listAgents } from "@/lib/agents";
import { getCompliance } from "@/lib/compliance";
import { isDemoMode } from "@/lib/config";
import { requireWorkspace } from "@/lib/dashboard";
import { formatNumber } from "@/lib/dash-format";
import { getLocale, getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { countOwnerNumbers, dialsToday, listNumbers } from "@/lib/numbers";
import { atLimit } from "@/lib/plans";
import { availableProviders, getProvider } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { rentalPriceMicros } from "@/lib/voice/numbers";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { formatMicros, numberStatusTone, providerName } from "@/voice/format";
import { cn } from "@/lib/utils";
import { formatPhone, roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.numbers") };
}

export default async function NumbersPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ dialog?: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, locale, settings, query, entitlements, numbers, agents, compliance, used, providerIds] = await Promise.all([
    getT(),
    getLocale(),
    getSettings(),
    searchParams,
    getWorkspaceEntitlements(workspace),
    listNumbers(workspace.id),
    listAgents(workspace.id),
    getCompliance(workspace),
    countOwnerNumbers(workspace.ownerId),
    availableProviders(),
  ]);
  const canManage = roleCan(role, "numbers.manage");
  const limit = entitlements.maxNumbers;
  const full = atLimit(used, limit);
  const rental = await rentalPriceMicros(workspace.ownerId);
  const rentalLabel = rental > 0 ? formatMicros(rental, settings.currency, locale.code) : "";
  const providers: NumberProviderOption[] = providerIds
    .map((id) => getProvider(id))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => ({ id: p.id, name: providerName(p.id, t), purchase: Boolean(p.buyNumber) && p.capabilities.numbersPurchase, countries: p.capabilities.purchaseCountries, imports: p.capabilities.numbersImport }));
  const dials = await Promise.all(numbers.map((n) => dialsToday(n.id, workspace.timezone)));
  const outboundApproved = !settings.outbound_requires_approval || compliance.outboundState === "approved";
  const complianceHref = `/dashboard/w/${workspace.id}/compliance`;
  const agentName = (id: number | null) => agents.find((a) => a.id === id)?.name ?? "";

  return (
    <>
      <DashHeader
        title={t("dash.nav.numbers")}
        description={t("dash.numbers.subtitle")}
        actions={
          canManage && limit !== 0 ? (
            <>
              <BuyNumberDialog wid={workspace.id} providers={providers} rentalLabel={rentalLabel} disabled={full} openOnLoad={query.dialog === "buy"} />
              <ImportNumberDialog wid={workspace.id} providers={providers} disabled={full} openOnLoad={query.dialog === "import"} />
            </>
          ) : null
        }
      />

      {limit === 0 ? (
        <Alert tone="info" className="mb-6" title={t("dash.numbers.limitTitle")}>
          <p>{t("dash.numbers.limitText")}</p>
          <ButtonLink href="/pricing" variant="secondary" size="sm" className="mt-3">
            {t("dash.numbers.upgrade")}
          </ButtonLink>
        </Alert>
      ) : (
        <p className="-mt-3 mb-5 text-sm text-muted">
          {limit < 0 ? t("dash.numbers.usageUnlimited", { used: formatNumber(used, locale.code) }) : t("dash.numbers.usage", { used: formatNumber(used, locale.code), limit: formatNumber(limit, locale.code) })}
          {full && limit > 0 ? ` ${t("dash.numbers.full")}` : ""}
        </p>
      )}

      {!outboundApproved && limit !== 0 ? (
        <Alert tone="warning" className="mb-6" title={t("dash.numbers.kycTitle")}>
          <p>{compliance.outboundState === "pending" ? t("dash.numbers.kycPending") : compliance.outboundState === "rejected" || compliance.outboundState === "suspended" ? t("dash.numbers.kycRejected") : t("dash.numbers.kycText")}</p>
          <Link href={complianceHref} className="mt-2 inline-block font-medium text-primary underline-offset-2 hover:underline">
            {t("dash.numbers.kycLink")}
          </Link>
        </Alert>
      ) : null}

      {isDemoMode() ? (
        <Alert tone="info" className="mb-6">
          {t("dash.numbers.demoNote")}
        </Alert>
      ) : null}

      {numbers.length ? (
        <ul className="space-y-4">
          {numbers.map((n, i) => (
            <li key={n.id}>
              <Panel padded={false}>
                <div className="flex flex-wrap items-start gap-4 border-b border-line px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    <Hash className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-semibold" dir="ltr">
                        {formatPhone(n.e164)}
                      </span>
                      {n.label ? (
                        <span dir="auto" className="text-sm text-muted">
                          {n.label}
                        </span>
                      ) : null}
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", numberStatusTone(n.status))}>{t(`dash.numbers.status.${n.status}` as MessageKey)}</span>
                      {n.outboundEnabled ? <Badge tone="primary">{t("dash.numbers.outboundOn")}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {[
                        providerName(n.provider, t),
                        t(`dash.numbers.carrier.${n.carrier}` as MessageKey),
                        n.country,
                        n.monthlyPriceMicros > 0 ? t("dash.numbers.rental", { price: formatMicros(n.monthlyPriceMicros, settings.currency, locale.code) }) : "",
                        t("dash.numbers.dialsToday", { n: formatNumber(dials[i], locale.code), cap: formatNumber(n.dailyDialCap, locale.code) }),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 text-sm">
                      <PhoneIncoming className="me-1 inline size-3.5 text-muted" aria-hidden />
                      {n.inboundAgentId ? t("dash.numbers.answeredBy", { name: agentName(n.inboundAgentId) }) : <span className="text-muted">{t("dash.numbers.notAnswered")}</span>}
                    </p>
                    {n.lastError ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t("dash.numbers.lastError", { error: n.lastError })}</p> : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap items-start gap-2">
                      {n.provider === "simulated" && n.inboundAgentId ? (
                        <ActionButton action={simulateInboundAction} fields={{ wid: workspace.id, number_id: n.id }} showSuccess>
                          <PhoneIncoming aria-hidden />
                          {t("dash.numbers.testInbound")}
                        </ActionButton>
                      ) : null}
                      <ActionButton action={releaseNumberAction} fields={{ wid: workspace.id, number_id: n.id }} confirmText={t("dash.numbers.releaseConfirm", { number: formatPhone(n.e164) })} label={t("dash.numbers.release")} buttonClassName="hover:border-red-300 hover:text-red-600">
                        <Trash aria-hidden />
                      </ActionButton>
                    </div>
                  ) : null}
                </div>
                <div className="px-5 py-4">
                  <NumberSettingsForm
                    wid={workspace.id}
                    number={{ id: n.id, label: n.label, inboundAgentId: n.inboundAgentId, outboundEnabled: n.outboundEnabled, dailyDialCap: n.dailyDialCap }}
                    agents={agents.map((a) => ({ id: a.id, name: a.name, compatible: a.provider === n.provider }))}
                    canEdit={canManage}
                  />
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      ) : (
        <Panel>
          <Empty icon={<Hash />} title={t("dash.numbers.emptyTitle")}>
            {limit === 0 ? t("dash.numbers.emptyTextFree") : t("dash.numbers.emptyText")}
          </Empty>
        </Panel>
      )}
      {rentalLabel && limit !== 0 ? <p className="mt-4 text-xs text-muted">{t("dash.numbers.rentalFooter", { price: rentalLabel })}</p> : null}
    </>
  );
}
