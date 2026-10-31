import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandStyle } from "@/components/site/brand-style";
import { HtmlLang } from "@/components/site/html-lang";
import type { ThemeChoice } from "@/components/site/theme";
import { requireAdmin } from "@/lib/auth/session";
import { isDemoMode } from "@/lib/config";
import { getDb } from "@/lib/db";
import { maybeLazyTick } from "@/lib/lazy-tick";
import { getSettings } from "@/lib/settings";
import { uploadUrl } from "@/lib/site";
import { AdminShell } from "./shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s – Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireAdmin();
  maybeLazyTick();
  const settings = await getSettings();
  const db = await getDb();
  const [unread, pendingPayments] = await Promise.all([
    db.selectFrom("contact_messages").select((eb) => eb.fn.countAll<number>().as("n")).where("is_read", "=", 0).executeTakeFirst(),
    db.selectFrom("payments").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "=", "pending").where("provider", "=", "offline").executeTakeFirst(),
  ]);

  return (
    <>
      {/* The admin panel is in English. */}
      <HtmlLang code="en" dir="ltr" />
      <BrandStyle color={settings.primary_color} />
      <AdminShell
        siteName={settings.site_name}
        logo={uploadUrl(settings.logo)}
        logoDark={uploadUrl(settings.logo_dark)}
        user={{ name: user.name, email: user.email }}
        badges={{ messages: Number(unread?.n ?? 0), payments: Number(pendingPayments?.n ?? 0) }}
        demo={isDemoMode()}
        defaultTheme={settings.default_theme as ThemeChoice}
      >
        {children}
      </AdminShell>
    </>
  );
}
