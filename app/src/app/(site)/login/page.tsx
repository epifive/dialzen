import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/site/auth-card";
import { LoginForm } from "@/components/site/auth-forms";
import { getT } from "@/lib/i18n/server";
import { getSiteContext } from "@/lib/site";
import { isDemoMode } from "@/lib/config";
import { safeNextPath } from "@/lib/utils";

/** On a public demo, pre-fill the advertised administrator login. */
function demoLogin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  return isDemoMode() && email && password ? { email, password } : undefined;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.signInTitle"), robots: { index: false } };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ user, settings }, { next }, t] = await Promise.all([getSiteContext(), searchParams, getT()]);
  if (user) redirect(safeNextPath(next));
  const nextPath = typeof next === "string" ? next : undefined;
  return (
    <AuthCard
      title={t("auth.signInTitle")}
      subtitle={t("auth.signInSubtitle", { site: settings.site_name })}
      footer={
        settings.registration_enabled ? (
          <>
            {t("auth.newHere")}{" "}
            <Link href={nextPath ? `/register?next=${encodeURIComponent(nextPath)}` : "/register"} className="font-medium text-primary hover:underline">
              {t("auth.createFree")}
            </Link>
          </>
        ) : undefined
      }
    >
      <LoginForm next={nextPath} demo={demoLogin()} />
    </AuthCard>
  );
}
