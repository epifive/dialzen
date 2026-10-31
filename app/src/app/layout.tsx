import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { themeInitCode, type ThemeChoice } from "@/components/site/theme-init";
import { isInstalled } from "@/lib/config";
import { getLocale } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import "./globals.css";

// Fonts ship with the project (SIL Open Font License) so no third-party CDN is contacted.
const body = localFont({
  src: "../fonts/instrument-sans.woff2",
  variable: "--font-body",
  weight: "400 700",
  display: "swap",
});

const display = localFont({
  src: "../fonts/bricolage-grotesque.woff2",
  variable: "--font-display-face",
  weight: "200 800",
  display: "swap",
});

const code = localFont({
  src: "../fonts/jetbrains-mono.woff2",
  variable: "--font-code",
  weight: "100 800",
  display: "swap",
});

// Every page reads the site settings from the database. Rendering on request also keeps
// `next build` (e.g. the built-in /_not-found page) from opening the database.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  icons: { icon: "/icon.svg" },
};

/** Default theme and the visitor's language (the installer runs before there is a database). */
async function rootContext(): Promise<{ theme: ThemeChoice; lang: string }> {
  if (!isInstalled()) return { theme: "system", lang: "en" };
  try {
    const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
    return { theme: settings.default_theme as ThemeChoice, lang: locale.code };
  } catch {
    return { theme: "system", lang: "en" };
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { theme, lang } = await rootContext();
  return (
    <html lang={lang} suppressHydrationWarning className={`${body.variable} ${display.variable} ${code.variable}`}>
      <head>
        {/* Applies the saved theme before first paint. Rendered here only: the root layout never re-renders on the client. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitCode(theme) }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
