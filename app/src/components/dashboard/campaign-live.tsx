"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";

/**
 * Refreshes the page's server data every few seconds while a campaign is running (the live
 * view), paused while the tab is hidden. Shows a small "live" indicator.
 */
export function LiveRefresh({ enabled, intervalMs = 5000 }: { enabled: boolean; intervalMs?: number }) {
  const router = useRouter();
  const t = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setTick((n) => n + 1);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, router]);
  if (!enabled) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400" data-tick={tick}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      {t("dash.campaigns.live")}
    </span>
  );
}
