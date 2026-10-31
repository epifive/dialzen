"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createApiKeyAction, type ApiKeyState } from "@/app/actions/dashboard/apikeys";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { CopyField } from "./copy";

export function CreateApiKeyForm({ workspaceId }: { workspaceId: number }) {
  const t = useT();
  const router = useRouter();
  const [state, action] = useActionState(async (prev: ApiKeyState, fd: FormData) => {
    const result = await createApiKeyAction(prev, fd);
    if (result.key) router.refresh();
    return result;
  }, {} as ApiKeyState);
  return (
    <div className="space-y-4">
      {state.key ? (
        <Alert tone="success" title={t("dash.api.created")}>
          <p className="mb-3">{t("dash.api.copyOnce")}</p>
          <CopyField value={state.key} label={t("dash.api.key")} />
        </Alert>
      ) : null}
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="wid" value={workspaceId} />
        <Input name="name" required maxLength={120} dir="auto" placeholder={t("dash.api.namePlaceholder")} aria-label={t("dash.api.name")} className="sm:max-w-xs" />
        <SubmitButton pendingText={t("dash.api.creating")}>{t("dash.api.create")}</SubmitButton>
      </form>
    </div>
  );
}
