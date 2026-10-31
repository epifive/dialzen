import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <div className="mat-grid mat-grid-fade absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-md px-4 py-16 sm:py-24">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.18)] sm:p-8">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <p className="mt-6 text-center text-sm text-muted">{footer}</p> : null}
      </div>
    </div>
  );
}
