"use server";

import { guardAdmin, saveUpload } from "@/lib/admin";
import { SETTING_DEFAULTS, updateSettings, type Settings } from "@/lib/settings";
import type { FormState } from "@/app/actions/types";
import { getSection } from "../settings/sections";

/** Save one settings section. Only the keys declared for that section are accepted. */
export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  // Ids travel as form fields rather than bound arguments: binding arguments to an action used with
  // useActionState makes React spin forever when the form is submitted before hydration.
  const sectionSlug = String(formData.get("section") ?? "");
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const section = getSection(sectionSlug);
  if (!section) return { error: "Unknown settings section." };

  const values: Partial<Record<keyof Settings, unknown>> = {};
  try {
    for (const field of section.fields) {
      const defaultValue = SETTING_DEFAULTS[field.key];
      if (field.type === "switch") {
        values[field.key] = formData.get(field.key) === "on";
      } else if (field.type === "image") {
        const file = formData.get(field.key);
        const url = String(formData.get(`${field.key}__url`) ?? "").trim();
        if (formData.get(`${field.key}__remove`) === "on") values[field.key] = "";
        else if (file instanceof File && file.size > 0) values[field.key] = await saveUpload(file, field.key.replace(/_/g, "-"));
        else if (url) {
          if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return { error: `${field.label} URL must start with https://` };
          values[field.key] = url;
        }
      } else if (field.type === "password") {
        // Empty password fields keep the stored secret.
        const v = String(formData.get(field.key) ?? "");
        if (v) values[field.key] = v.trim();
      } else if (typeof defaultValue === "number") {
        const n = Number(formData.get(field.key));
        if (!Number.isFinite(n)) return { error: `${field.label} must be a number.` };
        values[field.key] = n;
      } else {
        let v = String(formData.get(field.key) ?? "");
        if (field.type !== "code" && field.type !== "textarea") v = v.trim();
        if (field.type === "url" && v) {
          if (!/^https?:\/\/[^\s]+$/i.test(v)) return { error: `${field.label} must start with http:// or https://` };
          v = v.replace(/\/+$/, "");
        }
        if (field.type === "color" && !/^#[0-9a-f]{6}$/i.test(v)) return { error: `${field.label} must be a hex colour like #a21caf.` };
        if (field.pattern && v && !new RegExp(field.pattern).test(v)) return { error: field.patternError ?? `${field.label} is not valid.` };
        if (field.type === "select" && field.options && !field.options.some((o) => o.value === v)) {
          return { error: `Choose a valid option for ${field.label}.` };
        }
        values[field.key] = v;
      }
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save the settings." };
  }

  await updateSettings(values as Partial<Settings>);
  return { success: `${section.title} settings saved.` };
}
