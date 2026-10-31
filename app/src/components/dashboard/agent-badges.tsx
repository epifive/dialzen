"use client";

import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { syncStatusTone } from "@/voice/format";
import type { SyncStatus } from "@/voice/types";

/** Provider sync state of an agent (the error is the tooltip). */
export function SyncBadge({ status, error, className }: { status: SyncStatus; error?: string | null; className?: string }) {
  const t = useT();
  const Icon = status === "synced" ? CircleCheck : status === "error" ? CircleAlert : RefreshCw;
  return (
    <span title={status === "error" && error ? error : undefined} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", syncStatusTone(status), className)}>
      <Icon className="size-3" aria-hidden />
      {t(`dash.agent.sync.${status}`)}
    </span>
  );
}
