import type { Metadata } from "next";
import { acceptInviteAction } from "@/app/actions/dashboard/workspace";
import { ActionButton } from "@/components/dashboard/actions";
import { AuthCard } from "@/components/site/auth-card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import type { MessageKey } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { getSiteContext } from "@/lib/site";
import { findInvite, getWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("invite.title"), robots: { index: false } };
}

/** Invite link: shows the workspace and joins it after sign-in (the account email must match). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [{ user, settings }, t] = await Promise.all([getSiteContext(), getT()]);
  const invite = await findInvite(token);
  const workspace = invite ? await getWorkspace(invite.workspaceId) : undefined;
  if (!invite || !workspace) {
    return (
      <AuthCard title={t("invite.invalidTitle")} subtitle={t("invite.invalidText")}>
        <ButtonLink href="/">{t("notFound.home")}</ButtonLink>
      </AuthCard>
    );
  }
  const next = encodeURIComponent(`/invite/${token}`);
  const role = t(`dash.role.${invite.role}` as MessageKey);
  return (
    <AuthCard title={t("invite.title")} subtitle={t("invite.text", { workspace: workspace.name, role, site: settings.site_name })}>
      {user ? (
        user.email.toLowerCase() === invite.email ? (
          <ActionButton action={acceptInviteAction} fields={{ token }} variant="primary" size="md">
            {t("invite.join", { workspace: workspace.name })}
          </ActionButton>
        ) : (
          <Alert tone="warning">{t("invite.wrongAccount", { email: invite.email })}</Alert>
        )
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">{t("invite.signInFirst", { email: invite.email })}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/login?next=${next}`}>{t("auth.signIn")}</ButtonLink>
            {settings.registration_enabled ? (
              <ButtonLink href={`/register?next=${next}`} variant="outline">
                {t("auth.createAccount")}
              </ButtonLink>
            ) : null}
          </div>
        </div>
      )}
    </AuthCard>
  );
}
