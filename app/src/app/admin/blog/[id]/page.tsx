import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { getDb } from "@/lib/db";
import { uploadUrl } from "@/lib/site";
import { PostForm } from "../post-form";

export const metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const db = await getDb();
  const post = await db.selectFrom("blog_posts").selectAll().where("id", "=", id).executeTakeFirst();
  if (!post) notFound();
  return (
    <>
      <PageHeader
        title={post.title}
        description={
          <Link href="/admin/blog" className="text-primary hover:underline">
            Back to blog
          </Link>
        }
      />
      <PostForm
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt ?? "",
          content: post.content,
          coverImage: post.cover_image ?? "",
          coverPreview: post.cover_image ? uploadUrl(post.cover_image) : "",
          metaDescription: post.meta_description ?? "",
          status: post.status === "published" ? "published" : "draft",
          publishedAt: post.published_at ? post.published_at.slice(0, 16) : "",
        }}
      />
    </>
  );
}
