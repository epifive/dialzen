"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { THEME_STORAGE_KEY as STORAGE_KEY, type ThemeChoice } from "./theme-init";

// The saved theme is applied before first paint by the root layout (see ./theme-init.ts).
export type { ThemeChoice } from "./theme-init";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

const ORDER: ThemeChoice[] = ["light", "dark", "system"];
const LABELS: Record<ThemeChoice, MessageKey> = { light: "theme.light", dark: "theme.dark", system: "theme.system" };

export function ThemeToggle({ defaultTheme }: { defaultTheme: ThemeChoice }) {
  const t = useT();
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    // Read the saved preference once mounted (localStorage is unavailable during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice((localStorage.getItem(STORAGE_KEY) as ThemeChoice | null) ?? defaultTheme);
  }, [defaultTheme]);

  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const current = choice ?? defaultTheme;
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <button
      type="button"
      onClick={() => {
        localStorage.setItem(STORAGE_KEY, next);
        apply(next);
        setChoice(next);
      }}
      className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-primary-soft hover:text-ink"
      aria-label={`${t(LABELS[current])}. ${t("theme.switchTo", { theme: t(LABELS[next]).toLowerCase() })}`}
      title={t(LABELS[current])}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}
