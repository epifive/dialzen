"use client";

import { useActionState, useState, useTransition } from "react";
import { initialFormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { deletePage, savePage } from "../actions/content";

export interface EditablePage {
  id: number | null;
  title: string;
  slug: string;
  content: string;
  metaDescription: string;
  isPublished: boolean;
  showInFooter: boolean;
}

export function PageForm({ page }: { page: EditablePage }) {
  const [state, action] = useActionState(savePage, initialFormState);
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState("");
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-5 rounded-xl border border-line bg-surface p-6">
        <FormMessage state={state} />
        <input type="hidden" name="page_id" value={page.id ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title">
            <Input id="title" name="title" defaultValue={page.title} required maxLength={255} />
          </Field>
          <Field label="URL slug" htmlFor="slug" hint="The page will be at /p/your-slug. Leave empty to create it from the title.">
            <Input id="slug" name="slug" defaultValue={page.slug} maxLength={120} />
          </Field>
        </div>
        <Field label="Meta description" htmlFor="meta_description">
          <Input id="meta_description" name="meta_description" defaultValue={page.metaDescription} maxLength={255} />
        </Field>
        <Field
          label="Content"
          htmlFor="content"
          hint="Markdown: ## Heading, **bold**, [link](https://…), - list item. {site_name} and {site_email} are replaced automatically."
        >
          <Textarea id="content" name="content" defaultValue={page.content} rows={18} className="font-mono text-[13px]" />
        </Field>
        <div className="space-y-4 border-t border-line pt-5">
          <Switch name="is_published" label="Published" defaultChecked={page.isPublished} />
          <Switch name="show_in_footer" label="Link in footer" defaultChecked={page.showInFooter} />
        </div>
        <div className="flex justify-end">
          <SubmitButton>{page.id ? "Save page" : "Create page"}</SubmitButton>
        </div>
      </form>
      {page.id ? (
        <section className="rounded-xl border border-red-200 bg-surface p-6 dark:border-red-900">
          <h2 className="font-sans text-sm font-semibold tracking-normal">Delete page</h2>
          {deleteError ? <Alert tone="error" className="mt-3">{deleteError}</Alert> : null}
          <Button
            variant="danger"
            size="sm"
            className="mt-4"
            disabled={deleting}
            onClick={() => {
              if (!confirm(`Delete “${page.title}”?`)) return;
              startDelete(async () => {
                const result = await deletePage(page.id!);
                if (result?.error) setDeleteError(result.error);
              });
            }}
          >
            {deleting ? "Deleting…" : "Delete page"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
