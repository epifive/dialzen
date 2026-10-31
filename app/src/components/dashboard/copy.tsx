"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Plain-HTTP origins have no Clipboard API: fall back to a hidden textarea.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label,
  className,
  variant = "outline",
  size = "sm",
}: {
  text: string;
  label?: string;
  className?: string;
  variant?: "outline" | "secondary" | "primary" | "ghost";
  size?: "sm" | "md";
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        if (await writeClipboard(text)) {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1800);
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? t("ui.copied") : (label ?? t("ui.copy"))}</span>
    </Button>
  );
}

/** Read-only value (URL, key, snippet) with a copy button. */
export function CopyField({ value, label, multiline = false, className }: { value: string; label: string; multiline?: boolean; className?: string }) {
  if (multiline) {
    return (
      <div className={cn("relative", className)}>
        <textarea
          readOnly
          aria-label={label}
          value={value}
          dir="ltr"
          rows={Math.min(10, Math.max(2, value.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 40)), 0)))}
          onFocus={(e) => e.currentTarget.select()}
          className="block w-full resize-none rounded-lg border border-line bg-paper px-3 pt-12 pb-3 font-mono text-[13px] leading-relaxed text-ink focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
        <CopyButton text={value} className="absolute end-2 top-2" />
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-start", className)}>
      <input
        readOnly
        aria-label={label}
        value={value}
        dir="ltr"
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 w-full min-w-0 sm:flex-1 rounded-lg border border-line bg-paper px-3 font-mono text-[13px] text-ink focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
      />
      <CopyButton text={value} size="md" className="shrink-0" />
    </div>
  );
}
