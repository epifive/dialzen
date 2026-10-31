import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { PostForm } from "../post-form";

export const metadata = { title: "Add post" };

export default function NewPostPage() {
  return (
    <>
      <PageHeader
        title="Add post"
        description={
          <Link href="/admin/blog" className="text-primary hover:underline">
            Back to blog
          </Link>
        }
      />
      <PostForm
        post={{
          id: null,
          title: "",
          slug: "",
          excerpt: "",
          content: "",
          coverImage: "",
          coverPreview: "",
          metaDescription: "",
          status: "published",
          publishedAt: "",
        }}
      />
    </>
  );
}
