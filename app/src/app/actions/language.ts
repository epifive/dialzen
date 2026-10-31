"use server";

import { cookies } from "next/headers";
import { getActiveLanguages, LANG_COOKIE } from "@/lib/i18n/server";

/** Remember the visitor's language choice for a year. */
export async function setLanguage(code: string): Promise<void> {
  const languages = await getActiveLanguages();
  if (!languages.some((l) => l.code === code)) return;
  (await cookies()).set(LANG_COOKIE, code, { path: "/", maxAge: 365 * 86_400, sameSite: "lax", httpOnly: true });
}
