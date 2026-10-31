import type { Metadata } from "next";
import { Crown, KeyRound, Trash2 } from "lucide-react";
import { deleteApiKeyAction } from "@/app/actions/dashboard/apikeys";
import { ActionButton } from "@/components/dashboard/actions";
import { CreateApiKeyForm } from "@/components/dashboard/api-key-forms";
import { CopyButton } from "@/components/dashboard/copy";
import { CodeBlock, DashHeader, DTable, DTd, DTh, Empty, Panel } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { getWorkspaceApiKeys } from "@/lib/api-keys";
import { formatDateTime, formatRelative } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { getLocale, getT } from "@/lib/i18n/server";
import { baseUrl } from "@/lib/request";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { roleCan } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.api.title") };
}

/** API keys of the workspace and the REST API reference. */
export default async function ApiKeysPage({ params }: { params: Promise<{ wid: string }> }) {
  const { user, workspace, role } = await requireWorkspace((await params).wid);
  const [t, locale, entitlements, keys, origin] = await Promise.all([getT(), getLocale(), getWorkspaceEntitlements(workspace), getWorkspaceApiKeys(workspace.id), baseUrl()]);
  const canManage = roleCan(role, "settings.manage");
  const auth = `-H "Authorization: Bearer YOUR_API_KEY"`;
  const lines = (...parts: string[]) => parts.join(" \\\n  ");
  const json = (o: unknown) => [`-H "Content-Type: application/json"`, `-d '${JSON.stringify(o)}'`];
  const examples = [
    { title: t("dash.api.exWorkspace"), code: lines(`curl "${origin}/api/v1/workspace"`, auth) },
    {
      title: t("dash.api.exContact"),
      code: lines(
        `curl -X POST "${origin}/api/v1/contacts"`,
        auth,
        ...json({ phone: "+14155550123", first_name: "Ana", list_ids: [1], consent: { type: "pewc", purpose: "telemarketing", source: "web_form", source_url: "https://example.com/form", captured_at: "2026-10-20T09:30:00Z", ip: "203.0.113.7", text: "I agree that Example Co may call me…" } }),
      ),
    },
    { title: t("dash.api.exCall"), code: lines(`curl -X POST "${origin}/api/v1/calls"`, auth, ...json({ agent_id: 1, number_id: 1, to: "+14155550123", purpose: "informational", variables: { appointment_day: "Friday" } })) },
    { title: t("dash.api.exCampaign"), code: lines(`curl -X POST "${origin}/api/v1/campaigns/1/start"`, auth) },
    { title: t("dash.api.exWebhook"), code: lines(`curl -X POST "${origin}/api/v1/webhooks"`, auth, ...json({ url: "https://n8n.example.com/webhook/dialzen", secret: "a-long-random-secret", events: ["call_completed"] })) },
  ];
  const endpoints: Array<[string, string, string]> = [
    ["GET", "/api/v1/workspace", t("dash.api.epWorkspace")],
    ["GET", "/api/v1/agents", t("dash.api.epAgents")],
    ["GET", "/api/v1/agents/{id}", t("dash.api.epAgent")],
    ["GET", "/api/v1/calls", t("dash.api.epCalls")],
    ["GET", "/api/v1/calls/{id}", t("dash.api.epCall")],
    ["POST", "/api/v1/calls", t("dash.api.epCallStart")],
    ["DELETE", "/api/v1/calls/{id}", t("dash.api.epCallDelete")],
    ["GET", "/api/v1/numbers", t("dash.api.epNumbers")],
    ["GET", "/api/v1/lists", t("dash.api.epLists")],
    ["POST", "/api/v1/lists", t("dash.api.epListCreate")],
    ["GET", "/api/v1/contacts", t("dash.api.epContacts")],
    ["POST", "/api/v1/contacts", t("dash.api.epContactUpsert")],
    ["GET", "/api/v1/contacts/{id}", t("dash.api.epContact")],
    ["POST", "/api/v1/dnc", t("dash.api.epDncAdd")],
    ["GET", "/api/v1/dnc/check?phone=", t("dash.api.epDncCheck")],
    ["DELETE", "/api/v1/dnc?phone=", t("dash.api.epDncRemove")],
    ["GET", "/api/v1/campaigns", t("dash.api.epCampaigns")],
    ["POST", "/api/v1/campaigns", t("dash.api.epCampaignCreate")],
    ["GET", "/api/v1/campaigns/{id}", t("dash.api.epCampaign")],
    ["POST", "/api/v1/campaigns/{id}/start", t("dash.api.epCampaignStart")],
    ["POST", "/api/v1/campaigns/{id}/pause", t("dash.api.epCampaignPause")],
    ["GET", "/api/v1/webhooks", t("dash.api.epWebhooks")],
    ["POST", "/api/v1/webhooks", t("dash.api.epWebhookCreate")],
    ["DELETE", "/api/v1/webhooks/{id}", t("dash.api.epWebhookDelete")],
  ];

  return (
    <div className="space-y-6">
      <DashHeader title={t("dash.api.title")} description={t("dash.api.subtitle")} />

      {!entitlements.allowApi ? (
        <Alert tone="warning" title={t("dash.api.upgradeTitle")}>
          <p>{t("dash.api.upgrade")}</p>
          {workspace.ownerId === user.id ? (
            <ButtonLink href="/pricing" size="sm" className="mt-3">
              <Crown aria-hidden />
              {t("dash.banner.cta")}
            </ButtonLink>
          ) : null}
        </Alert>
      ) : canManage ? (
        <Panel title={t("dash.api.createTitle")} description={t("dash.api.createText")}>
          <CreateApiKeyForm workspaceId={workspace.id} />
        </Panel>
      ) : null}

      <Panel title={t("dash.api.list")} padded={false}>
        {keys.length ? (
          <DTable minWidth={620} label={t("dash.api.list")}>
            <thead>
              <tr>
                <DTh>{t("dash.api.name")}</DTh>
                <DTh>{t("dash.api.key")}</DTh>
                <DTh>{t("dash.api.createdAt")}</DTh>
                <DTh>{t("dash.api.lastUsed")}</DTh>
                <DTh className="text-end">
                  <span className="sr-only">{t("dash.api.actions")}</span>
                </DTh>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <DTd>
                    <span dir="auto" className="font-medium">
                      {k.name}
                    </span>
                  </DTd>
                  <DTd>
                    <code dir="ltr" className="font-mono text-[13px] text-muted">
                      {k.prefix}…
                    </code>
                  </DTd>
                  <DTd className="text-muted">{formatDateTime(k.createdAt, locale.code, false)}</DTd>
                  <DTd className="text-muted">{k.lastUsedAt ? formatRelative(k.lastUsedAt, locale.code) : t("dash.api.never")}</DTd>
                  <DTd className="text-end">
                    {canManage ? (
                      <ActionButton
                        action={deleteApiKeyAction}
                        fields={{ wid: workspace.id, key_id: k.id }}
                        variant="ghost"
                        confirmText={t("dash.api.revokeConfirm", { name: k.name })}
                        className="items-end"
                      >
                        <Trash2 aria-hidden />
                        {t("dash.api.revoke")}
                      </ActionButton>
                    ) : null}
                  </DTd>
                </tr>
              ))}
            </tbody>
          </DTable>
        ) : (
          <Empty icon={<KeyRound />} title={t("dash.api.emptyTitle")}>
            {t("dash.api.emptyText")}
          </Empty>
        )}
      </Panel>

      <Panel title={t("dash.api.docsTitle")} description={t("dash.api.docsText")}>
        <DTable minWidth={520} label={t("dash.api.endpoints")} dense>
          <thead>
            <tr>
              <DTh>{t("dash.api.endpoint")}</DTh>
              <DTh>{t("dash.api.endpointWhat")}</DTh>
            </tr>
          </thead>
          <tbody>
            {endpoints.map(([method, path, what]) => (
              <tr key={method + path}>
                <DTd className="whitespace-nowrap">
                  <code dir="ltr" className="font-mono text-[12px]">
                    <span className="me-2 font-semibold text-primary">{method}</span>
                    {path}
                  </code>
                </DTd>
                <DTd className="text-muted">{what}</DTd>
              </tr>
            ))}
          </tbody>
        </DTable>
        <div className="mt-5 space-y-4">
          {examples.map((ex) => (
            <div key={ex.title}>
              <p className="mb-1.5 text-sm font-medium">{ex.title}</p>
              <div className="relative">
                <CodeBlock className="pe-24">{ex.code}</CodeBlock>
                <CopyButton text={ex.code} className="absolute end-2 top-2" />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("dash.api.limits")}</p>
        <p className="mt-3 text-xs text-muted">{t("dash.api.scope")}</p>
        <p className="mt-1 text-xs text-muted">{t("dash.api.errors")}</p>
        <p className="mt-1 text-xs text-muted">{t("dash.api.blockedNote")}</p>
        <p className="mt-1 text-xs text-muted">{t("dash.api.webhookNote")}</p>
      </Panel>
    </div>
  );
}
