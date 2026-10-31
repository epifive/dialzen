"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { initialFormState, type FormState } from "@/app/actions/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import {
  deleteLanguage,
  importTranslations,
  saveLanguage,
  saveTranslations,
  setDefaultLanguage,
} from "../actions/languages";

/** Popular languages, to fill the form in one click. */
const PRESETS: Array<[code: string, name: string, native: string, dir: "ltr" | "rtl"]> = [
  ["ar", "Arabic", "العربية", "rtl"],
  ["bn", "Bengali", "বাংলা", "ltr"],
  ["de", "German", "Deutsch", "ltr"],
  ["es", "Spanish", "Español", "ltr"],
  ["fa", "Persian", "فارسی", "rtl"],
  ["fr", "French", "Français", "ltr"],
  ["he", "Hebrew", "עברית", "rtl"],
  ["hi", "Hindi", "हिन्दी", "ltr"],
  ["id", "Indonesian", "Bahasa Indonesia", "ltr"],
  ["it", "Italian", "Italiano", "ltr"],
  ["ja", "Japanese", "日本語", "ltr"],
  ["ko", "Korean", "한국어", "ltr"],
  ["nl", "Dutch", "Nederlands", "ltr"],
  ["pl", "Polish", "Polski", "ltr"],
  ["pt-BR", "Portuguese (Brazil)", "Português (Brasil)", "ltr"],
  ["ru", "Russian", "Русский", "ltr"],
  ["th", "Thai", "ไทย", "ltr"],
  ["tr", "Turkish", "Türkçe", "ltr"],
  ["uk", "Ukrainian", "Українська", "ltr"],
  ["ur", "Urdu", "اردو", "rtl"],
  ["vi", "Vietnamese", "Tiếng Việt", "ltr"],
  ["zh-Hans", "Chinese (Simplified)", "简体中文", "ltr"],
];

/** Refresh server data after a successful save so counts and lists update. */
function useRefreshOnSuccess(state: FormState) {
  const router = useRouter();
  useEffect(() => {
    if (state.success) router.refresh();
  }, [state, router]);
}

export function AddLanguageForm({ existing }: { existing: string[] }) {
  const [state, action] = useActionState(saveLanguage, initialFormState);
  const [values, setValues] = useState({ code: "", name: "", native_name: "", direction: "ltr" });
  const presets = PRESETS.filter(([code]) => !existing.includes(code));
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Start from a common language" htmlFor="preset">
        <Select
          id="preset"
          defaultValue=""
          onChange={(e) => {
            const preset = PRESETS.find(([code]) => code === e.target.value);
            if (preset) setValues({ code: preset[0], name: preset[1], native_name: preset[2], direction: preset[3] });
          }}
        >
          <option value="">Choose…</option>
          {presets.map(([code, name, native]) => (
            <option key={code} value={code}>
              {name} – {native}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="code" hint="ISO code, e.g. fr, ar or pt-BR.">
          <Input
            id="code"
            name="code"
            required
            maxLength={12}
            value={values.code}
            onChange={(e) => setValues({ ...values, code: e.target.value })}
          />
        </Field>
        <Field label="Text direction" htmlFor="direction">
          <Select id="direction" name="direction" value={values.direction} onChange={(e) => setValues({ ...values, direction: e.target.value })}>
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left (Arabic, Hebrew, Persian, Urdu)</option>
          </Select>
        </Field>
        <Field label="Name in English" htmlFor="name">
          <Input id="name" name="name" required maxLength={60} value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </Field>
        <Field label="Native name" htmlFor="native_name" hint="Shown in the language switcher.">
          <Input
            id="native_name"
            name="native_name"
            required
            maxLength={60}
            value={values.native_name}
            onChange={(e) => setValues({ ...values, native_name: e.target.value })}
          />
        </Field>
      </div>
      <input type="hidden" name="sort_order" value="10" />
      <Switch name="is_active" label="Active" description="Inactive languages are hidden from visitors while you translate." />
      <div className="flex justify-end">
        <SubmitButton>Add language</SubmitButton>
      </div>
    </form>
  );
}

export function DefaultLanguageForm({ languages, current }: { languages: Array<{ code: string; name: string }>; current: string }) {
  const [state, action] = useActionState(setDefaultLanguage, initialFormState);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Default language" htmlFor="default_code" className="min-w-56 flex-1">
          <Select id="default_code" name="code" defaultValue={current}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <SubmitButton>Save</SubmitButton>
      </div>
    </form>
  );
}

export interface EditableLanguage {
  code: string;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  isActive: boolean;
  sortOrder: number;
}

export function LanguageSettingsForm({ language }: { language: EditableLanguage }) {
  const [state, action] = useActionState(saveLanguage, initialFormState);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="original_code" value={language.code} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name in English" htmlFor="name">
          <Input id="name" name="name" required maxLength={60} defaultValue={language.name} />
        </Field>
        <Field label="Native name" htmlFor="native_name">
          <Input id="native_name" name="native_name" required maxLength={60} defaultValue={language.nativeName} />
        </Field>
        <Field label="Text direction" htmlFor="direction">
          <Select id="direction" name="direction" defaultValue={language.direction}>
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left</option>
          </Select>
        </Field>
        <Field label="Order in the switcher" htmlFor="sort_order">
          <Input id="sort_order" name="sort_order" type="number" min={0} max={999} defaultValue={language.sortOrder} />
        </Field>
      </div>
      <Switch name="is_active" label="Active" description="Show this language in the switcher." defaultChecked={language.isActive} />
      <div className="flex justify-end">
        <SubmitButton>Save language</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteLanguageForm({ code, name }: { code: string; name: string }) {
  const [state, action] = useActionState(deleteLanguage, initialFormState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete ${name} and all of its translations?`)) e.preventDefault();
      }}
      className="space-y-3"
    >
      <FormMessage state={state} />
      <input type="hidden" name="code" value={code} />
      <Button type="submit" variant="danger" size="sm">
        Delete language
      </Button>
    </form>
  );
}

export function ImportForm({ lang }: { lang: string }) {
  const [state, action] = useActionState(importTranslations, initialFormState);
  useRefreshOnSuccess(state);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="lang" value={lang} />
      <input
        name="file"
        type="file"
        accept="application/json,.json"
        required
        aria-label="Translation file"
        className="block text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
      />
      <SubmitButton size="sm">Import</SubmitButton>
    </form>
  );
}

export interface TranslationRow {
  key: string;
  source: string;
  context?: string;
  multiline: boolean;
  value: string;
}

export function TranslationsForm({ lang, rtl, rows }: { lang: string; rtl: boolean; rows: TranslationRow[] }) {
  const [state, action] = useActionState(saveTranslations, initialFormState);
  useRefreshOnSuccess(state);
  return (
    <form action={action}>
      <input type="hidden" name="lang" value={lang} />
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const id = `t-${row.key}`;
          return (
            <li key={row.key} className="grid gap-2 px-5 py-4 lg:grid-cols-2 lg:gap-6">
              <input type="hidden" name="keys" value={row.key} />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {row.context ? <span className="font-medium text-ink">{row.context}</span> : null}
                  <code className="truncate font-mono text-[11px]">{row.key}</code>
                </p>
                <label htmlFor={id} className="mt-1 block text-sm whitespace-pre-line text-ink">
                  {row.source}
                </label>
              </div>
              {row.multiline ? (
                <Textarea
                  id={id}
                  name={`t:${row.key}`}
                  defaultValue={row.value}
                  rows={3}
                  dir={rtl ? "rtl" : "ltr"}
                  placeholder="Not translated – the English text is shown"
                  className={cn(!row.value && "border-dashed")}
                />
              ) : (
                <Input
                  id={id}
                  name={`t:${row.key}`}
                  defaultValue={row.value}
                  dir={rtl ? "rtl" : "ltr"}
                  placeholder="Not translated – the English text is shown"
                  className={cn("self-start", !row.value && "border-dashed")}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
        <FormMessage state={state} />
        <SubmitButton>Save translations</SubmitButton>
      </div>
    </form>
  );
}
