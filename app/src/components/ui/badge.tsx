import type { ComponentProps } from "react";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const tones: Record<Tone, string> = {
  neutral: "bg-line/70 text-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}
      {...props}
    />
  );
}

/** Highlighter-yellow marker used everywhere a tool or feature needs a paid plan. */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-marker px-1.5 py-0.5 text-[11px] font-semibold text-[#3d2e00] [&_svg]:size-3",
        className,
      )}
    >
      <Crown aria-hidden />
      Pro
    </span>
  );
}
