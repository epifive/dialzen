"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { guardAdmin } from "@/lib/admin";
import { getDb, now } from "@/lib/db";
import { slugify } from "@/lib/utils";
import type { FormState } from "@/app/actions/types";

export async function savePage(_prev: FormState, formData: FormData): Promise<FormState> {
  const rawId = Number(formData.get("page_id"));
  const pageId = Number.isInteger(rawId) && rawId > 0 ? rawId : null;
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const parsed = z
    .object({
      title: z.string().trim().min(2, "Enter a title.").max(255),
      slug: z.string().trim().max(120),
      content: z.string().max(100_000),
      meta_description: z.string().trim().max(255),
    })
    .safeParse({
      title: formData.get("title"),
      slug: formData.get("slug") ?? "",
      content: formData.get("content") ?? "",
      meta_description: formData.get("meta_description") ?? "",
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const slug = slugify(parsed.data.slug || parsed.data.title);
  if (!slug) return { error: "Enter a URL slug using letters and numbers." };

  const db = await getDb();
  const clash = await db
    .selectFrom("pages")
    .select("id")
    .where("slug", "=", slug)
    .$if(pageId !== null, (qb) => qb.where("id", "!=", pageId!))
    .executeTakeFirst();
  if (clash) return { error: `Another page already uses /p/${slug}.` };

  const values = {
    title: parsed.data.title,
    slug,
    content: parsed.data.content,
    meta_description: parsed.data.meta_description || null,
    is_published: formData.get("is_published") === "on" ? 1 : 0,
    show_in_footer: formData.get("show_in_footer") === "on" ? 1 : 0,
    updated_at: now(),
  };
  if (pageId) await db.updateTable("pages").set(values).where("id", "=", pageId).execute();
  else await db.insertInto("pages").values({ ...values, created_at: now() }).execute();
  redirect("/admin/pages?saved=1");
}

export async function deletePage(pageId: number): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const db = await getDb();
  await db.deleteFrom("pages").where("id", "=", pageId).execute();
  redirect("/admin/pages?deleted=1");
}

export async function setMessageRead(messageId: number, read: boolean): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const db = await getDb();
  await db.updateTable("contact_messages").set({ is_read: read ? 1 : 0 }).where("id", "=", messageId).execute();
  return {};
}

export async function deleteMessage(messageId: number): Promise<FormState> {
  const guard = await guardAdmin();
  if (!guard.ok) return { error: guard.error };
  const db = await getDb();
  await db.deleteFrom("contact_messages").where("id", "=", messageId).execute();
  return {};
}
