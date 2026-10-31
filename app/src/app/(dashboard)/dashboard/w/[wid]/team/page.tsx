import type { Metadata } from "next";
import { Crown, LogOut, MailPlus, Trash2 } from "lucide-react";
import { removeMemberAction, revokeInviteAction } from "@/app/actions/dashboard/workspace";
import { ActionButton } from "@/components/dashboard/actions";
import { Initial } from "@/components/dashboard/kit";
import { RoleForm, TransferOwnershipForm } from "@/components/dashboard/team-forms";
import { DashHeader, DTable, DTd, DTh, Meter, Panel } from "@/components/dashboard/ui";
import { InviteForm } from "@/components/dashboard/workspace-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { memberActivity } from "@/lib/audit";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/dash-format";
import { requireWorkspace } from "@/lib/dashboard";
import { plural, type MessageKey } from "@/lib/i18n/messages";
import { getLocale, getT } from "@/lib/i18n/server";
import { atLimit } from "@/lib/plans";
import { countSeats, getInvites, getMembers, getWorkspaceEntitlements } from "@/lib/workspaces";
import { canManageMember, roleCan } from "@/voice/normalize";
import { ASSIGNABLE_ROLES, WORKSPACE_ROLES } from "@/voice/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("dash.nav.team") };
}

/** Members (roles, removal, ownership transfer), invites, seats and what each role can do. */
export default async function TeamPage({ params }: { params: Promise<{ wid: string }> }) {
  const { user, workspace, role } = await requireWorkspace((await params).wid);
  const [t, locale, members, invites, entitlements, seats, activity] = await Promise.all([
    getT(),
    getLocale(),
    getMembers(workspace.id),
    getInvites(workspace.id),
    getWorkspaceEntitlements(workspace),
    countSeats(workspace.ownerId),
    memberActivity(workspace.id),
  ]);
  const lc = locale.code;
  const canManage = roleCan(role, "members.manage");
  const full = atLimit(seats, entitlements.maxMembers);
  const roles = ASSIGNABLE_ROLES.filter((r) => canManageMember(role, "viewer", r));
  const isOwner = role === "owner";
  const others = members.filter((m) => m.userId !== user.id);

  return (
    <div className="space-y-6">
      <DashHeader title={t("dash.nav.team")} description={t("dash.team.subtitle")} />

      <Panel>
        <Meter
          label={t("dash.home.meterSeats")}
          used={seats}
          limit={entitlements.maxMembers}
          usedText={formatNumber(seats, lc)}
          limitText={entitlements.maxMembers >= 0 ? formatNumber(entitlements.maxMembers, lc) : t("pricing.unlimited")}
        />
        <p className="mt-2 text-xs text-muted">{t("dash.team.seatsHint")}</p>
      </Panel>

      {canManage ? (
        <>
          {full ? (
            <Alert tone="warning" title={t("dash.team.fullTitle")}>
              <p>{t("dash.team.fullText")}</p>
              {workspace.ownerId === user.id ? (
                <ButtonLink href="/pricing" size="sm" className="mt-3">
                  <Crown aria-hidden />
                  {t("dash.banner.cta")}
                </ButtonLink>
              ) : null}
            </Alert>
          ) : null}
          {/* Stays mounted when the last seat was just used, so the new invite link remains visible. */}
          <Panel title={t("dash.team.inviteTitle")} description={t("dash.team.inviteText")}>
            <InviteForm workspaceId={workspace.id} roles={roles} disabled={full} />
          </Panel>
        </>
      ) : null}

      <Panel title={t("dash.team.members")} description={t("dash.team.membersHint")} padded={false}>
        <DTable minWidth={720} label={t("dash.team.members")}>
          <thead>
            <tr>
              <DTh>{t("dash.team.member")}</DTh>
              <DTh>{t("dash.team.role")}</DTh>
              <DTh>{t("dash.team.activity")}</DTh>
              <DTh>{t("dash.team.joined")}</DTh>
              <DTh className="text-end">
                <span className="sr-only">{t("dash.api.actions")}</span>
              </DTh>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const a = activity.get(m.userId);
              const editable = m.userId !== user.id && m.role !== "owner" && canManageMember(role, m.role);
              const options = ASSIGNABLE_ROLES.filter((r) => canManageMember(role, m.role, r));
              return (
                <tr key={m.userId}>
                  <DTd>
                    <div className="flex items-center gap-3">
                      <Initial name={m.name || m.email} />
                      <div className="min-w-0">
                        <p dir="auto" className="truncate font-medium">
                          {m.name}
                          {m.userId === user.id ? <span className="ms-1 text-xs font-normal text-muted">{t("dash.team.you")}</span> : null}
                        </p>
                        <p dir="ltr" className="truncate text-start text-xs text-muted">
                          {m.email}
                        </p>
                      </div>
                    </div>
                  </DTd>
                  <DTd>
                    {editable && m.role !== "owner" ? (
                      <RoleForm workspaceId={workspace.id} userId={m.userId} role={m.role} roles={options} label={t("dash.team.roleOf", { name: m.name })} />
                    ) : (
                      <Badge tone={m.role === "owner" ? "primary" : "neutral"}>{t(`dash.role.${m.role}` as MessageKey)}</Badge>
                    )}
                  </DTd>
                  <DTd className="text-xs text-muted">
                    <p>{plural(t, "dash.team.activityActions", a?.actions30 ?? 0, { n: formatNumber(a?.actions30 ?? 0, lc) })}</p>
                    {a?.lastActiveAt ? <p>{t("dash.team.lastActive", { when: formatRelative(a.lastActiveAt, lc) })}</p> : null}
                  </DTd>
                  <DTd className="text-muted">{formatDateTime(m.joinedAt, lc, false)}</DTd>
                  <DTd className="text-end">
                    {m.userId === user.id && m.role !== "owner" ? (
                      <ActionButton action={removeMemberAction} fields={{ wid: workspace.id, user_id: m.userId }} variant="ghost" confirmText={t("dash.team.leaveConfirm", { workspace: workspace.name })} className="items-end">
                        <LogOut aria-hidden />
                        {t("dash.team.leave")}
                      </ActionButton>
                    ) : editable ? (
                      <ActionButton action={removeMemberAction} fields={{ wid: workspace.id, user_id: m.userId }} variant="ghost" confirmText={t("dash.team.removeConfirm", { name: m.name })} className="items-end">
                        <Trash2 aria-hidden />
                        {t("dash.team.remove")}
                      </ActionButton>
                    ) : null}
                  </DTd>
                </tr>
              );
            })}
          </tbody>
        </DTable>
      </Panel>

      {invites.length ? (
        <Panel title={t("dash.team.invites")} padded={false}>
          <ul className="divide-y divide-line">
            {invites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <MailPlus className="size-5 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p dir="ltr" className="truncate text-start text-sm font-medium">
                    {inv.email}
                  </p>
                  <p className="text-xs text-muted">
                    {t(`dash.role.${inv.role}` as MessageKey)} · {t("dash.team.expires", { date: formatDateTime(inv.expiresAt, lc, false) })}
                  </p>
                </div>
                {canManage ? (
                  <ActionButton action={revokeInviteAction} fields={{ wid: workspace.id, invite_id: inv.id }} variant="ghost" confirmText={t("dash.team.revokeConfirm", { email: inv.email })}>
                    {t("dash.team.revoke")}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={t("dash.team.rolesTitle")} description={t("dash.team.rolesText")}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...WORKSPACE_ROLES].reverse().map((r) => (
            <div key={r} className="rounded-lg border border-line bg-paper p-4">
              <dt>
                <Badge tone={r === "owner" ? "primary" : "neutral"}>{t(`dash.role.${r}` as MessageKey)}</Badge>
              </dt>
              <dd className="mt-2 text-sm text-muted">{t(`dash.team.roleText.${r}` as MessageKey)}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      {isOwner && !workspace.isPersonal && others.length ? (
        <Panel title={t("dash.team.transferTitle")} description={t("dash.team.transferText")}>
          <TransferOwnershipForm workspaceId={workspace.id} members={others.map((m) => ({ userId: m.userId, name: m.name, email: m.email }))} />
        </Panel>
      ) : null}
    </div>
  );
}
