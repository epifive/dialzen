"use client";

import { startTransition, useActionState, useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, FileUp, TriangleAlert } from "lucide-react";
import { previewImportAction, runImportAction, type ImportState } from "@/app/actions/dashboard/contacts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { parseCsv } from "@/lib/csv";
import { useT } from "@/lib/i18n/client";
import { plural, type MessageKey } from "@/lib/i18n/messages";
import { IMPORT_FIELDS, suggestMapping, type ImportMapping } from "@/lib/import-fields";
import { cn } from "@/lib/utils";
import { CONSENT_SOURCES } from "@/voice/types";

const MAX_BYTES = 4 * 1024 * 1024;

interface Loaded {
  name: string;
  text: string;
  headers: string[];
  samples: string[][];
  rows: number;
}

/**
 * The CSV import wizard: pick a file → map its columns (phone, name, consent…) → check it (dry
 * run with a validation report) → import. The file is read in the browser; only its text goes
 * to the server.
 */
export function ContactImportWizard({ workspaceId, defaultCountry, countries, lists, contactsHref }: { workspaceId: number; defaultCountry: string; countries: Array<{ iso: string; name: string }>; lists: Array<{ id: number; name: string }>; contactsHref: string }) {
  const t = useT();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [file, setFile] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>([]);
  const [readError, setReadError] = useState("");
  const [preview, previewAction, checking] = useActionState<ImportState, FormData>(previewImportAction, {});
  const [done, importAction, importing] = useActionState<ImportState, FormData>(runImportAction, {});
  const [checkedFor, setCheckedFor] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const run = (action: (fd: FormData) => void) => {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    startTransition(() => action(fd));
  };

  const load = (f: File | undefined) => {
    setReadError("");
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setReadError(t("dash.import.err.size"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseCsv(text, 10_000);
      if (!parsed.headers.length) {
        setReadError(t("dash.import.err.empty"));
        return;
      }
      setFile({ name: f.name, text, headers: parsed.headers, samples: parsed.rows.slice(0, 3), rows: parsed.rows.length });
      setMapping(suggestMapping(parsed.headers));
      setCheckedFor("");
    };
    reader.onerror = () => setReadError(t("dash.import.err.read"));
    reader.readAsText(f);
  };

  const signature = file ? `${file.name}:${file.text.length}:${mapping.join(",")}` : "";
  const report = done.report ?? preview.report;
  const hasConsentType = mapping.includes("consent_type");
  const hasConsentText = mapping.includes("consent_text");
  const phoneMapped = mapping.includes("phone");

  if (done.result) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title={t("dash.import.doneTitle")}>
          {done.success}
        </Alert>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          <Stat label={t("dash.import.created")} value={done.result.created} />
          <Stat label={t("dash.import.updated")} value={done.result.updated} />
          <Stat label={t("dash.import.consents")} value={done.result.consents} />
          <Stat label={t("dash.import.addedToList")} value={done.result.addedToList} />
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link href={contactsHref} className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong">
            {t("dash.import.viewContacts")}
          </Link>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("dash.import.another")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    // Submitted by hand (not as a form action): React resets a form after its action runs, which
    // would blank the column mapping selects.
    <form ref={formRef} className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <input type="hidden" name="wid" value={workspaceId} />
      <input type="hidden" name="csv" value={file?.text ?? ""} />
      <input type="hidden" name="filename" value={file?.name ?? ""} />
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StepNo n={1} />
          {t("dash.import.step1")}
        </h2>
        <label htmlFor={id("file")} className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-paper px-4 py-8 text-center hover:border-primary-line">
          <FileUp className="size-7 text-primary" aria-hidden />
          <span className="text-sm font-medium">{file ? file.name : t("dash.import.choose")}</span>
          <span className="text-xs text-muted">{file ? t("dash.import.rowsFound", { n: file.rows }) : t("dash.import.chooseHint")}</span>
          <input id={id("file")} type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => load(e.target.files?.[0])} />
        </label>
        {readError ? <Alert tone="error">{readError}</Alert> : null}
      </section>

      {file ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <StepNo n={2} />
            {t("dash.import.step2")}
          </h2>
          <p className="text-xs text-muted">{t("dash.import.mapHint")}</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-paper text-xs text-muted">
                  <th className="px-4 py-2 text-start font-medium">{t("dash.import.column")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("dash.import.sample")}</th>
                  <th className="px-4 py-2 text-start font-medium">{t("dash.import.mapsTo")}</th>
                </tr>
              </thead>
              <tbody>
                {file.headers.map((h, i) => (
                  <tr key={`${h}-${i}`} className="border-t border-line">
                    <td className="px-4 py-2 font-medium" dir="auto">
                      {h}
                    </td>
                    <td className="max-w-56 truncate px-4 py-2 text-muted" dir="auto" title={file.samples.map((r) => r[i]).join(" · ")}>
                      {file.samples.map((r) => r[i]).filter(Boolean).slice(0, 2).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Select
                        aria-label={t("dash.import.mapsToOf", { column: h })}
                        value={mapping[i] ?? ""}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? (e.target.value as ImportMapping[number]) : v === e.target.value && e.target.value !== "custom" ? "" : v)))}
                        className="h-9 min-w-44"
                      >
                        <option value="">{t("dash.import.field.ignore")}</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f} value={f}>
                            {t(`dash.import.field.${f}` as MessageKey)}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!phoneMapped ? <Alert tone="warning">{t("dash.import.err.phone")}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("dash.import.country")} htmlFor={id("country")} hint={t("dash.import.countryHint")}>
              <Select id={id("country")} name="country" defaultValue={defaultCountry}>
                {countries.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dash.import.tags")} htmlFor={id("tags")} hint={t("dash.contacts.tagsHint")}>
              <Input id={id("tags")} name="tags" autoComplete="off" />
            </Field>
            <Field label={t("dash.import.list")} htmlFor={id("list")}>
              <Select id={id("list")} name="list_id" defaultValue="">
                <option value="">{t("dash.contacts.noList")}</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("dash.import.newList")} htmlFor={id("newlist")} hint={t("dash.import.newListHint")}>
              <Input id={id("newlist")} name="new_list" maxLength={120} autoComplete="off" />
            </Field>
            {hasConsentType ? (
              <Field label={t("dash.import.consentSource")} htmlFor={id("csrc")} hint={t("dash.import.consentSourceHint")}>
                <Select id={id("csrc")} name="consent_source" defaultValue="web_form">
                  {CONSENT_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`dash.consent.source.${s}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </div>
          {hasConsentType && !hasConsentText ? (
            <Field label={t("dash.import.consentText")} htmlFor={id("ctext")} hint={t("dash.import.consentTextHint")}>
              <Textarea id={id("ctext")} name="consent_text_default" className="min-h-20" maxLength={5000} />
            </Field>
          ) : null}
          {!hasConsentType ? <Alert tone="info">{t("dash.import.noConsent")}</Alert> : null}
          <Checkbox name="skip_dnc" defaultChecked label={t("dash.import.skipDnc")} />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={report && checkedFor === signature ? "outline" : "primary"}
              disabled={!phoneMapped || checking}
              aria-busy={checking}
              onClick={() => {
                setCheckedFor(signature);
                run(previewAction);
              }}
            >
              {checking ? t("dash.import.checking") : t("dash.import.check")}
            </Button>
            {report && checkedFor === signature ? (
              <Button disabled={!report.valid || importing} aria-busy={importing} onClick={() => run(importAction)}>
                {importing ? t("dash.import.importing") : t("dash.import.run", { n: report.valid })}
              </Button>
            ) : null}
          </div>
          {preview.error ? <Alert tone="error">{preview.error}</Alert> : null}
          {done.error ? <Alert tone="error">{done.error}</Alert> : null}
        </section>
      ) : null}

      {file && report && checkedFor === signature ? <ImportReportView report={report} /> : null}
    </form>
  );
}

function StepNo({ n }: { n: number }) {
  return <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{n}</span>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("mt-0.5 font-display text-xl font-bold tabular-nums", tone === "bad" && value ? "text-red-600 dark:text-red-400" : tone === "warn" && value ? "text-amber-600 dark:text-amber-400" : tone === "good" ? "text-emerald-600 dark:text-emerald-400" : "")}>
        <bdi>{value.toLocaleString()}</bdi>
      </dd>
    </div>
  );
}

/** The dry-run report: totals, problems by line, and the first rows as they will be imported. */
export function ImportReportView({ report }: { report: NonNullable<ImportState["report"]> }) {
  const t = useT();
  return (
    <section className="space-y-4" aria-live="polite">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <StepNo n={3} />
        {t("dash.import.step3")}
      </h2>
      {report.truncated ? <Alert tone="warning">{t("dash.import.truncated")}</Alert> : null}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        <Stat label={t("dash.import.rows")} value={report.rows} />
        <Stat label={t("dash.import.willCreate")} value={report.created} tone="good" />
        <Stat label={t("dash.import.willUpdate")} value={report.updated} />
        <Stat label={t("dash.import.withConsent")} value={report.withConsent} />
        <Stat label={t("dash.import.invalid")} value={report.invalid} tone="bad" />
        <Stat label={t("dash.import.duplicates")} value={report.duplicates} tone="warn" />
        <Stat label={t("dash.import.dncWorkspace")} value={report.dncWorkspace} tone="warn" />
        <Stat label={t("dash.import.dncGlobal")} value={report.dncGlobal} tone="warn" />
        <Stat label={t("dash.import.optedOut")} value={report.optedOut} tone="warn" />
        <Stat label={t("dash.import.consentProblems")} value={report.consentProblems} tone="warn" />
      </dl>
      {report.skipped ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <TriangleAlert className="size-4 text-amber-500" aria-hidden />
          {plural(t, "dash.import.skippedDnc", report.skipped)}
        </p>
      ) : report.valid ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CircleCheck className="size-4 text-emerald-500" aria-hidden />
          {plural(t, "dash.import.ready", report.valid)}
        </p>
      ) : null}

      {report.issues.length ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[480px] text-sm">
            <caption className="bg-paper px-4 py-2 text-start text-xs font-medium text-muted">{t("dash.import.issues")}</caption>
            <thead>
              <tr className="border-t border-line text-xs text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("dash.import.line")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("dash.import.value")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("dash.import.problem")}</th>
              </tr>
            </thead>
            <tbody>
              {report.issues.slice(0, 50).map((i, n) => (
                <tr key={`${i.line}-${n}`} className="border-t border-line">
                  <td className="px-4 py-2 tabular-nums">{i.line}</td>
                  <td className="max-w-56 truncate px-4 py-2 font-mono text-[12px]" dir="ltr">
                    {i.value || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted">{t(`dash.import.problem.${i.problem}` as MessageKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.issues.length > 50 ? <p className="border-t border-line px-4 py-2 text-xs text-muted">{t("dash.import.moreIssues", { n: report.issues.length - 50 })}</p> : null}
        </div>
      ) : null}

      {report.preview.length ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-paper px-4 py-2 text-start text-xs font-medium text-muted">{t("dash.import.previewTitle")}</caption>
            <thead>
              <tr className="border-t border-line text-xs text-muted">
                <th className="px-4 py-2 text-start font-medium">{t("dash.import.line")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("dash.contacts.phone")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("dash.contacts.name")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("dash.consent.title")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("dash.import.status")}</th>
              </tr>
            </thead>
            <tbody>
              {report.preview.map((p) => (
                <tr key={p.line} className="border-t border-line">
                  <td className="px-4 py-2 tabular-nums">{p.line}</td>
                  <td className="px-4 py-2 font-mono text-[12px]" dir="ltr">
                    {p.phone}
                  </td>
                  <td className="px-4 py-2" dir="auto">
                    {[p.firstName, p.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted">{p.consent ? t(`dash.consent.type.${p.consent}` as MessageKey) : t("dash.consent.none")}</td>
                  <td className="px-4 py-2 text-muted">{t(`dash.import.status.${p.status}` as MessageKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
