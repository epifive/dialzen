import type { Metadata } from "next";
import { CircleCheck, Clock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getLocale, getT } from "@/lib/i18n/server";
import { confirmCheckoutSession } from "@/lib/payments/stripe";
import { getEntitlements } from "@/lib/plans";
import { formatDateTime } from "@/lib/dash-format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("checkout.successMetaTitle"), robots: { index: false } };
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; session_id?: string }>;
}) {
  const { provider, session_id } = await searchParams;
  const user = await requireUser("/account");
  if (provider === "stripe" && typeof session_id === "string" && session_id.startsWith("cs_")) {
    // Don't wait for the webhook: confirm the session directly so access starts immediately.
    await confirmCheckoutSession(session_id, user.id).catch(() => false);
  }
  // Re-read the plan columns: the session user was loaded before the payment was confirmed.
  const db = await getDb();
  const fresh = await db
    .selectFrom("users")
    .select(["plan_id", "plan_expires_at"])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  const [entitlements, t, { code: lc }] = await Promise.all([getEntitlements({ ...user, ...fresh }), getT(), getLocale()]);

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      {entitlements.isPremium ? (
        <>
          <CircleCheck className="mx-auto size-14 text-primary" aria-hidden />
          <h1 className="mt-6 text-3xl font-bold">{t("checkout.successTitle", { plan: entitlements.plan?.name ?? "" })}</h1>
          <p className="mt-3 text-muted">{t("checkout.successText", { date: formatDateTime(entitlements.expiresAt, lc, false) })}</p>
        </>
      ) : (
        <>
          <Clock className="mx-auto size-14 text-muted" aria-hidden />
          <h1 className="mt-6 text-3xl font-bold">{t("checkout.pendingTitle")}</h1>
          <p className="mt-3 text-muted">{t("checkout.pendingText")}</p>
        </>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/dashboard">{t("checkout.startUsing")}</ButtonLink>
        <ButtonLink href="/account" variant="outline">
          {t("nav.myAccount")}
        </ButtonLink>
      </div>
    </div>
  );
}
