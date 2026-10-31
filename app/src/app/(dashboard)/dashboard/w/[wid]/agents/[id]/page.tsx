import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pause, Play, RefreshCw } from "lucide-react";
import { setAgentStatusAction, syncAgentAction } from "@/app/actions/dashboard/agents";
import { ActionButton, RefreshOnce } from "@/components/dashboard/actions";
import { SyncBadge } from "@/components/dashboard/agent-badges";
import { AgentAnalysisForm, AgentBasicsForm, AgentBehaviourForm, AgentPromptForm, type AgentFormValues } from "@/components/dashboard/agent-forms";
import { AgentTestCall } from "@/components/dashboard/agent-test";
import { KbPanel } from "@/components/dashboard/kb-panel";
import { ToolsPanel, type ToolView } from "@/components/dashboard/tool-forms";
import { DashHeader, LinkTabs, Panel } from "@/components/dashboard/ui";
import { WidgetSettingsForm } from "@/components/dashboard/widget-settings";
import { Alert } from "@/components/ui/alert";
import { agentToolIds, getAgent } from "@/lib/agents";
import { aiAvailable, AGENT_CALL_RULES } from "@/lib/ai";
import { getCompliance } from "@/lib/compliance";
import { requireWorkspace } from "@/lib/dashboard";
import { getDb } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { listKbItems } from "@/lib/kb";
import { getMediaLimits } from "@/lib/media/service";
import { availableProviders, getProvider } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { absoluteUrl } from "@/lib/site";
import { decryptToolConfig, listTools, publicToolConfig, toolUsage } from "@/lib/tool-configs";
import { getUsage } from "@/lib/usage";
import { widgetKey } from "@/lib/widget";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { agentStatusTone, providerName } from "@/voice/format";
import { roleCan, timeZoneOptions } from "@/voice/normalize";
import { cn } from "@/lib/utils";

const TABS = ["basics", "prompt", "knowledge", "tools", "behaviour", "analysis", "widget", "test"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ wid: string; id: string }> }): Promise<Metadata> {
  const t = await getT();
  const { wid, id } = await params;
  const { workspace } = await requireWorkspace(wid);
  const agent = await getAgent(workspace.id, Number(id));
  return { title: agent ? `${agent.name} · ${t("dash.nav.agents")}` : t("dash.nav.agents") };
}

/** The agent builder: one tab per part of the agent, saved and synced separately. */
export default async function AgentEditorPage({ params, searchParams }: { params: Promise<{ wid: string; id: string }>; searchParams: Promise<{ tab?: string; created?: string }> }) {
  const { wid, id } = await params;
  const { workspace, role } = await requireWorkspace(wid);
  const [query, t, agent, settings] = await Promise.all([searchParams, getT(), getAgent(workspace.id, Number(id)), getSettings()]);
  if (!agent) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(query.tab ?? "") ? (query.tab as Tab) : "basics";
  const base = `/dashboard/w/${workspace.id}/agents/${agent.id}`;
  const canManage = roleCan(role, "agents.manage");
  const readOnly = !canManage;
  const values: AgentFormValues = {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    language: agent.language,
    voiceId: agent.voiceId,
    voiceName: agent.voiceName,
    llm: agent.llm,
    firstMessage: agent.firstMessage,
    systemPrompt: agent.systemPrompt,
    settings: agent.settings,
  };
  const caps = getProvider(agent.provider)?.capabilities;

  let content: React.ReactNode = null;
  switch (tab) {
    case "basics":
      content = <AgentBasicsForm wid={workspace.id} agent={values} providers={await availableProviders()} readOnly={readOnly} />;
      break;
    case "prompt": {
      const [compliance, available, entitlements, usage] = await Promise.all([getCompliance(workspace), aiAvailable(), getWorkspaceEntitlements(workspace), getUsage(workspace.ownerId)]);
      content = (
        <AgentPromptForm
          wid={workspace.id}
          agent={values}
          defaultBusiness={compliance.settings.businessName || workspace.name}
          callRules={AGENT_CALL_RULES}
          ai={{ available: available && entitlements.maxAiMonthly !== 0, used: usage.aiRequests, limit: entitlements.maxAiMonthly }}
          readOnly={readOnly}
        />
      );
      break;
    }
    case "knowledge": {
      const [items, limits] = await Promise.all([listKbItems(workspace.id, agent.id), getMediaLimits()]);
      content = (
        <KbPanel
          wid={workspace.id}
          agentId={agent.id}
          items={items.map((i) => ({ id: i.id, agentId: i.agentId, kind: i.kind, name: i.name, url: i.url, sizeBytes: i.sizeBytes, textLength: i.textLength, status: i.status, error: i.error }))}
          readOnly={readOnly}
          maxFileMb={Math.round(limits.maxFileBytes / 1048576)}
          providerHasKb={caps?.knowledgeBase ?? true}
        />
      );
      break;
    }
    case "tools": {
      const db = await getDb();
      const [tools, attached, usage] = await Promise.all([listTools(workspace.id), agentToolIds(agent.id), toolUsage(workspace.id)]);
      const rows = await db.selectFrom("tools").select(["id", "config"]).where("workspace_id", "=", workspace.id).execute();
      const encrypted = new Map(rows.map((r) => [r.id, r.config]));
      const views: ToolView[] = await Promise.all(
        tools.map(async (tool) => {
          const pub = publicToolConfig(tool.kind, await decryptToolConfig(tool.kind, encrypted.get(tool.id) ?? ""));
          return {
            id: tool.id,
            kind: tool.kind,
            name: tool.name,
            description: tool.description,
            status: tool.status,
            lastError: tool.lastError,
            attached: attached.includes(tool.id),
            usedByOthers: (usage.get(tool.id) ?? []).filter((a) => a !== agent.id).length,
            config: pub.config,
            secretsSet: pub.secretsSet,
          };
        }),
      );
      content = (
        <ToolsPanel
          wid={workspace.id}
          agentId={agent.id}
          tools={views}
          endpointBase={absoluteUrl(settings).replace(/\/+$/, "")}
          timezones={timeZoneOptions()}
          defaultTimezone={workspace.timezone}
          googleConfigured={Boolean(settings.google_client_id && settings.google_client_secret)}
          readOnly={readOnly}
          warmTransfer={getProvider(agent.provider)?.capabilities.warmTransfer ?? agent.provider !== "retell"}
        />
      );
      break;
    }
    case "behaviour": {
      const compliance = await getCompliance(workspace);
      content = <AgentBehaviourForm wid={workspace.id} agent={values} recordingNotice={compliance.settings.recordingDisclosureText} voicemailSupported={caps?.voicemailDetection ?? true} readOnly={readOnly} />;
      break;
    }
    case "analysis":
      content = <AgentAnalysisForm wid={workspace.id} agent={values} readOnly={readOnly} />;
      break;
    case "widget":
      content = (
        <WidgetSettingsForm
          wid={workspace.id}
          agentId={agent.id}
          widget={agent.settings.widget}
          widgetKey={await widgetKey(agent.id)}
          origin={absoluteUrl(settings).replace(/\/+$/, "")}
          platformColor={workspace.settings.branding.color || settings.primary_color || "#a21caf"}
          simulated={agent.provider === "simulated"}
          readOnly={readOnly}
        />
      );
      break;
    case "test":
      content = <AgentTestCall wid={workspace.id} agentId={agent.id} language={agent.language} provider={agent.provider} canTest={canManage} />;
      break;
  }

  const tabLabel = (k: Tab) => t(`dash.agent.tab.${k}` as MessageKey);
  const nextStatus = agent.status === "active" ? "paused" : "active";

  return (
    <>
      {query.created === "1" ? (
        <>
          <RefreshOnce cleanUrl={base} />
          <Alert tone="success" className="mb-6">
            {t("dash.agents.created")}
          </Alert>
        </>
      ) : null}
      <Link href={`/dashboard/w/${workspace.id}/agents`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.nav.agents")}
      </Link>
      <DashHeader
        title={agent.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", agentStatusTone(agent.status))}>{t(`dash.agent.status.${agent.status}`)}</span>
            <SyncBadge status={agent.syncStatus} error={agent.syncError} />
            <span>{providerName(agent.provider, t)}</span>
          </span>
        }
        actions={
          canManage ? (
            <>
              <ActionButton action={syncAgentAction} fields={{ wid: workspace.id, agent_id: agent.id }} showSuccess>
                <RefreshCw aria-hidden />
                {t("dash.agent.syncNow")}
              </ActionButton>
              <ActionButton action={setAgentStatusAction} fields={{ wid: workspace.id, agent_id: agent.id, status: nextStatus }} variant={agent.status === "active" ? "outline" : "primary"}>
                {agent.status === "active" ? <Pause aria-hidden /> : <Play aria-hidden />}
                {agent.status === "active" ? t("dash.agent.pause") : t("dash.agent.activate")}
              </ActionButton>
            </>
          ) : null
        }
      />
      {agent.syncStatus === "error" && agent.syncError ? (
        <Alert tone="error" title={t("dash.agent.syncErrorTitle")} className="mb-6">
          <span dir="auto">{agent.syncError}</span>
        </Alert>
      ) : null}
      {readOnly ? (
        <Alert tone="info" className="mb-6">
          {t("dash.agent.readOnly")}
        </Alert>
      ) : null}
      <div className="mb-6 max-w-full overflow-x-auto">
        <LinkTabs label={t("dash.agent.tabs")} items={TABS.map((k) => ({ href: k === "basics" ? base : `${base}?tab=${k}`, label: tabLabel(k), active: k === tab }))} />
      </div>
      <Panel title={tabLabel(tab)} description={t(`dash.agent.tabText.${tab}` as MessageKey)}>
        {content}
      </Panel>
    </>
  );
}
