"use client";

import { Fragment, useActionState, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { initialFormState } from "@/app/actions/types";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { regenerateCronKey, runChecksNow } from "../actions/scheduler";

export function RunChecksForm() {
  const [state, action] = useActionState(runChecksNow, initialFormState);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton size="sm" pendingText="Running jobs…">
        Run jobs now
      </SubmitButton>
    </form>
  );
}

export function RegenerateKeyForm() {
  const [state, action] = useActionState(regenerateCronKey, initialFormState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Create a new secret? The current cron URL and worker secret stop working.")) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormMessage state={state} />
      <SubmitButton variant="outline" size="sm" pendingText="Creating…">
        New secret
      </SubmitButton>
    </form>
  );
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
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

/**
 * Read-only value with a copy button (admin pages have no i18n provider). `wrap` shows the whole
 * value on several lines (long URLs in narrow cards) instead of a one-line input.
 */
export function CopyValue({ value, label, wrap = false }: { value: string; label: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={wrap ? "flex flex-col items-start gap-2" : "flex flex-col gap-2 sm:flex-row"}>
      {wrap ? (
        <code dir="ltr" className="block w-full rounded-lg border border-line bg-paper px-3 py-2 text-start font-mono text-xs leading-relaxed [overflow-wrap:anywhere] text-ink select-all">
          {/* Line breaks after slashes, so URLs wrap at their path segments. */}
          {value.split(/(?<=[^/]\/)(?!\/)/).map((part, i) => (
            <Fragment key={i}>
              {i ? <wbr /> : null}
              {part}
            </Fragment>
          ))}
        </code>
      ) : (
        <input
          readOnly
          aria-label={label}
          value={value}
          dir="ltr"
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 font-mono text-xs text-ink focus:border-primary focus:outline-none"
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          if (await writeClipboard(value)) {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1800);
          }
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
}
