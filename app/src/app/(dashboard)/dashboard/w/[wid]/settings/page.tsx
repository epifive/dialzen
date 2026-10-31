import type { Metadata } from "next";
import { ProviderKeysCard, RemoveSavedKeysForm } from "@/components/dashboard/provider-keys-forms";
import { DashHeader, Panel } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { BrandingForm, DeleteWorkspaceForm, WorkspaceSettingsForm } from "@/components/dashboard/workspace-forms";
import { formatDateTime } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { sellPricePerMinMicros, webhookUrl, workspaceKeysSummary } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { AGENT_LANGUAGES, formatMicros, providerName } from "@/voice/format";
import { COUNTRIES, roleCan, timeZoneOptions } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.settings") };
}

/** Workspace settings: general (name, time zone, default country and language), white-label branding, own voice provider keys and deleting the workspace. */
export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { workspace, role } = await requireWorkspace((await params).wid);
  const [t, entitlements, locale, settings] = await Promise.all([getT(), getWorkspaceEntitlements(workspace), getLocale(), getSettings()]);
  const lc = locale.code;
  const canManage = roleCan(role, "settings.manage");
  const byoKeys = canManage ? await workspaceKeysSummary(workspace.id) : [];
  const byoProviders = canManage ? await Promise.all((["elevenlabs", "retell"] as const).map(async (id) => ({ id, url: await webhookUrl(id) }))) : [];
  const money = (micros: number) => formatMicros(micros, settings.currency, lc, true);
  return (
    <>
      <DashHeader title={t("dash.nav.settings")} description={t("dash.settings.subtitle")} />
      <Panel title={t("dash.settings.general")}>
        <WorkspaceSettingsForm
          workspaceId={workspace.id}
          zones={timeZoneOptions()}
          canEdit={roleCan(role, "settings.manage")}
          countries={Object.values(COUNTRIES)
            .map((c): [string, string] => [c.iso, c.name])
            .sort((a, b) => a[1].localeCompare(b[1]))}
          languages={AGENT_LANGUAGES.map((l): [string, string] => [l.tag, l.name])}
          values={{ name: workspace.name, timezone: workspace.timezone, weekStart: workspace.settings.weekStart, defaultCountry: workspace.settings.defaultCountry, defaultLanguage: workspace.settings.defaultLanguage }}
        />
      </Panel>
      <Panel id="branding" title={t("dash.branding.title")} description={entitlements.allowWhiteLabel ? t("dash.branding.text") : t("dash.branding.upsell")} className="mt-6">
        <BrandingForm workspaceId={workspace.id} values={workspace.settings.branding} canEdit={roleCan(role, "settings.manage")} />
      </Panel>
      {canManage ? (
        <Panel id="provider-keys" title={t("dash.byo.title")} description={entitlements.allowByoKeys ? t("dash.byo.text") : t("dash.byo.upsell")} className="mt-6">
          {entitlements.allowByoKeys ? (
            <>
              <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-muted">
                <li>
                  {t("dash.byo.price", {
                    fee: money(sellPricePerMinMicros(settings, "elevenlabs", "byo")),
                    elevenlabs: money(sellPricePerMinMicros(settings, "elevenlabs", "platform")),
                    retell: money(sellPricePerMinMicros(settings, "retell", "platform")),
                  })}
                </li>
                <li>{t("dash.byo.account")}</li>
                <li>{t("dash.byo.sync")}</li>
                <li>{t("dash.byo.numbers")}</li>
              </ul>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {byoProviders.map(({ id, url }) => {
                  const saved = byoKeys.find((k) => k.provider === id) ?? null;
                  return <ProviderKeysCard key={id} workspaceId={workspace.id} provider={id} name={providerName(id)} webhookUrl={url} canEdit={canManage} saved={saved} checkedLabel={saved?.lastCheckedAt ? formatDateTime(saved.lastCheckedAt, lc) : ""} />;
                })}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {byoKeys.length ? <p className="text-sm text-muted">{t("dash.byo.unusedSaved")}</p> : null}
              {byoKeys.length ? (
                <div className="flex flex-wrap gap-3">
                  {byoKeys
                    .filter((k): k is typeof k & { provider: "elevenlabs" | "retell" } => k.provider === "elevenlabs" || k.provider === "retell")
                    .map((k) => (
                      <RemoveSavedKeysForm key={k.provider} workspaceId={workspace.id} provider={k.provider} name={providerName(k.provider)} />
                    ))}
                </div>
              ) : null}
              <ButtonLink href="/pricing" variant="outline" size="sm">
                {t("dash.byo.upgrade")}
              </ButtonLink>
            </div>
          )}
        </Panel>
      ) : null}
      {roleCan(role, "workspace.delete") ? (
        <Panel id="delete" title={t("dash.settings.deleteTitle")} description={workspace.isPersonal ? undefined : t("dash.settings.deleteText")} className="mt-6">
          {workspace.isPersonal ? <p className="text-sm text-muted">{t("dash.settings.deletePersonal")}</p> : <DeleteWorkspaceForm workspaceId={workspace.id} name={workspace.name} />}
        </Panel>
      ) : null}
    </>
  );
}
