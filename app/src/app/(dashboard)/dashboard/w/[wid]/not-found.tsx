import { SearchX } from "lucide-react";
import { Empty, Panel } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

/** 404 inside a workspace (unknown agent, call, contact… or a page the member's role can't open). */
export default async function WorkspaceNotFound() {
  const t = await getT();
  return (
    <Panel>
      <Empty icon={<SearchX />} title={t("dash.notFound.title")} action={<ButtonLink href="/dashboard">{t("dash.notFound.back")}</ButtonLink>}>
        {t("dash.notFound.text")}
      </Empty>
    </Panel>
  );
}
