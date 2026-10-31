"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { getTranslationEntries, LANGUAGE_CODE_PATTERN } from "@/lib/i18n/catalog";
import { clearI18nCache } from "@/lib/i18n/server";
import { getSettings, updateSettings } from "@/lib/settings";
import { countNoun } from "@/lib/utils";
import type { FormState } from "@/app/actions/types";

const languageSchema = z.object({
  code: z.string().trim().regex(LANGUAGE_CODE_PATTERN, "Use a language code such as fr, de, ar or pt-BR."),
  name: z.string().trim().min(2, "Enter the language name in English.").max(60),
  native_name: z.string().trim().min(1, "Enter the language name as its speakers write it.").max(60),
  direction: z.enum(["ltr", "rtl"]),
  sort_order: z.coerce.number().int().min(0).max(999),
});

/** Add a language, or update one when original_code is set (the code itself cannot change). */
export async function saveLanguage(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const original = String(formData.get("original_code") ?? "");
  const parsed = languageSchema.safeParse({
    code: original || formData.get("code"),
    name: formData.get("name"),
    native_name: formData.get("native_name"),
    direction: formData.get("direction"),
    sort_order: formData.get("sort_order") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;
  const isActive = formData.get("is_active") === "on" ? 1 : 0;

  const db = await getDb();
  const existing = await db.selectFrom("languages").select("code").where("code", "=", data.code).executeTakeFirst();
  if (original) {
    if (!existing) return { error: "This language no longer exists." };
    const settings = await getSettings();
    if (!isActive && settings.default_language === data.code) {
      return { error: "The default language must stay active. Choose another default first." };
    }
    await db
      .updateTable("languages")
      .set({ name: data.name, native_name: data.native_name, direction: data.direction, sort_order: data.sort_order, is_active: isActive })
      .where("code", "=", data.code)
      .execute();
    clearI18nCache();
    return { success: "Language saved." };
  }
  if (existing) return { error: `A language with the code “${data.code}” already exists.` };
  await db.insertInto("languages").values({ ...data, is_active: isActive }).execute();
  clearI18nCache();
  redirect(`/admin/languages/${data.code}?created=1`);
}

export async function deleteLanguage(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const code = String(formData.get("code") ?? "");
  if (code === "en") return { error: "English is the built-in source language and can't be deleted. You can deactivate it instead." };
  const settings = await getSettings();
  if (settings.default_language === code) return { error: "Choose another default language before deleting this one." };
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("translations").where("lang", "=", code).execute();
    await trx.deleteFrom("languages").where("code", "=", code).execute();
  });
  clearI18nCache();
  redirect("/admin/languages?deleted=1");
}

export async function setDefaultLanguage(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const code = String(formData.get("code") ?? "");
  const db = await getDb();
  const language = await db.selectFrom("languages").select(["code", "is_active"]).where("code", "=", code).executeTakeFirst();
  if (!language) return { error: "Choose a language." };
  if (!language.is_active) return { error: "Activate the language before making it the default." };
  await updateSettings({ default_language: code });
  clearI18nCache();
  return { success: "Default language saved. Visitors who haven't picked a language now see it." };
}

/** Replace the translations of the keys shown on one page of the editor. */
export async function saveTranslations(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const lang = String(formData.get("lang") ?? "");
  const db = await getDb();
  const language = await db.selectFrom("languages").select("code").where("code", "=", lang).executeTakeFirst();
  if (!language) return { error: "This language no longer exists." };

  const known = new Set((await getTranslationEntries()).map((e) => e.key));
  const keys = formData.getAll("keys").map(String).filter((k) => known.has(k));
  if (!keys.length) return { error: "Nothing to save." };
  if (keys.length > 500) return { error: "Too many fields in one save." };

  const rows: Array<{ lang: string; key: string; value: string }> = [];
  for (const key of keys) {
    const value = String(formData.get(`t:${key}`) ?? "").trim();
    if (value.length > 5000) return { error: "A translation is too long (5,000 characters at most)." };
    if (value) rows.push({ lang, key, value });
  }
  await writeTranslations(lang, keys, rows);
  return { success: "Translations saved." };
}

/** Import a JSON file: either { "key": "text" } or an export file ({ language, translations }). */
export async function importTranslations(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const lang = String(formData.get("lang") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a JSON file to import." };
  if (file.size > 5 * 1024 * 1024) return { error: "The file is larger than 5 MB." };

  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return { error: "The file is not valid JSON." };
  }
  const source =
    data && typeof data === "object" && "translations" in data ? (data as { translations: unknown }).translations : data;
  if (!source || typeof source !== "object" || Array.isArray(source)) return { error: "The file must contain an object of key/text pairs." };

  const db = await getDb();
  const language = await db.selectFrom("languages").select("code").where("code", "=", lang).executeTakeFirst();
  if (!language) return { error: "This language no longer exists." };

  const known = new Set((await getTranslationEntries()).map((e) => e.key));
  const rows: Array<{ lang: string; key: string; value: string }> = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(source)) {
    if (!known.has(key) || typeof value !== "string" || !value.trim() || value.length > 5000) {
      skipped++;
      continue;
    }
    rows.push({ lang, key, value: value.trim() });
  }
  if (!rows.length) return { error: "No matching translations were found in the file." };
  await writeTranslations(
    lang,
    rows.map((r) => r.key),
    rows,
  );
  return {
    success: `Imported ${countNoun(rows.length, "translation")}${skipped ? `, skipped ${countNoun(skipped, "unknown or empty entry", "unknown or empty entries")}` : ""}.`,
  };
}

async function writeTranslations(lang: string, keys: string[], rows: Array<{ lang: string; key: string; value: string }>) {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < keys.length; i += 200) {
      await trx
        .deleteFrom("translations")
        .where("lang", "=", lang)
        .where("key", "in", keys.slice(i, i + 200))
        .execute();
    }
    for (let i = 0; i < rows.length; i += 200) {
      await trx.insertInto("translations").values(rows.slice(i, i + 200)).execute();
    }
  });
  clearI18nCache();
}
