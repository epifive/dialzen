import type { Metadata } from "next";
import Link from "next/link";
import { NewWorkspaceForm } from "@/components/dashboard/workspace-forms";
import { AuthCard } from "@/components/site/auth-card";
import { requireDashboardUser } from "@/lib/dashboard";
import { getT } from "@/lib/i18n/server";
import { timeZoneOptions } from "@/voice/normalize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.ws.new") };
}

/** Create another workspace (a brand or a client). Limits keep counting on the creator's plan. */
export default async function NewWorkspacePage() {
  await requireDashboardUser();
  const t = await getT();
  return (
    <div className="min-h-dvh bg-paper">
      <AuthCard
        title={t("dash.ws.newTitle")}
        subtitle={t("dash.ws.newText")}
        footer={
          <Link href="/dashboard" className="font-medium text-primary hover:underline">
            {t("dash.notFound.back")}
          </Link>
        }
      >
        <NewWorkspaceForm zones={timeZoneOptions()} />
      </AuthCard>
    </div>
  );
}
