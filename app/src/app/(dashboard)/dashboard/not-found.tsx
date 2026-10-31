import { SearchX } from "lucide-react";
import { Empty, Panel } from "@/components/dashboard/ui";
import { ButtonLink } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export default async function DashboardNotFound() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <Panel>
        <Empty icon={<SearchX />} title={t("dash.notFound.title")} action={<ButtonLink href="/dashboard">{t("dash.notFound.back")}</ButtonLink>}>
          {t("dash.notFound.text")}
        </Empty>
      </Panel>
    </div>
  );
}
