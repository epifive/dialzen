import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getDb } from "../db";
import type { Language } from "../db/schema";
import { getSettings, type Settings } from "../settings";
import { interpolate, MESSAGES, type MessageKey, type TranslatableSetting, type Translator } from "./messages";

export const LANG_COOKIE = "tz_lang";

type Dictionary = Record<string, string>;

const globalForI18n = globalThis as unknown as {
  __dialzenLanguages?: Language[];
  __dialzenDictionaries?: Map<string, Dictionary>;
  __dialzenI18nLoadedAt?: number;
};

/**
 * Translations are cached in memory. Saving in the admin clears the cache of the
 * process that handled the save; the TTL refreshes other processes (serverless
 * instances, PM2 clusters) shortly after.
 */
const CACHE_TTL_MS = 60_000;

function expireCache() {
  const loadedAt = globalForI18n.__dialzenI18nLoadedAt;
  if (loadedAt && Date.now() - loadedAt > CACHE_TTL_MS) clearI18nCache();
  globalForI18n.__dialzenI18nLoadedAt ??= Date.now();
}

export async function getLanguages(): Promise<Language[]> {
  expireCache();
  if (globalForI18n.__dialzenLanguages) return globalForI18n.__dialzenLanguages;
  const db = await getDb();
  const rows = await db.selectFrom("languages").selectAll().orderBy("sort_order").orderBy("name").execute();
  globalForI18n.__dialzenLanguages = rows;
  return rows;
}

export async function getActiveLanguages(): Promise<Language[]> {
  return (await getLanguages()).filter((l) => l.is_active === 1);
}

export async function getDictionary(code: string): Promise<Dictionary> {
  expireCache();
  const cacheMap = (globalForI18n.__dialzenDictionaries ??= new Map());
  const hit = cacheMap.get(code);
  if (hit) return hit;
  const db = await getDb();
  const rows = await db.selectFrom("translations").select(["key", "value"]).where("lang", "=", code).execute();
  const dict: Dictionary = {};
  for (const row of rows) if (row.value) dict[row.key] = row.value;
  cacheMap.set(code, dict);
  return dict;
}

export function clearI18nCache(): void {
  globalForI18n.__dialzenLanguages = undefined;
  globalForI18n.__dialzenDictionaries = undefined;
  globalForI18n.__dialzenI18nLoadedAt = undefined;
}

export interface Locale {
  code: string;
  dir: "ltr" | "rtl";
  name: string;
  dictionary: Dictionary;
}

/** The visitor's language: their saved choice, else the site default. Deduplicated per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const [settings, languages, jar] = await Promise.all([getSettings(), getActiveLanguages(), cookies()]);
  const wanted = jar.get(LANG_COOKIE)?.value;
  const language =
    languages.find((l) => l.code === wanted) ??
    languages.find((l) => l.code === settings.default_language) ??
    languages[0];
  // English can have entries too: they override the built-in wording.
  if (!language) return { code: "en", dir: "ltr", name: "English", dictionary: {} };
  return { code: language.code, dir: language.direction, name: language.native_name, dictionary: await getDictionary(language.code) };
});

/**
 * The first active language matching one of the requested tags ("ar", "hi-IN", "pt-BR"): exact
 * code first, then the primary subtag. Used where no cookie is sent (the embedded widget passes
 * its host page's language). Null when none is installed and active.
 */
export async function pickLocale(tags: string[]): Promise<Locale | null> {
  const languages = await getActiveLanguages();
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    const base = tag.split(/[-_]/)[0];
    const language = languages.find((l) => l.code.toLowerCase() === tag) ?? languages.find((l) => l.code.toLowerCase() === base);
    if (language) return { code: language.code, dir: language.direction, name: language.native_name, dictionary: await getDictionary(language.code) };
  }
  return null;
}

/** A translator for a given locale (see pickLocale). */
export function translatorFor(locale: Locale): Translator {
  return (key: MessageKey, vars) => interpolate(locale.dictionary[key] ?? MESSAGES[key], vars);
}

export async function getT(): Promise<Translator> {
  const { dictionary } = await getLocale();
  return (key: MessageKey, vars) => interpolate(dictionary[key] ?? MESSAGES[key], vars);
}

/** Interface strings for client components (English merged with the active translation). */
export async function getClientMessages(): Promise<Record<string, string>> {
  const { dictionary } = await getLocale();
  const messages: Record<string, string> = { ...MESSAGES };
  for (const key of Object.keys(MESSAGES)) if (dictionary[key]) messages[key] = dictionary[key];
  return messages;
}

/** A setting's text in the visitor's language. */
export async function localSetting(settings: Settings, key: TranslatableSetting): Promise<string> {
  const { dictionary } = await getLocale();
  return dictionary[`setting.${key}`] || String(settings[key]);
}
