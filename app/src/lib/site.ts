import "server-only";
import { cache } from "react";
import { getCurrentUser } from "./auth/session";
import { getDb } from "./db";
import { getEntitlements } from "./plans";
import { getSettings, type Settings } from "./settings";
import { getActiveLanguages, getLocale } from "./i18n/server";

/** Everything the public layout needs, loaded once per request. */
export const getSiteContext = cache(async () => {
  const [settings, user, locale] = await Promise.all([getSettings(), getCurrentUser(), getLocale()]);
  const [entitlements, footerPages, languages, hasPosts] = await Promise.all([
    getEntitlements(user),
    getDb().then((db) =>
      db
        .selectFrom("pages")
        .select(["slug", "title"])
        .where("is_published", "=", 1)
        .where("show_in_footer", "=", 1)
        .orderBy("id")
        .execute(),
    ),
    getActiveLanguages(),
    settings.blog_enabled
      ? getDb().then((db) =>
          db
            .selectFrom("blog_posts")
            .select("id")
            .where("status", "=", "published")
            .where("published_at", "<=", new Date().toISOString())
            .limit(1)
            .executeTakeFirst()
            .then(Boolean),
        )
      : Promise.resolve(false),
  ]);
  return { settings, user, entitlements, footerPages, locale, languages, blogVisible: hasPosts };
});

export function absoluteUrl(settings: Settings, path = "/"): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  const base = (settings.site_url || process.env.SITE_URL || vercel || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function uploadUrl(path: string): string {
  if (!path) return "";
  if (/^https?:\/\//.test(path) || path.startsWith("/")) return path;
  return `/uploads/${path}`;
}
