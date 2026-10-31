"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLanguage } from "@/app/actions/language";
import { useT } from "@/lib/i18n/client";

export function LanguageSwitcher({ current, languages }: { current: string; languages: Array<{ code: string; name: string }> }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="relative flex h-9 items-center rounded-lg text-muted transition-colors hover:bg-primary-soft hover:text-ink">
      <Languages className="pointer-events-none absolute start-2 size-[18px] max-sm:start-[9px]" aria-hidden />
      <span className="sr-only">{t("nav.language")}</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const code = e.target.value;
          start(async () => {
            await setLanguage(code);
            router.refresh();
          });
        }}
        // On phones only the globe icon shows; the (transparent) select still covers it.
        className="h-9 cursor-pointer appearance-none bg-transparent ps-8 pe-2 text-sm font-medium focus:outline-none max-sm:w-9 max-sm:p-0 max-sm:text-transparent"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} className="text-ink">
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
