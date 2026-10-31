import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/site/auth-card";
import { ResetPasswordForm } from "@/components/site/auth-forms";
import { Alert } from "@/components/ui/alert";
import { interpolateParts } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.newPasswordTitle"), robots: { index: false } };
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token }, t] = await Promise.all([searchParams, getT()]);
  return (
    <AuthCard title={t("auth.newPasswordTitle")}>
      {typeof token === "string" && token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert tone="error" title={t("auth.linkIncompleteTitle")}>
          {interpolateParts(t("auth.linkIncompleteRich"), {
            link: (
              <Link href="/forgot-password" className="underline">
                {t("auth.requestNew")}
              </Link>
            ),
          }).map((part, i) => (
            <Fragment key={i}>{part}</Fragment>
          ))}
        </Alert>
      )}
    </AuthCard>
  );
}
