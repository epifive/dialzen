"use client";

import { useEffect } from "react";

/**
 * Keeps <html lang> and <html dir> in line with the language of the current part of the
 * app (site, dashboard, shared dashboards, admin), also after client-side navigation
 * between them. The content itself is wrapped in an element with the right lang/dir, so
 * the first paint is already correct; the root layout also renders the visitor's lang.
 */
export function HtmlLang({ code, dir }: { code: string; dir: "ltr" | "rtl" }) {
  useEffect(() => {
    const html = document.documentElement;
    html.lang = code;
    html.dir = dir;
  }, [code, dir]);
  return null;
}
