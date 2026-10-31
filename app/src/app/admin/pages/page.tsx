import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Pages" };

export default async function AdminPagesPage({ searchParams }: { searchParams: Promise<{ saved?: string; deleted?: string }> }) {
  const params = await searchParams;
  const db = await getDb();
  const pages = await db.selectFrom("pages").select(["id", "slug", "title", "is_published", "show_in_footer", "updated_at"]).orderBy("id").execute();
  return (
    <>
      <PageHeader
        title="Pages"
        description="Content pages such as About, Privacy policy and Terms. Written in Markdown."
        actions={
          <ButtonLink href="/admin/pages/new">
            <Plus aria-hidden />
            Add page
          </ButtonLink>
        }
      />
      {params.saved ? <Alert tone="success" className="mb-4">Page saved.</Alert> : null}
      {params.deleted ? <Alert tone="success" className="mb-4">Page deleted.</Alert> : null}
      <Card padded={false}>
        {pages.length ? (
          <Table minWidth={620}>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Updated</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <p className="font-medium">{p.title}</p>
                    <Link href={`/p/${p.slug}`} target="_blank" className="text-xs text-muted hover:text-primary">
                      /p/{p.slug}
                    </Link>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={p.is_published ? "success" : "neutral"}>{p.is_published ? "Published" : "Draft"}</Badge>
                      {p.show_in_footer ? <Badge>In footer</Badge> : null}
                    </span>
                  </Td>
                  <Td className="text-muted">{formatDate(p.updated_at)}</Td>
                  <Td className="text-right">
                    <Link href={`/admin/pages/${p.id}`} className="text-sm font-medium text-primary hover:underline">
                      Edit
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No pages yet">Add an About or Privacy page to build trust with visitors and ad networks.</EmptyState>
        )}
      </Card>
    </>
  );
}
