import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/site/auth-card";
import { RegisterForm } from "@/components/site/auth-forms";
import { Alert } from "@/components/ui/alert";
import { getT } from "@/lib/i18n/server";
import { getSiteContext } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.createAccount"), robots: { index: false } };
}

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [{ user, settings }, { next }, t] = await Promise.all([getSiteContext(), searchParams, getT()]);
  if (user) redirect("/account");
  return (
    <AuthCard
      title={t("auth.registerTitle")}
      subtitle={t("auth.registerSubtitle")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      {settings.registration_enabled ? (
        <RegisterForm next={typeof next === "string" ? next : undefined} termsHref="/p/terms-of-service" />
      ) : (
        <Alert tone="info">{t("auth.registrationClosed")}</Alert>
      )}
    </AuthCard>
  );
}
