import Link from "next/link";
import { PageHeader } from "@/components/admin/ui";
import { getAllPlans } from "@/lib/plans";
import { UserForm } from "../user-form";

export const metadata = { title: "Add user" };

export default async function CreateUserPage() {
  const plans = await getAllPlans();
  return (
    <>
      <PageHeader
        title="Add user"
        description={
          <Link href="/admin/users" className="text-primary hover:underline">
            Back to users
          </Link>
        }
      />
      <UserForm
        isSelf={false}
        plans={plans.filter((p) => !p.is_free).map((p) => ({ id: p.id, name: p.name }))}
        user={{ id: null, name: "", email: "", role: "user", status: "active", planId: 0, planExpires: "" }}
      />
    </>
  );
}
