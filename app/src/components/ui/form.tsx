"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "./alert";
import { Button } from "./button";
import type { FormState } from "@/app/actions/types";

/** Submit button that shows a pending state while its form's Server Action runs. */
export function SubmitButton({
  children,
  pendingText,
  className,
  variant = "primary",
  size = "md",
}: {
  children: ReactNode;
  pendingText?: string;
  className?: string;
  variant?: "primary" | "secondary" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant} size={size} aria-busy={pending}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

/** Shows a Server Action's error or success message. */
export function FormMessage({ state }: { state: FormState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.success) return <Alert tone="success">{state.success}</Alert>;
  return null;
}
