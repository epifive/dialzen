"use client";

import { useEffect, useRef } from "react";

/**
 * Renders admin-provided HTML (ad units, analytics snippets) and executes any
 * <script> tags inside it, which React's dangerouslySetInnerHTML does not do.
 * Only ever pass HTML that an administrator entered in the admin panel.
 */
export function RawHtml({ html, className }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !html) return;
    el.innerHTML = html;
    el.querySelectorAll("script").forEach((original) => {
      const script = document.createElement("script");
      for (const attr of Array.from(original.attributes)) script.setAttribute(attr.name, attr.value);
      script.text = original.text;
      original.replaceWith(script);
    });
    return () => {
      el.innerHTML = "";
    };
  }, [html]);

  return <div ref={ref} className={className} />;
}
