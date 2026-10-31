import Link from "next/link";
import { BookOpenText } from "lucide-react";
import type { PostSummary } from "@/lib/blog";
import { uploadUrl } from "@/lib/site";
import { formatDateTime } from "@/lib/dash-format";

/** Blog post tile. Posts without a cover get a branded grid panel with a book icon. */
export function PostCard({ post, readMore, locale }: { post: PostSummary; readMore: string; locale: string }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      prefetch={false}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-primary-line"
    >
      {post.cover_image ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin-provided image of unknown size/host
        <img src={uploadUrl(post.cover_image)} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
      ) : (
        <div className="mat-grid grid aspect-[16/9] place-items-center border-b border-line bg-primary-soft/30" aria-hidden>
          <span className="grid size-16 place-items-center rounded-2xl bg-surface text-primary shadow-sm ring-1 ring-line transition-transform group-hover:scale-105">
            <BookOpenText className="size-7" />
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs text-muted">{formatDateTime(post.published_at, locale, false)}</p>
        <h3 className="mt-1.5 text-lg leading-snug font-bold group-hover:text-primary">{post.title}</h3>
        {post.excerpt ? <p className="mt-2 line-clamp-3 text-sm text-muted">{post.excerpt}</p> : null}
        <span className="mt-auto pt-4 text-sm font-medium text-primary">{readMore}</span>
      </div>
    </Link>
  );
}
