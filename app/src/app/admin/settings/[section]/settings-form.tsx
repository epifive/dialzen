"use client";

import { useActionState, useState } from "react";
import { initialFormState } from "@/app/actions/types";
import { Checkbox, Field, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { saveSettings } from "../../actions/settings";
import type { SettingField, SettingSection } from "../sections";

type Values = Record<string, string | number | boolean>;

export function SettingsForm({ section, values, secretsSet }: { section: SettingSection; values: Values; secretsSet: Record<string, boolean> }) {
  const [state, action] = useActionState(saveSettings, initialFormState);

  // Keep the original order but render a heading whenever the group changes.
  const groups: Array<{ name?: string; fields: SettingField[] }> = [];
  for (const field of section.fields) {
    const last = groups[groups.length - 1];
    if (last && last.name === field.group) last.fields.push(field);
    else groups.push({ name: field.group, fields: [field] });
  }

  return (
    <form action={action} className="rounded-xl border border-line bg-surface">
      <input type="hidden" name="section" value={section.slug} />
      <header className="border-b border-line px-6 py-4">
        <h2 className="font-sans text-base font-semibold tracking-normal">{section.title}</h2>
        <p className="mt-0.5 text-sm text-muted">{section.description}</p>
      </header>
      <div className="space-y-8 px-6 py-6">
        <FormMessage state={state} />
        {groups.map((group, i) => (
          <fieldset key={`${group.name ?? "main"}-${i}`} className="space-y-5">
            {group.name ? (
              <legend className="mb-4 w-full border-b border-line pb-2 text-sm font-semibold text-ink">{group.name}</legend>
            ) : null}
            {group.fields.map((field) => (
              <SettingInput key={field.key} field={field} value={values[field.key]} secretSet={secretsSet[field.key]} />
            ))}
          </fieldset>
        ))}
      </div>
      <footer className="flex justify-end border-t border-line px-6 py-4">
        <SubmitButton>Save changes</SubmitButton>
      </footer>
    </form>
  );
}

function SettingInput({ field, value, secretSet }: { field: SettingField; value: string | number | boolean; secretSet?: boolean }) {
  const id = `setting-${field.key}`;
  switch (field.type) {
    case "switch":
      return <Switch name={field.key} label={field.label} description={field.hint} defaultChecked={Boolean(value)} />;
    case "textarea":
      return (
        <Field label={field.label} htmlFor={id} hint={field.hint}>
          <Textarea id={id} name={field.key} defaultValue={String(value ?? "")} rows={4} placeholder={field.placeholder} />
        </Field>
      );
    case "code":
      return (
        <Field label={field.label} htmlFor={id} hint={field.hint}>
          <Textarea id={id} name={field.key} defaultValue={String(value ?? "")} rows={5} spellCheck={false} className="font-mono text-[13px]" placeholder={field.placeholder} />
        </Field>
      );
    case "select":
      return (
        <Field label={field.label} htmlFor={id} hint={field.hint}>
          <Select id={id} name={field.key} defaultValue={String(value)}>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "color":
      return <ColorInput id={id} field={field} value={String(value)} />;
    case "image":
      return <ImageInput id={id} field={field} value={String(value ?? "")} />;
    case "password":
      return (
        <Field label={field.label} htmlFor={id} hint={[secretSet ? "A value is saved. Leave empty to keep it." : null, field.hint].filter(Boolean).join(" ")}>
          <Input id={id} name={field.key} type="password" autoComplete="new-password" placeholder={secretSet ? "••••••••••" : field.placeholder} />
        </Field>
      );
    default:
      return (
        <Field label={field.label} htmlFor={id} hint={field.hint}>
          <Input
            id={id}
            name={field.key}
            type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
            step={field.type === "number" ? (field.step ?? "1") : undefined}
            defaultValue={String(value ?? "")}
            placeholder={field.placeholder}
          />
        </Field>
      );
  }
}

function ColorInput({ id, field, value }: { id: string; field: SettingField; value: string }) {
  const [color, setColor] = useState(value);
  return (
    <Field label={field.label} htmlFor={id} hint={field.hint}>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#a21caf"}
          onChange={(e) => setColor(e.target.value)}
          aria-label={`${field.label} picker`}
          className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1"
        />
        <Input id={id} name={field.key} value={color} onChange={(e) => setColor(e.target.value)} className="max-w-36 font-mono" maxLength={7} />
        <span className="h-10 flex-1 rounded-lg" style={{ background: color }} aria-hidden />
      </div>
    </Field>
  );
}

function ImageInput({ id, field, value }: { id: string; field: SettingField; value: string }) {
  return (
    <Field label={field.label} htmlFor={id} hint={field.hint}>
      <div className="flex flex-wrap items-center gap-4">
        {value ? (
          <span className="mat-grid grid h-14 min-w-14 place-items-center rounded-lg border border-line px-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file */}
            <img src={value} alt="" className="max-h-10 max-w-40" />
          </span>
        ) : null}
        <input
          id={id}
          name={field.key}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
        />
        {value ? <Checkbox name={`${field.key}__remove`} label="Remove" /> : null}
      </div>
      <Input
        name={`${field.key}__url`}
        type="url"
        placeholder="…or paste an image URL (https://)"
        aria-label={`${field.label} image URL`}
        className="mt-2"
      />
    </Field>
  );
}
