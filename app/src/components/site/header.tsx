import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { getSiteContext, uploadUrl } from "@/lib/site";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { MobileMenu, UserMenu } from "./header-menus";
import { ThemeToggle, type ThemeChoice } from "./theme";

export async function SiteHeader() {
  const { settings, user, entitlements, languages, locale, blogVisible } = await getSiteContext();
  const t = await getT();
  const navLink = "rounded-lg px-3 py-2 text-muted transition-colors hover:text-ink";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <MobileMenu
          signedIn={Boolean(user)}
          isAdmin={user?.role === "admin"}
          showPricing={!entitlements.isPremium}
          showBlog={blogVisible}
          showContact={settings.contact_enabled}
        />
        <Logo siteName={settings.site_name} logo={uploadUrl(settings.logo)} logoDark={uploadUrl(settings.logo_dark)} className="min-w-0" />

        <nav aria-label={t("nav.mainLabel")} className="ms-4 hidden items-center gap-1 text-sm font-medium lg:flex">
          <Link href="/#features" className={navLink}>
            {t("nav.features")}
          </Link>
          <Link href="/pricing" className={navLink}>
            {t("nav.pricing")}
          </Link>
          {blogVisible ? (
            <Link href="/blog" className={navLink}>
              {t("nav.blog")}
            </Link>
          ) : null}
          {settings.contact_enabled ? (
            <Link href="/contact" className={navLink}>
              {t("nav.contact")}
            </Link>
          ) : null}
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {languages.length > 1 ? (
            <LanguageSwitcher current={locale.code} languages={languages.map((l) => ({ code: l.code, name: l.native_name }))} />
          ) : null}
          <ThemeToggle defaultTheme={settings.default_theme as ThemeChoice} />
          {user ? (
            <>
              <ButtonLink href="/dashboard" size="sm" variant="outline" className="max-sm:hidden">
                {t("nav.dashboard")}
              </ButtonLink>
              <UserMenu name={user.name} email={user.email} isAdmin={user.role === "admin"} isPremium={entitlements.isPremium} />
            </>
          ) : (
            <>
              <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink sm:block">
                {t("nav.signIn")}
              </Link>
              <ButtonLink href="/register" size="sm" className="max-sm:hidden">
                {t("nav.startFree")}
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
