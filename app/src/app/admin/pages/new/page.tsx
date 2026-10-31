import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { PageForm } from "../page-form";

export const metadata = { title: "Add page" };

export default function NewPagePage() {
  return (
    <>
      <PageHeader
        title="Add page"
        description={
          <Link href="/admin/pages" className="text-primary hover:underline">
            Back to pages
          </Link>
        }
      />
      <PageForm page={{ id: null, title: "", slug: "", content: "", metaDescription: "", isPublished: true, showInFooter: true }} />
    </>
  );
}
