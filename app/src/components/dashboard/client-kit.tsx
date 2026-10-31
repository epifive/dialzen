"use client";

import { useActionState, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { initialFormState, type FormState } from "@/app/actions/types";
import { buttonClass } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type FormAction<S extends FormState = FormState> = (prev: S, formData: FormData) => Promise<S>;

/** useActionState that refreshes the page's server data after a successful action (no revalidatePath). */
export function useRefreshingAction<S extends FormState>(action: FormAction<S>, initial: S = initialFormState as S) {
  const router = useRouter();
  return useActionState<S, FormData>(async (prev: Awaited<S>, formData: FormData) => {
    const result = await action(prev as S, formData);
    if (!result.error) router.refresh();
    return result;
  }, initial as Awaited<S>);
}

/** Hidden inputs for ids that travel with a form (re-checked by the Server Action). */
export function HiddenFields({ fields }: { fields: Record<string, string | number> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={String(value)} />
      ))}
    </>
  );
}

/**
 * A small form in a dropdown panel (rename, add a tag, confirm with a note…).
 * Closes itself after a successful submit; errors stay visible inside the panel.
 */
export function PopoverForm({
  action,
  fields,
  trigger,
  title,
  children,
  submitLabel,
  submitVariant = "primary",
  triggerVariant = "outline",
  align = "end",
  className,
}: {
  action: FormAction;
  fields: Record<string, string | number>;
  trigger: ReactNode;
  title?: string;
  children?: ReactNode;
  submitLabel: string;
  submitVariant?: "primary" | "danger";
  triggerVariant?: "outline" | "ghost" | "primary" | "secondary";
  align?: "start" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useRefreshingAction(async (prev: FormState, fd: FormData) => {
    const result = await action(prev, fd);
    if (!result.error && ref.current) ref.current.open = false;
    return result;
  });
  // The panel is position: fixed so a short table card (overflow-x-auto clips) can't cut it
  // off. It opens below the trigger, or above it when there's more room there.
  const place = useCallback(() => {
    const el = ref.current;
    const panel = panelRef.current;
    const summary = el?.querySelector("summary");
    if (!el || !panel || !summary) return;
    // Hidden until placed, so it never flashes in the corner for a frame.
    if (!el.open) {
      panel.style.visibility = "hidden";
      return;
    }
    const r = summary.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const rtl = getComputedStyle(el).direction === "rtl";
    const toRight = (align === "end") !== rtl;
    const left = Math.max(8, Math.min(toRight ? r.right - w : r.left, vw - w - 8));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const top = h <= below || below >= above ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.visibility = "visible";
  }, [align]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && el.open) {
        el.open = false;
        el.querySelector("summary")?.focus();
      }
    };
    const onMove = () => place();
    el.addEventListener("toggle", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Capture: also follows the table's own horizontal scroll container.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      el.removeEventListener("toggle", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [place]);
  // Error messages change the panel's height.
  useEffect(() => place(), [state, place]);
  return (
    <details ref={ref} className={cn("group relative inline-block text-start", className)}>
      <summary className={cn(buttonClass(triggerVariant, "sm"), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
        {trigger}
        <ChevronDown className="transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div ref={panelRef} style={{ visibility: "hidden" }} className="fixed top-0 left-0 z-50 hidden w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-line bg-surface p-4 whitespace-normal shadow-xl group-open:block">
        <form action={formAction} className="space-y-3">
          <HiddenFields fields={fields} />
          {title ? <p className="text-sm font-medium">{title}</p> : null}
          {children}
          {state.error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {state.error}
            </p>
          ) : null}
          <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(submitVariant, "sm", "w-full")}>
            {submitLabel}
          </button>
        </form>
      </div>
    </details>
  );
}

/** "Select all" checkbox for row checkboxes that belong to another form (form="…" attribute). */
export function SelectAll({ form, label }: { form: string; label: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <input
      type="checkbox"
      aria-label={label}
      title={label}
      checked={checked}
      onChange={(e) => {
        setChecked(e.target.checked);
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"]`).forEach((box) => {
          if (!box.disabled) box.checked = e.target.checked;
        });
      }}
      className="size-4 rounded border-line accent-[var(--primary)]"
    />
  );
}

/**
 * Buttons for bulk actions on rows selected with checkboxes (form="<id>"). Shows the
 * action's result and refreshes the page on success.
 */
export function BulkForm({
  id,
  action,
  fields,
  children,
  className,
}: {
  id: string;
  action: FormAction;
  fields: Record<string, string | number>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useRefreshingAction(action);
  return (
    <form id={id} action={formAction} className={cn("flex flex-wrap items-center gap-2", className)}>
      <HiddenFields fields={fields} />
      {children}
      {state.error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : state.success ? (
        <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
          {state.success}
        </span>
      ) : null}
    </form>
  );
}

/** Wraps the translator for client components that only need one or two strings. */
export function T({ k }: { k: Parameters<ReturnType<typeof useT>>[0] }) {
  const t = useT();
  return <>{t(k)}</>;
}
