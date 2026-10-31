import { ButtonLink } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="relative overflow-hidden">
      <div className="mat-grid mat-grid-fade absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-lg px-4 py-24 text-center">
        <p className="font-display text-7xl font-bold text-primary">404</p>
        <h1 className="mt-4 text-3xl font-bold">{t("notFound.title")}</h1>
        <p className="mt-3 text-muted">{t("notFound.text")}</p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink href="/pricing">{t("notFound.browse")}</ButtonLink>
          <ButtonLink href="/" variant="outline">
            {t("notFound.home")}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
