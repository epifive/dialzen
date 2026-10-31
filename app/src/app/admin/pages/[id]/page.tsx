import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import { getDb } from "@/lib/db";
import { PageForm } from "../page-form";

export const metadata = { title: "Edit page" };

export default async function EditPagePage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const page = await db.selectFrom("pages").selectAll().where("id", "=", Number((await params).id)).executeTakeFirst();
  if (!page) notFound();
  return (
    <>
      <PageHeader
        title={page.title}
        description={
          <Link href="/admin/pages" className="text-primary hover:underline">
            Back to pages
          </Link>
        }
      />
      <PageForm
        page={{
          id: page.id,
          title: page.title,
          slug: page.slug,
          content: page.content,
          metaDescription: page.meta_description ?? "",
          isPublished: page.is_published === 1,
          showInFooter: page.show_in_footer === 1,
        }}
      />
    </>
  );
}
