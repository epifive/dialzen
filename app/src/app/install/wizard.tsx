"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { CircleCheck, CircleX, Database, Globe, ShieldCheck } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { runInstall, testDatabase, type InstallResult } from "./actions";

export interface Requirement {
  label: string;
  ok: boolean;
  required: boolean;
}

const STEPS = ["Requirements", "Database", "Site & admin"] as const;

export function InstallWizard({ requirements, sqliteSupported }: { requirements: Requirement[]; sqliteSupported: boolean }) {
  const [step, setStep] = useState(0);
  const [driver, setDriver] = useState<"mysql" | "sqlite">("mysql");
  const [result, setResult] = useState<InstallResult | null>(null);
  const [dbOk, setDbOk] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [siteUrl, setSiteUrl] = useState("");
  useEffect(() => {
    // Suggest the address the installer is being viewed on.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSiteUrl((current) => current || window.location.origin);
  }, []);
  const requirementsMet = requirements.every((r) => r.ok || !r.required);

  function run(action: (fd: FormData) => Promise<InstallResult>, onOk?: () => void) {
    if (!formRef.current) return;
    if (!formRef.current.reportValidity()) return;
    const fd = new FormData(formRef.current);
    startTransition(async () => {
      const r = await action(fd);
      setResult(r);
      if (r.ok) onOk?.();
    });
  }

  if (done) {
    return (
      <Card>
        <div className="py-6 text-center">
          <CircleCheck className="mx-auto size-14 text-primary" aria-hidden />
          <h2 className="mt-5 text-2xl font-bold">Installation complete</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">
            Your site is ready. Sign in with the admin account you just created to configure payments, email and appearance.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link href="/admin" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white">
              Open the admin panel
            </Link>
            <Link href="/" className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium">
              View the site
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} noValidate={false}>
      <ol className="mb-6 flex gap-2" aria-label="Installation steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              i === step ? "border-primary bg-surface font-semibold" : i < step ? "border-line bg-surface text-muted" : "border-line text-muted",
            )}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                i <= step ? "bg-primary text-white" : "bg-line text-muted",
              )}
            >
              {i + 1}
            </span>
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ol>

      {/* Step 1: requirements */}
      <div hidden={step !== 0}>
        <Card title="Server requirements" icon={<ShieldCheck className="size-5" />}>
          <ul className="space-y-3">
            {requirements.map((r) => (
              <li key={r.label} className="flex items-center gap-3 text-sm">
                {r.ok ? (
                  <CircleCheck className="size-5 shrink-0 text-primary" aria-label="Passed" />
                ) : (
                  <CircleX className={cn("size-5 shrink-0", r.required ? "text-red-600" : "text-amber-500")} aria-label="Failed" />
                )}
                <span>
                  {r.label}
                  {!r.required ? <span className="text-muted"> (optional)</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {!requirementsMet ? (
            <Alert tone="error" className="mt-5">
              Fix the failed requirements and reload this page. See the documentation for help.
            </Alert>
          ) : null}
          <div className="mt-6 flex justify-end">
            <Button disabled={!requirementsMet} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </Card>
      </div>

      {/* Step 2: database */}
      <div hidden={step !== 1}>
        <Card title="Database" icon={<Database className="size-5" />}>
          <Segmented
            label="Database type"
            value={driver}
            onChange={(v) => {
              setDriver(v);
              setDbOk(false);
              setResult(null);
            }}
            options={[
              { value: "mysql", label: "MySQL / MariaDB" },
              { value: "sqlite", label: "SQLite (no server needed)" },
            ]}
          />
          <input type="hidden" name="driver" value={driver} />
          {driver === "mysql" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="Host" htmlFor="host">
                <Input id="host" name="host" defaultValue="127.0.0.1" required={step === 1} onChange={() => setDbOk(false)} />
              </Field>
              <Field label="Port" htmlFor="port">
                <Input id="port" name="port" type="number" defaultValue={3306} required={step === 1} onChange={() => setDbOk(false)} />
              </Field>
              <Field label="Database name" htmlFor="database" className="sm:col-span-2" hint="Create an empty database first (e.g. in cPanel → MySQL Databases).">
                <Input id="database" name="database" required={step === 1} onChange={() => setDbOk(false)} />
              </Field>
              <Field label="Username" htmlFor="user">
                <Input id="user" name="user" autoComplete="off" required={step === 1} onChange={() => setDbOk(false)} />
              </Field>
              <Field label="Password" htmlFor="db-password">
                <Input id="db-password" name="password" type="password" autoComplete="off" onChange={() => setDbOk(false)} />
              </Field>
              <Checkbox
                name="ssl"
                label="Use SSL (required by cloud databases such as TiDB Cloud, Aiven or DigitalOcean)"
                className="sm:col-span-2"
                onChange={() => setDbOk(false)}
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {!sqliteSupported ? (
                <Alert tone="warning">SQLite needs Node.js 22.13 or newer. Choose MySQL or upgrade Node.js.</Alert>
              ) : (
                <Alert tone="info">
                  SQLite stores everything in one file inside the storage folder. Ideal for small sites and testing. Use MySQL for
                  high-traffic sites.
                </Alert>
              )}
              <Field label="Database file name" htmlFor="file">
                <Input id="file" name="file" defaultValue="database.sqlite" required={step === 1} />
              </Field>
            </div>
          )}
          {result && step === 1 ? (
            <Alert tone={result.ok ? "success" : "error"} className="mt-5">
              {result.message}
            </Alert>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" disabled={pending} onClick={() => run(testDatabase, () => setDbOk(true))}>
                {pending ? "Testing…" : "Test connection"}
              </Button>
              <Button
                disabled={!dbOk || pending}
                onClick={() => {
                  setResult(null);
                  setStep(2);
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Step 3: site + admin */}
      <div hidden={step !== 2}>
        <Card title="Site and administrator" icon={<Globe className="size-5" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Site name" htmlFor="site_name">
              <Input id="site_name" name="site_name" defaultValue="Dialzen" required={step === 2} maxLength={80} />
            </Field>
            <Field label="Site URL" htmlFor="site_url" hint="Used in emails, sitemaps and payment redirects.">
              <Input
                id="site_url"
                name="site_url"
                type="url"
                required={step === 2}
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
              />
            </Field>
            <Field label="Admin name" htmlFor="admin_name">
              <Input id="admin_name" name="admin_name" required={step === 2} autoComplete="name" />
            </Field>
            <Field label="Admin email" htmlFor="admin_email">
              <Input id="admin_email" name="admin_email" type="email" required={step === 2} autoComplete="email" />
            </Field>
            <Field label="Admin password" htmlFor="admin_password" hint="At least 8 characters." className="sm:col-span-2">
              <Input id="admin_password" name="admin_password" type="password" minLength={8} required={step === 2} autoComplete="new-password" />
            </Field>
          </div>
          {result && step === 2 ? (
            <Alert tone={result.ok ? "success" : "error"} className="mt-5">
              {result.message}
            </Alert>
          ) : null}
          <div className="mt-6 flex justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button disabled={pending} onClick={() => run(runInstall, () => setDone(true))}>
              {pending ? "Installing…" : "Install now"}
            </Button>
          </div>
        </Card>
      </div>
    </form>
  );
}

function Card({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.18)] sm:p-8">
      {title ? (
        <h2 className="mb-5 flex items-center gap-2.5 text-lg font-bold">
          <span className="text-primary">{icon}</span>
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
