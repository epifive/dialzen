import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AgentCreateForm } from "@/components/dashboard/agent-create";
import { DashHeader } from "@/components/dashboard/ui";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { countOwnerAgents } from "@/lib/agents";
import { requireWorkspace } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { atLimit } from "@/lib/plans";
import { availableProviders } from "@/lib/providers";
import { getSettings } from "@/lib/settings";
import { getWorkspaceEntitlements } from "@/lib/workspaces";
import { AGENT_TEMPLATES } from "@/voice/templates";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.agents.new") };
}

export default async function NewAgentPage({ params, searchParams }: { params: Promise<{ wid: string }>; searchParams: Promise<{ template?: string }> }) {
  const { workspace } = await requireWorkspace((await params).wid, "editor");
  const [query, t, providers, settings, entitlements, used] = await Promise.all([searchParams, getT(), availableProviders(), getSettings(), getWorkspaceEntitlements(workspace), countOwnerAgents(workspace.ownerId)]);
  const base = `/dashboard/w/${workspace.id}/agents`;
  const full = atLimit(used, entitlements.maxAgents);
  const initial = AGENT_TEMPLATES.some((tpl) => tpl.id === query.template) ? (query.template as string) : "receptionist";

  return (
    <>
      <Link href={base} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("dash.nav.agents")}
      </Link>
      <DashHeader title={t("dash.agents.new")} description={t("dash.agents.newSubtitle")} />
      {full ? (
        <Alert tone="warning" title={t("dash.agents.limitTitle")}>
          {t("dash.agents.limitReached", { limit: entitlements.maxAgents })}{" "}
          <ButtonLink href="/pricing" variant="secondary" size="sm" className="ms-1">
            {t("dash.agents.upgrade")}
          </ButtonLink>
        </Alert>
      ) : (
        <AgentCreateForm
          wid={workspace.id}
          templates={AGENT_TEMPLATES.map((tpl) => ({ id: tpl.id, icon: tpl.icon, direction: tpl.direction, suggestedTools: tpl.suggestedTools }))}
          providers={providers}
          defaultProvider={settings.voice_default_provider}
          defaultLanguage={workspace.settings.defaultLanguage}
          initialTemplate={initial}
        />
      )}
    </>
  );
}
