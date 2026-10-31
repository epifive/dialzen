"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { guardAdmin, saveUpload } from "@/lib/admin";
import { getDb, now } from "@/lib/db";
import { slugify } from "@/lib/utils";
import type { FormState } from "@/app/actions/types";

export async function savePost(_prev: FormState, formData: FormData): Promise<FormState> {
  const rawId = Number(formData.get("post_id"));
  const postId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const parsed = z
    .object({
      title: z.string().trim().min(2, "Enter a title.").max(255),
      slug: z.string().trim().max(160),
      excerpt: z.string().trim().max(500, "Keep the excerpt under 500 characters."),
      content: z.string().max(60_000, "The article is too long (60,000 characters at most)."),
      meta_description: z.string().trim().max(255),
      status: z.enum(["draft", "published"]),
      published_at: z.string().trim().max(32),
    })
    .safeParse({
      title: formData.get("title"),
      slug: formData.get("slug") ?? "",
      excerpt: formData.get("excerpt") ?? "",
      content: formData.get("content") ?? "",
      meta_description: formData.get("meta_description") ?? "",
      status: formData.get("status"),
      published_at: formData.get("published_at") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const data = parsed.data;
  const slug = slugify(data.slug || data.title);
  if (!slug) return { error: "Enter a URL slug using letters and numbers." };

  // The form sends a UTC "YYYY-MM-DDTHH:mm" value; empty means "now" when publishing.
  let publishedAt: string | null = null;
  if (data.published_at) {
    const date = new Date(`${data.published_at}${data.published_at.length === 16 ? ":00" : ""}Z`);
    if (Number.isNaN(date.getTime())) return { error: "Enter a valid publish date." };
    publishedAt = date.toISOString();
  } else if (data.status === "published") {
    publishedAt = now();
  }

  const db = await getDb();
  const clash = await db
    .selectFrom("blog_posts")
    .select("id")
    .where("slug", "=", slug)
    .$if(postId !== null, (qb) => qb.where("id", "!=", postId!))
    .executeTakeFirst();
  if (clash) return { error: `Another post already uses /blog/${slug}.` };

  let cover: string | null | undefined;
  const file = formData.get("cover_image");
  const url = String(formData.get("cover_image__url") ?? "").trim();
  if (formData.get("cover_image__remove") === "on") cover = null;
  else if (file instanceof File && file.size > 0) {
    try {
      cover = await saveUpload(file, "post");
    } catch (error) {
      return { error: (error as Error).message };
    }
  } else if (url) {
    if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) return { error: "The cover image URL must start with https://" };
    cover = url;
  }

  const values = {
    title: data.title,
    slug,
    excerpt: data.excerpt || null,
    content: data.content,
    meta_description: data.meta_description || null,
    status: data.status,
    published_at: publishedAt,
    updated_at: now(),
    ...(cover !== undefined ? { cover_image: cover } : {}),
  };
  if (postId) await db.updateTable("blog_posts").set(values).where("id", "=", postId).execute();
  else await db.insertInto("blog_posts").values({ ...values, views: 0, created_at: now() }).execute();
  redirect("/admin/blog?saved=1");
}

export async function deletePost(postId: number): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const db = await getDb();
  await db.deleteFrom("blog_posts").where("id", "=", postId).execute();
  redirect("/admin/blog?deleted=1");
}
