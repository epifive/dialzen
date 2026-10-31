import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/admin/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { getDb, now } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Blog" };

const PER_PAGE = 25;

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; deleted?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const db = await getDb();
  const [posts, count, settings] = await Promise.all([
    db
      .selectFrom("blog_posts")
      .select(["id", "slug", "title", "status", "published_at", "views", "updated_at"])
      .orderBy("created_at", "desc")
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE)
      .execute(),
    db.selectFrom("blog_posts").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
    getSettings(),
  ]);
  const pages = Math.max(1, Math.ceil(Number(count?.n ?? 0) / PER_PAGE));
  const current = now();

  return (
    <>
      <PageHeader
        title="Blog"
        description="Articles that bring search traffic to your platform. Written in Markdown."
        actions={
          <ButtonLink href="/admin/blog/new">
            <Plus aria-hidden />
            Add post
          </ButtonLink>
        }
      />
      {!settings.blog_enabled ? (
        <Alert tone="warning" className="mb-4">
          The blog is switched off, so visitors can&apos;t see these posts. Turn it on in{" "}
          <Link href="/admin/settings/general" className="font-medium underline">
            Settings → General
          </Link>
          .
        </Alert>
      ) : null}
      {params.saved ? <Alert tone="success" className="mb-4">Post saved.</Alert> : null}
      {params.deleted ? <Alert tone="success" className="mb-4">Post deleted.</Alert> : null}
      <Card padded={false}>
        {posts.length ? (
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Published</Th>
                <Th className="text-right">Views</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => {
                const scheduled = p.status === "published" && !!p.published_at && p.published_at > current;
                return (
                  <tr key={p.id}>
                    <Td>
                      <p className="font-medium">{p.title}</p>
                      <Link href={`/blog/${p.slug}`} target="_blank" className="text-xs text-muted hover:text-primary">
                        /blog/{p.slug}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={p.status === "published" && !scheduled ? "success" : scheduled ? "warning" : "neutral"}>
                        {scheduled ? "Scheduled" : p.status === "published" ? "Published" : "Draft"}
                      </Badge>
                    </Td>
                    <Td className="text-muted">{formatDate(p.published_at)}</Td>
                    <Td className="text-right tabular-nums">{p.views.toLocaleString("en-US")}</Td>
                    <Td className="text-right">
                      <Link href={`/admin/blog/${p.id}`} className="text-sm font-medium text-primary hover:underline">
                        Edit
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No posts yet">Write guides about social media planning to bring visitors from search engines.</EmptyState>
        )}
      </Card>
      <Pagination page={page} pages={pages} href={(n) => `/admin/blog?page=${n}`} />
    </>
  );
}
