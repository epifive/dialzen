"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

const KEY = "dz-cookie-consent";

export function CookieConsent({ text, privacyHref }: { text: string; privacyHref?: string }) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consent is only known in the browser
    setVisible(localStorage.getItem(KEY) !== "1");
  }, []);

  if (!visible) return null;
  return (
    <div
      role="region"
      aria-label={t("cookie.label")}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-2xl sm:flex-row sm:items-center"
    >
      <p className="flex-1 text-sm text-muted">
        {text}{" "}
        {privacyHref ? (
          <Link href={privacyHref} className="font-medium text-primary underline underline-offset-2">
            {t("cookie.privacy")}
          </Link>
        ) : null}
      </p>
      <Button
        size="sm"
        onClick={() => {
          localStorage.setItem(KEY, "1");
          setVisible(false);
        }}
      >
        {t("cookie.accept")}
      </Button>
    </div>
  );
}
