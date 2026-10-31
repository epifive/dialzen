"use client";

import { useActionState, useId } from "react";
import { useRouter } from "next/navigation";
import { createWorkspaceAction, deleteWorkspaceAction, inviteMemberAction, saveBrandingAction, saveWorkspaceSettingsAction } from "@/app/actions/dashboard/workspace";
import { initialFormState, type FormState } from "@/app/actions/types";
import { Alert } from "@/components/ui/alert";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { canonicalTimeZone } from "@/voice/normalize";
import { ASSIGNABLE_ROLES, type AssignableRole } from "@/voice/types";
import { useRefreshingAction } from "./client-kit";
import { CopyField } from "./copy";

/** Time zone select; the browser's zone is preselected for new workspaces. */
function TimeZoneSelect({ id, value, zones }: { id: string; value?: string; zones: string[] }) {
  const list = value && !zones.includes(value) ? [value, ...zones] : zones;
  return (
    <Select
      id={id}
      name="timezone"
      defaultValue={value}
      ref={(el) => {
        if (el && !value) {
          const browser = canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
          if (browser && list.includes(browser)) el.value = browser;
        }
      }}
      className="max-w-sm"
    >
      {list.map((z) => (
        <option key={z} value={z}>
          {z.replaceAll("_", " ")}
        </option>
      ))}
    </Select>
  );
}

export function NewWorkspaceForm({ zones }: { zones: string[] }) {
  const t = useT();
  const uid = useId();
  const [state, action] = useActionState(createWorkspaceAction, initialFormState);
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      <Field label={t("dash.ws.name")} htmlFor={`${uid}-name`} hint={t("dash.ws.nameHint")}>
        <Input id={`${uid}-name`} name="name" required maxLength={120} dir="auto" placeholder={t("dash.ws.namePlaceholder")} autoComplete="off" />
      </Field>
      <Field label={t("dash.ws.timezone")} htmlFor={`${uid}-tz`} hint={t("dash.ws.timezoneHint")}>
        <TimeZoneSelect id={`${uid}-tz`} zones={zones} />
      </Field>
      <SubmitButton pendingText={t("dash.ws.creating")}>{t("dash.ws.create")}</SubmitButton>
    </form>
  );
}

export function WorkspaceSettingsForm({
  workspaceId,
  values,
  zones,
  countries,
  languages,
  canEdit,
}: {
  workspaceId: number;
  values: { name: string; timezone: string; weekStart: 1 | 7; defaultCountry: string; defaultLanguage: string };
  zones: string[];
  /** [ISO, English name]. */
  countries: Array<[string, string]>;
  /** [BCP-47 tag, English name]. */
  languages: Array<[string, string]>;
  canEdit: boolean;
}) {
  const t = useT();
  const uid = useId();
  // Refresh after saving: the form resets to its default values, which must be the saved ones.
  const [state, action] = useRefreshingAction(saveWorkspaceSettingsAction);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <fieldset disabled={!canEdit} className="space-y-5">
        <Field label={t("dash.ws.name")} htmlFor={`${uid}-name`}>
          <Input id={`${uid}-name`} name="name" required maxLength={120} dir="auto" defaultValue={values.name} className="max-w-sm" />
        </Field>
        <Field label={t("dash.ws.timezone")} htmlFor={`${uid}-tz`} hint={t("dash.ws.timezoneHint")}>
          <TimeZoneSelect id={`${uid}-tz`} value={values.timezone} zones={zones} />
        </Field>
        <Field label={t("dash.settings.defaultCountry")} htmlFor={`${uid}-country`} hint={t("dash.settings.defaultCountryHint")}>
          <Select id={`${uid}-country`} name="default_country" defaultValue={values.defaultCountry} className="max-w-sm">
            {countries.map(([iso, name]) => (
              <option key={iso} value={iso}>
                {name} ({iso})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.settings.defaultLanguage")} htmlFor={`${uid}-lang`} hint={t("dash.settings.defaultLanguageHint")}>
          <Select id={`${uid}-lang`} name="default_language" defaultValue={values.defaultLanguage} className="max-w-sm">
            {languages.map(([tag, name]) => (
              <option key={tag} value={tag}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.settings.weekStart")} htmlFor={`${uid}-week`}>
          <Select id={`${uid}-week`} name="week_start" defaultValue={String(values.weekStart)} className="max-w-xs">
            <option value="1">{t("dash.settings.monday")}</option>
            <option value="7">{t("dash.settings.sunday")}</option>
          </Select>
        </Field>
      </fieldset>
      {canEdit ? <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.settings.save")}</SubmitButton> : null}
    </form>
  );
}

/** White-label branding of the workspace's web widget and notification emails (plan option). */
export function BrandingForm({ workspaceId, values, canEdit }: { workspaceId: number; values: { companyName: string; logo: string; color: string }; canEdit: boolean }) {
  const t = useT();
  const uid = useId();
  const [state, action] = useRefreshingAction(saveBrandingAction);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t("dash.branding.company")} htmlFor={`${uid}-company`} hint={t("dash.branding.companyHint")}>
          <Input id={`${uid}-company`} name="company" maxLength={120} defaultValue={values.companyName} dir="auto" />
        </Field>
        <Field label={t("dash.branding.logo")} htmlFor={`${uid}-logo`} hint={t("dash.branding.logoHint")}>
          <Input id={`${uid}-logo`} name="logo" type="url" maxLength={500} defaultValue={values.logo} placeholder="https://…/logo.png" dir="ltr" />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox name="use_color" label={t("dash.branding.useColor")} defaultChecked={Boolean(values.color)} />
          <div className="mt-2 flex items-center gap-3">
            <input type="color" name="color" defaultValue={values.color || "#a21caf"} aria-label={t("dash.branding.color")} className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1" />
            <span className="text-xs text-muted">{t("dash.branding.colorHint")}</span>
          </div>
        </div>
      </fieldset>
      {canEdit ? <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.settings.save")}</SubmitButton> : null}
    </form>
  );
}

/** Danger zone of the Settings page: type the name, then the workspace and everything in it is deleted. */
export function DeleteWorkspaceForm({ workspaceId, name }: { workspaceId: number; name: string }) {
  const t = useT();
  const uid = useId();
  const [state, action] = useActionState(deleteWorkspaceAction, initialFormState);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(t("dash.settings.deleteText"))) e.preventDefault();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <Field label={t("dash.settings.deleteConfirm")} htmlFor={`${uid}-confirm`}>
        <Input id={`${uid}-confirm`} name="confirm" required maxLength={120} dir="auto" autoComplete="off" placeholder={name} className="max-w-sm" />
      </Field>
      <SubmitButton variant="danger" pendingText={t("dash.settings.deleting")}>
        {t("dash.settings.delete")}
      </SubmitButton>
    </form>
  );
}

export function InviteForm({ workspaceId, roles, disabled }: { workspaceId: number; roles: readonly AssignableRole[]; disabled: boolean }) {
  const t = useT();
  const uid = useId();
  const router = useRouter();
  const [state, action] = useActionState(async (prev: FormState & { link?: string }, fd: FormData) => {
    const result = await inviteMemberAction(prev, fd);
    // Show the new invite in the "Pending invites" list.
    if (result.link) router.refresh();
    return result;
  }, initialFormState as FormState & { link?: string });
  return (
    <div className="space-y-4">
      {state.link ? (
        <Alert tone="success" title={state.success}>
          <p className="mb-3">{t("dash.team.linkHint")}</p>
          <CopyField value={state.link} label={t("dash.team.link")} />
        </Alert>
      ) : (
        <FormMessage state={state} />
      )}
      <form action={action}>
        <input type="hidden" name="wid" value={workspaceId} />
        <fieldset disabled={disabled} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label={t("dash.team.email")} htmlFor={`${uid}-email`} className="min-w-0 flex-1">
            <Input id={`${uid}-email`} name="email" type="email" required placeholder="name@example.com" dir="ltr" />
          </Field>
          <Field label={t("dash.team.role")} htmlFor={`${uid}-role`}>
            <Select id={`${uid}-role`} name="role" defaultValue="editor">
              {ASSIGNABLE_ROLES.filter((r) => roles.includes(r)).map((r) => (
                <option key={r} value={r}>
                  {t(`dash.role.${r}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <SubmitButton pendingText={t("dash.team.inviting")}>{t("dash.team.invite")}</SubmitButton>
        </fieldset>
      </form>
    </div>
  );
}
