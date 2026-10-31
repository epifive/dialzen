"use client";

import { useActionState, useState, useTransition } from "react";
import { initialFormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { deletePost, savePost } from "../actions/blog";

export interface EditablePost {
  id: number | null;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  coverPreview: string;
  metaDescription: string;
  status: "draft" | "published";
  /** UTC value for a datetime-local input ("YYYY-MM-DDTHH:mm"), or "". */
  publishedAt: string;
}

export function PostForm({ post }: { post: EditablePost }) {
  const [state, action] = useActionState(savePost, initialFormState);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState("");
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-5 rounded-xl border border-line bg-surface p-6">
        <FormMessage state={state} />
        <input type="hidden" name="post_id" value={post.id ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title">
            <Input id="title" name="title" defaultValue={post.title} required maxLength={255} />
          </Field>
          <Field label="URL slug" htmlFor="slug" hint="The post will be at /blog/your-slug. Leave empty to create it from the title.">
            <Input id="slug" name="slug" defaultValue={post.slug} maxLength={160} />
          </Field>
        </div>
        <Field label="Excerpt" htmlFor="excerpt" hint="One or two sentences shown on the blog list and the home page.">
          <Textarea id="excerpt" name="excerpt" defaultValue={post.excerpt} rows={2} maxLength={500} />
        </Field>
        <Field label="Content" htmlFor="content" hint="Markdown: ## Heading, **bold**, [link](https://…), - list item, ![alt](https://image-url). {site_name}, {site_email} and {year} are replaced automatically.">
          <Textarea id="content" name="content" defaultValue={post.content} rows={22} className="font-mono text-[13px]" />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Cover image</p>
          <div className="flex flex-wrap items-center gap-4">
            {post.coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded image
              <img src={post.coverPreview} alt="" className="h-16 w-28 rounded-md border border-line object-cover" />
            ) : null}
            <input
              name="cover_image"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label="Upload cover image"
              className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
            />
            {post.coverImage ? <Checkbox name="cover_image__remove" label="Remove" /> : null}
          </div>
          <Input name="cover_image__url" type="url" placeholder="…or paste an image URL (https://)" aria-label="Cover image URL" />
          <p className="text-xs text-muted">16:9 works best, for example 1200 × 675. Up to 2 MB.</p>
        </div>

        <Field label="Meta description" htmlFor="meta_description" hint="Shown in search results. Falls back to the excerpt.">
          <Input id="meta_description" name="meta_description" defaultValue={post.metaDescription} maxLength={255} />
        </Field>
        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={post.status}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </Select>
          </Field>
          <Field label="Publish date (UTC)" htmlFor="published_at" hint="Leave empty to publish now. A future date schedules the post.">
            <Input id="published_at" name="published_at" type="datetime-local" defaultValue={post.publishedAt} />
          </Field>
        </div>
        <div className="flex justify-end">
          <SubmitButton>{post.id ? "Save post" : "Create post"}</SubmitButton>
        </div>
      </form>
      {post.id ? (
        <section className="rounded-xl border border-red-200 bg-surface p-6 dark:border-red-900">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Delete post</h2>
          {deleteError ? <Alert tone="error" className="mt-3">{deleteError}</Alert> : null}
          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            disabled={deleting}
            onClick={() => {
              if (!confirm(`Delete “${post.title}”?`)) return;
              startDelete(async () => {
                const result = await deletePost(post.id!);
                if (result?.error) setDeleteError(result.error);
              });
            }}
          >
            {deleting ? "Deleting…" : "Delete post"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
