import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostCard } from "@/components/site/post-card";
import { ButtonLink } from "@/components/ui/button";
import { getPublishedPosts } from "@/lib/blog";
import { getLocale, getT } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";

const PER_PAGE = 12;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("blog.title"), description: t("blog.subtitle"), alternates: { canonical: "/blog" } };
}

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [settings, t, { page: rawPage }, { code: lc }] = await Promise.all([getSettings(), getT(), searchParams, getLocale()]);
  if (!settings.blog_enabled) notFound();
  const page = Math.max(1, Math.min(1000, Number.parseInt(rawPage ?? "1", 10) || 1));
  const { posts, total } = await getPublishedPosts(page, PER_PAGE);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (page > pages) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
      <h1 className="text-4xl font-bold">{t("blog.title")}</h1>
      <p className="mt-2 max-w-[60ch] text-lg text-muted">{t("blog.subtitle")}</p>

      {posts.length ? (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <li key={post.id}>
              <PostCard post={post} readMore={t("blog.readMore")} locale={lc} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-8 rounded-xl border border-dashed border-line px-6 py-16 text-center text-muted">{t("blog.empty")}</p>
      )}

      {pages > 1 ? (
        <nav aria-label={t("blog.title")} className="mt-10 flex items-center justify-between gap-3">
          {page > 1 ? (
            <ButtonLink href={page === 2 ? "/blog" : `/blog?page=${page - 1}`} variant="outline">
              {t("blog.newer")}
            </ButtonLink>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            {page} / {pages}
          </span>
          {page < pages ? (
            <ButtonLink href={`/blog?page=${page + 1}`} variant="outline">
              {t("blog.older")}
            </ButtonLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
