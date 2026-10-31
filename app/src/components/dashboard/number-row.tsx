"use client";

import { saveNumberAction } from "@/app/actions/dashboard/numbers";
import { HiddenFields, useRefreshingAction } from "@/components/dashboard/client-kit";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { useT } from "@/lib/i18n/client";

/** The editable settings of one phone number (inbound agent, label, outbound, daily cap). */
export function NumberSettingsForm({
  wid,
  number,
  agents,
  canEdit,
}: {
  wid: number;
  number: { id: number; label: string; inboundAgentId: number | null; outboundEnabled: boolean; dailyDialCap: number };
  agents: Array<{ id: number; name: string; compatible: boolean }>;
  canEdit: boolean;
}) {
  const t = useT();
  const [state, action, pending] = useRefreshingAction(saveNumberAction);
  const id = `n${number.id}`;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.6fr)_auto] lg:items-end">
      <HiddenFields fields={{ wid, number_id: number.id }} />
      <Field label={t("dash.numbers.inboundAgent")} htmlFor={`${id}-agent`}>
        <Select id={`${id}-agent`} name="inbound_agent_id" defaultValue={number.inboundAgentId ? String(number.inboundAgentId) : ""} disabled={!canEdit}>
          <option value="">{t("dash.numbers.noAgent")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id} disabled={!a.compatible}>
              {a.compatible ? a.name : t("dash.numbers.agentOtherProvider", { name: a.name })}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("dash.numbers.label")} htmlFor={`${id}-label`}>
        <Input id={`${id}-label`} name="label" defaultValue={number.label} maxLength={120} disabled={!canEdit} placeholder={t("dash.numbers.labelPlaceholder")} />
      </Field>
      <Field label={t("dash.numbers.dailyCap")} htmlFor={`${id}-cap`}>
        <Input id={`${id}-cap`} name="daily_dial_cap" type="number" min={1} max={10000} defaultValue={number.dailyDialCap} disabled={!canEdit} dir="ltr" />
      </Field>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-1">
        {canEdit ? (
          <Button type="submit" size="md" disabled={pending} aria-busy={pending}>
            {t("dash.numbers.save")}
          </Button>
        ) : null}
      </div>
      <Switch name="outbound_enabled" defaultChecked={number.outboundEnabled} disabled={!canEdit} label={t("dash.numbers.outbound")} description={t("dash.numbers.outboundHint")} className="sm:col-span-2 lg:col-span-4" />
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2 lg:col-span-4 dark:text-red-400">
          {state.error}
        </p>
      ) : state.success ? (
        <p role="status" className="text-sm text-emerald-700 sm:col-span-2 lg:col-span-4 dark:text-emerald-400">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
