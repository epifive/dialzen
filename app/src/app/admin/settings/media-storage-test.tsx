"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { testStorageAction, type StorageTestResult } from "../actions/media";

/** "Test storage" under Admin → Settings → Media storage (uses the saved settings). */
export function MediaStorageTest() {
  const [result, setResult] = useState<StorageTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="mt-6 rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <h2 className="font-sans text-base font-semibold tracking-normal">Test storage</h2>
          <p className="mt-0.5 text-sm text-muted">Save your changes first. Uploads a tiny test image, reads it back, checks its public URL and deletes it.</p>
        </div>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await testStorageAction();
              if ("error" in r) {
                setError(r.error);
                setResult(null);
              } else {
                setError(null);
                setResult(r);
              }
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Run test
        </Button>
      </header>
      {error ? (
        <p role="alert" className="px-6 py-4 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {result ? (
        <ul className="divide-y divide-line">
          {result.steps.map((s) => (
            <li key={s.name} className="flex gap-3 px-6 py-3 text-sm">
              {s.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="OK" />
              ) : s.warning ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-label="Warning" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="Failed" />
              )}
              <div className="min-w-0">
                <p className="font-medium">{s.name}</p>
                <p className="text-xs break-all text-muted">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
