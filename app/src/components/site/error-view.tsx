"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * Fallback UI of the error boundaries (error.tsx). Translated where an I18nProvider is above the
 * boundary (site and dashboard), English otherwise (admin panel).
 */
export function ErrorView({
  error,
  retry,
  backHref = "/",
  backLabel = "notFound.home",
  compact = false,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  backHref?: string;
  backLabel?: MessageKey;
  /** Inside a dashboard card instead of a full page. */
  compact?: boolean;
}) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className={compact ? "rounded-xl border border-line bg-surface px-6 py-12 text-center" : "mx-auto max-w-lg px-4 py-24 text-center"}>
      <h1 className={compact ? "text-xl font-bold" : "text-3xl font-bold"}>{t("error.title")}</h1>
      <p className="mx-auto mt-3 max-w-md text-muted">{t("error.text")}</p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">
          {t("error.reference")} <code dir="ltr" className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>
          <RotateCcw aria-hidden />
          {t("error.retry")}
        </Button>
        <ButtonLink href={backHref} variant="outline">
          {t(backLabel)}
        </ButtonLink>
      </div>
    </div>
  );
}
