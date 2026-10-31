"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { initialFormState, type FormState } from "@/app/actions/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DashAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * A one-button form for row actions (pause, resolve, delete…). Ids travel as
 * hidden inputs and are re-checked by the Server Action. Refreshes on success.
 */
export function ActionButton({
  action,
  fields,
  children,
  confirmText,
  variant = "outline",
  size = "sm",
  label,
  className,
  buttonClassName,
  showSuccess = false,
}: {
  action: DashAction;
  fields: Record<string, string | number>;
  children: ReactNode;
  confirmText?: string;
  variant?: "outline" | "ghost" | "danger" | "secondary" | "primary";
  size?: "sm" | "md";
  /** Accessible name when the button only shows an icon. */
  label?: string;
  className?: string;
  buttonClassName?: string;
  /** Show the success message next to the button (e.g. "Test alert sent"). */
  showSuccess?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    const result = await action(prev, formData);
    if (!result.error) router.refresh();
    return result;
  }, initialFormState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className={cn("inline-flex flex-col items-start", className)}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={String(value)} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={pending} aria-busy={pending} aria-label={label} title={label} className={buttonClassName}>
        {children}
      </Button>
      {state.error ? (
        <span role="alert" className="mt-1 max-w-64 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
      <span className={showSuccess && state.success ? "mt-1 max-w-64 text-xs text-emerald-700 dark:text-emerald-400" : "sr-only"} role="status">
        {state.success ?? ""}
      </span>
    </form>
  );
}

/** Reloads server data once (e.g. after a redirect from a Server Action) and drops the query flag. */
export function RefreshOnce({ cleanUrl }: { cleanUrl: string }) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.replace(cleanUrl, { scroll: false });
    router.refresh();
  }, [router, cleanUrl]);
  return null;
}
