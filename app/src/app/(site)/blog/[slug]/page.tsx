import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { ChevronRight } from "lucide-react";
import { JsonLd } from "@/components/site/json-ld";
import { PostCard } from "@/components/site/post-card";
import { countPostView, getLatestPosts, getPublishedPost, readingMinutes } from "@/lib/blog";
import { getLocale, getT } from "@/lib/i18n/server";
import { renderMarkdown } from "@/lib/markdown";
import { getSettings } from "@/lib/settings";
import { absoluteUrl, uploadUrl } from "@/lib/site";
import { formatDateTime } from "@/lib/dash-format";

async function loadPost(slug: string) {
  const settings = await getSettings();
  if (!settings.blog_enabled) return null;
  const post = await getPublishedPost(slug);
  return post ? { settings, post } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const found = await loadPost((await params).slug);
  if (!found) return {};
  const { post, settings } = found;
  const description = post.meta_description || post.excerpt || undefined;
  const image = post.cover_image ? absoluteUrl(settings, uploadUrl(post.cover_image)) : undefined;
  return {
    title: post.title,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description,
      url: `/blog/${post.slug}`,
      publishedTime: post.published_at ?? undefined,
      images: image ? [image] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = await loadPost((await params).slug);
  if (!found) notFound();
  const { post, settings } = found;
  const [t, html, related, { code: lc }] = await Promise.all([getT(), renderMarkdown(post.content), getLatestPosts(3, post.id), getLocale()]);
  after(() => countPostView(post.id).catch(() => undefined));

  const url = absoluteUrl(settings, `/blog/${post.slug}`);
  const cover = post.cover_image ? uploadUrl(post.cover_image) : null;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "BlogPosting",
              headline: post.title,
              description: post.meta_description || post.excerpt || undefined,
              url,
              mainEntityOfPage: url,
              datePublished: post.published_at,
              dateModified: post.updated_at,
              image: cover ? absoluteUrl(settings, cover) : undefined,
              author: { "@type": "Organization", name: settings.site_name },
              publisher: { "@type": "Organization", name: settings.site_name },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: t("nav.home"), item: absoluteUrl(settings, "/") },
                { "@type": "ListItem", position: 2, name: t("blog.title"), item: absoluteUrl(settings, "/blog") },
                { "@type": "ListItem", position: 3, name: post.title, item: url },
              ],
            },
          ],
        }}
      />
      <article className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
        <nav aria-label={t("nav.breadcrumb")}>
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
            <li>
              <Link href="/" className="hover:text-ink">
                {t("nav.home")}
              </Link>
            </li>
            <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
            <li>
              <Link href="/blog" className="hover:text-ink">
                {t("blog.title")}
              </Link>
            </li>
          </ol>
        </nav>

        <header className="mt-6">
          <h1 className="text-4xl leading-tight font-bold tall-script:leading-[1.35] sm:text-5xl">{post.title}</h1>
          <p className="mt-3 text-sm text-muted">
            {formatDateTime(post.published_at, lc, false)} · {t("blog.minRead", { minutes: readingMinutes(post.content) })}
          </p>
        </header>

        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin-provided image of unknown size/host
          <img src={cover} alt="" className="mt-8 aspect-[16/9] w-full rounded-xl border border-line object-cover" />
        ) : null}

        <div className="prose-tz mt-8" dangerouslySetInnerHTML={{ __html: html }} />
      </article>

      {related.length ? (
        <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-2xl font-bold">{t("blog.related")}</h2>
            <Link href="/blog" className="text-sm font-medium text-primary hover:underline">
              {t("blog.back")}
            </Link>
          </div>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((item) => (
              <li key={item.id}>
                <PostCard post={item} readMore={t("blog.readMore")} locale={lc} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
