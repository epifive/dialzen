import Link from "next/link";
import { getT, localSetting } from "@/lib/i18n/server";
import { fillPlaceholders } from "@/lib/settings";
import { getSiteContext, uploadUrl } from "@/lib/site";
import { Logo } from "./logo";

export async function SiteFooter() {
  const { settings, footerPages, blogVisible } = await getSiteContext();
  const [t, footerText, copyright] = await Promise.all([getT(), localSetting(settings, "footer_text"), localSetting(settings, "copyright_text")]);
  const columns: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
    {
      title: t("footer.product"),
      links: [
        { href: "/#features", label: t("nav.features") },
        { href: "/pricing", label: t("nav.pricing") },
        { href: "/register", label: t("nav.startFree") },
      ],
    },
    {
      title: t("footer.resources"),
      links: [
        ...(blogVisible ? [{ href: "/blog", label: t("nav.blog") }] : []),
        ...(settings.contact_enabled ? [{ href: "/contact", label: t("nav.contact") }] : []),
        { href: "/login", label: t("nav.signIn") },
      ],
    },
    { title: t("footer.company"), links: footerPages.map((p) => ({ href: `/p/${p.slug}`, label: p.title })) },
  ];

  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_2fr]">
        <div className="max-w-sm">
          <Logo siteName={settings.site_name} logo={uploadUrl(settings.logo)} logoDark={uploadUrl(settings.logo_dark)} />
          <p className="mt-4 text-sm leading-relaxed text-muted">{fillPlaceholders(footerText, settings)}</p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns
            .filter((c) => c.links.length)
            .map((column) => (
              <div key={column.title}>
                <h2 className="font-sans text-sm font-semibold tracking-normal">{column.title}</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} prefetch={false} className="text-muted hover:text-ink">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{fillPlaceholders(copyright, settings)}</p>
          <p>
            {t("footer.madeWith")} <span className="font-medium text-ink">{settings.site_name}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
