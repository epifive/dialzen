import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandStyle } from "@/components/site/brand-style";
import { HtmlLang } from "@/components/site/html-lang";
import { requireDashboardUser } from "@/lib/dashboard";
import { I18nProvider } from "@/lib/i18n/client";
import { getClientMessages, getLocale, getT } from "@/lib/i18n/server";
import { maybeLazyTick } from "@/lib/lazy-tick";
import { getSettings } from "@/lib/settings";
import { uploadUrl } from "@/lib/site";

// Every dashboard page reads the signed-in user's data at request time.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [settings, t] = await Promise.all([getSettings(), getT()]);
  const favicon = uploadUrl(settings.favicon);
  return {
    title: { default: t("dash.title"), template: `%s${settings.title_separator}${settings.site_name}` },
    robots: { index: false, follow: false },
    icons: favicon ? { icon: favicon, apple: favicon } : { icon: "/icon.svg" },
  };
}

/**
 * Frame of every dashboard page: sign-in check, translations, brand colour. The sidebar shell is
 * rendered by the workspace layout (/dashboard/w/[wid]/layout.tsx), because its navigation
 * belongs to the current workspace.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireDashboardUser();
  // Without a cron job, background jobs (campaign dialing!) also run when people use the app.
  Promise.resolve()
    .then(() => maybeLazyTick())
    .catch(() => {});

  const [settings, locale, messages] = await Promise.all([getSettings(), getLocale(), getClientMessages()]);
  return (
    <I18nProvider messages={messages}>
      <HtmlLang code={locale.code} dir={locale.dir} />
      <BrandStyle color={settings.primary_color} />
      <div dir={locale.dir} lang={locale.code}>
        {children}
      </div>
    </I18nProvider>
  );
}
