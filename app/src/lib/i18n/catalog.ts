import "server-only";
import { getSettings } from "../settings";
import { MESSAGES, TRANSLATABLE_SETTINGS } from "./messages";

/** Everything a language can translate, grouped the way the admin editor shows it. */
export const TRANSLATION_GROUPS = [
  { id: "interface", label: "Interface", description: "Menus, buttons, forms and messages shown to visitors." },
  { id: "settings", label: "Site texts", description: "Tagline, home page headline, footer and SEO texts from Settings." },
] as const;

export type TranslationGroup = (typeof TRANSLATION_GROUPS)[number]["id"];

export interface TranslationEntry {
  key: string;
  /** The English text. */
  source: string;
  group: TranslationGroup;
  /** Short context shown above the field, e.g. the tool name. */
  context?: string;
  multiline: boolean;
}

export async function getTranslationEntries(): Promise<TranslationEntry[]> {
  const settings = await getSettings();
  const entries: TranslationEntry[] = [];
  const add = (group: TranslationGroup, key: string, source: string, context?: string) => {
    if (source) entries.push({ key, source, group, context, multiline: source.length > 80 });
  };

  for (const [key, source] of Object.entries(MESSAGES)) add("interface", key, source, key.split(".")[0]);
  for (const key of TRANSLATABLE_SETTINGS) add("settings", `setting.${key}`, String(settings[key] ?? ""), key.replace(/_/g, " "));
  return entries;
}

/** Language codes such as "fr", "pt-BR" or "zh-Hans". */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;
