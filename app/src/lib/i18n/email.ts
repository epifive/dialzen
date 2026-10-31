import "server-only";
import { interpolate, type MessageKey, MESSAGES, type Translator } from "./messages";
import { getDictionary } from "./server";
import { getSettings } from "@/lib/settings";

/**
 * Translator for emails sent outside a request (jobs, notifications, invites): the platform's
 * default language (Admin → Languages), English fallback. Never throws.
 */
export async function emailTranslator(): Promise<{ t: Translator; locale: string }> {
  let locale = "en";
  let dictionary: Record<string, string> = {};
  try {
    locale = (await getSettings()).default_language || "en";
    dictionary = await getDictionary(locale);
  } catch {
    dictionary = {};
  }
  return { t: (key: MessageKey, vars) => interpolate(dictionary[key] ?? MESSAGES[key], vars), locale };
}
