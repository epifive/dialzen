"use client";

import { useId } from "react";
import { deleteProviderKeysAction, saveProviderKeysAction, testProviderKeysAction } from "@/app/actions/dashboard/provider-keys";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { useRefreshingAction } from "./client-kit";
import { CopyField } from "./copy";

export interface ProviderKeysCardProps {
  workspaceId: number;
  provider: "elevenlabs" | "retell";
  name: string;
  webhookUrl: string;
  canEdit: boolean;
  saved: { apiKeyLast4: string; hasWebhookSecret: boolean; status: "active" | "error" | "disabled"; lastCheckedAt: string | null; lastError: string | null } | null;
  /** Formatted date of the last connection test. */
  checkedLabel: string;
}

/** Removes keys saved earlier that the owner's plan no longer uses (their agents move to the site's keys). */
export function RemoveSavedKeysForm({ workspaceId, provider, name }: { workspaceId: number; provider: "elevenlabs" | "retell"; name: string }) {
  const t = useT();
  const [state, remove] = useRefreshingAction(deleteProviderKeysAction);
  return (
    <form
      action={remove}
      onSubmit={(e) => {
        if (!window.confirm(t("dash.byo.removeConfirm"))) e.preventDefault();
      }}
      className="space-y-2"
      data-remove-saved-keys={provider}
    >
      <input type="hidden" name="wid" value={workspaceId} />
      <input type="hidden" name="provider" value={provider} />
      <FormMessage state={state} />
      <SubmitButton variant="outline" size="sm" pendingText={t("dash.byo.removing")}>
        {t("dash.byo.removeSaved", { name })}
      </SubmitButton>
    </form>
  );
}

/** One provider's own keys (Settings → Voice provider keys): save / replace, test, remove. Secrets are never sent back to the browser. */
export function ProviderKeysCard({ workspaceId, provider, name, webhookUrl, canEdit, saved, checkedLabel }: ProviderKeysCardProps) {
  const t = useT();
  const uid = useId();
  const [saveState, save] = useRefreshingAction(saveProviderKeysAction);
  const [testState, test] = useRefreshingAction(testProviderKeysAction);
  const [deleteState, remove] = useRefreshingAction(deleteProviderKeysAction);
  return (
    <div className="rounded-xl border border-line p-4" data-provider-keys={provider}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{name}</h3>
        {saved ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={saved.status === "error" ? "danger" : "success"}>{saved.status === "error" ? t("dash.byo.statusError") : t("dash.byo.statusSaved")}</Badge>
            <span className="text-xs text-muted" dir="ltr">
              {t("dash.byo.savedKey", { last4: saved.apiKeyLast4 || "????" })}
            </span>
          </span>
        ) : (
          <Badge>{t("dash.byo.statusNone")}</Badge>
        )}
      </div>
      {saved?.lastError ? <p className="mb-3 text-sm break-words text-red-700 dark:text-red-400">{t("dash.byo.lastError", { error: saved.lastError })}</p> : null}
      {saved && checkedLabel ? <p className="mb-3 text-xs text-muted">{t("dash.byo.checkedAt", { date: checkedLabel })}</p> : null}

      <form action={save} className="space-y-3">
        <input type="hidden" name="wid" value={workspaceId} />
        <input type="hidden" name="provider" value={provider} />
        <FormMessage state={saveState} />
        <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-2">
          <Field label={t("dash.byo.apiKey")} htmlFor={`${uid}-key`} hint={saved ? t("dash.byo.keepHint") : undefined}>
            <Input id={`${uid}-key`} name="api_key" type="password" autoComplete="off" maxLength={500} required={!saved} placeholder={saved ? `••••${saved.apiKeyLast4}` : ""} dir="ltr" />
          </Field>
          {provider === "elevenlabs" ? (
            <Field label={t("dash.byo.webhookSecret")} htmlFor={`${uid}-secret`} hint={saved?.hasWebhookSecret ? t("dash.byo.keepHint") : t("dash.byo.webhookSecretHint")}>
              <Input id={`${uid}-secret`} name="webhook_secret" type="password" autoComplete="off" maxLength={500} placeholder={saved?.hasWebhookSecret ? "••••••••" : ""} dir="ltr" />
            </Field>
          ) : null}
        </fieldset>
        <div>
          <p className="mb-1 text-sm font-medium">{provider === "elevenlabs" ? t("dash.byo.webhookElevenlabs") : t("dash.byo.webhookRetell")}</p>
          <CopyField value={webhookUrl} label={t("dash.byo.webhookUrl")} />
        </div>
        {canEdit ? <SubmitButton pendingText={t("dash.byo.saving")}>{saved ? t("dash.byo.replace") : t("dash.byo.save")}</SubmitButton> : null}
      </form>

      {saved && canEdit ? (
        <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-line pt-3">
          <form action={test} className="space-y-2">
            <input type="hidden" name="wid" value={workspaceId} />
            <input type="hidden" name="provider" value={provider} />
            <FormMessage state={testState} />
            <SubmitButton variant="outline" size="sm" pendingText={t("dash.byo.testing")}>
              {t("dash.byo.test")}
            </SubmitButton>
          </form>
          <form
            action={remove}
            onSubmit={(e) => {
              if (!window.confirm(t("dash.byo.removeConfirm"))) e.preventDefault();
            }}
            className="space-y-2"
          >
            <input type="hidden" name="wid" value={workspaceId} />
            <input type="hidden" name="provider" value={provider} />
            <FormMessage state={deleteState} />
            <SubmitButton variant="danger" size="sm" pendingText={t("dash.byo.removing")}>
              {t("dash.byo.remove")}
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}
