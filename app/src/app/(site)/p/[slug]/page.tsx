import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getLocale, getT } from "@/lib/i18n/server";
import { renderMarkdown } from "@/lib/markdown";
import { fillPlaceholders, getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/dash-format";

async function loadPage(slug: string) {
  const db = await getDb();
  return db.selectFrom("pages").selectAll().where("slug", "=", slug).where("is_published", "=", 1).executeTakeFirst();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await loadPage((await params).slug);
  if (!page) return {};
  const settings = await getSettings();
  return {
    title: page.title,
    description: page.meta_description ? fillPlaceholders(page.meta_description, settings) : undefined,
    alternates: { canonical: `/p/${page.slug}` },
  };
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await loadPage((await params).slug);
  if (!page) notFound();
  const [settings, t, { code: lc }] = await Promise.all([getSettings(), getT(), getLocale()]);
  const html = await renderMarkdown(fillPlaceholders(page.content, settings));
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-4xl font-bold">{page.title}</h1>
      <p className="mt-2 text-sm text-muted">{t("page.lastUpdated", { date: formatDateTime(page.updated_at, lc, false) })}</p>
      <div className="prose-tz mt-8" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
