"use client";

import { useActionState, useId, useState } from "react";
import { buyCreditsAction, saveWalletOptionsAction } from "@/app/actions/dashboard/billing";
import { initialFormState } from "@/app/actions/types";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

/** Credit pack picker + payment method; bank transfers ask for the transfer reference. */
export function BuyCreditsForm({ workspaceId, packs, gateways, offlineInstructions }: { workspaceId: number; packs: Array<{ amount: number; label: string }>; gateways: string[]; offlineInstructions: string }) {
  const t = useT();
  const uid = useId();
  const [state, action] = useActionState(buyCreditsAction, initialFormState);
  const [amount, setAmount] = useState(String(packs[Math.min(1, packs.length - 1)]?.amount ?? ""));
  const [gateway, setGateway] = useState(gateways[0] ?? "");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("dash.billing.pack")}>
        {packs.map((p) => (
          <label key={p.amount} className={cn("cursor-pointer rounded-xl border px-3 py-3 text-center transition-colors", amount === String(p.amount) ? "border-primary bg-primary-soft text-primary" : "border-line hover:border-primary-line")}>
            <input type="radio" name="amount" value={p.amount} checked={amount === String(p.amount)} onChange={() => setAmount(String(p.amount))} className="sr-only" />
            <span className="font-display text-lg font-bold tabular-nums">
              <bdi>{p.label}</bdi>
            </span>
          </label>
        ))}
      </div>
      <Field label={t("dash.billing.method")} htmlFor={`${uid}-g`}>
        <Select id={`${uid}-g`} name="gateway" value={gateway} onChange={(e) => setGateway(e.target.value)}>
          {gateways.map((g) => (
            <option key={g} value={g}>
              {t(`dash.billing.gateway.${g}` as MessageKey)}
            </option>
          ))}
        </Select>
      </Field>
      {gateway === "offline" ? (
        <>
          <p className="rounded-lg bg-paper p-3 text-xs whitespace-pre-wrap text-muted" dir="auto">
            {offlineInstructions}
          </p>
          <Field label={t("dash.billing.reference")} htmlFor={`${uid}-r`} hint={t("dash.billing.referenceHint")}>
            <Input id={`${uid}-r`} name="reference" required minLength={3} maxLength={190} autoComplete="off" />
          </Field>
        </>
      ) : null}
      <SubmitButton pendingText={t("dash.billing.redirecting")}>{gateway === "offline" ? t("dash.billing.submitTransfer") : t("dash.billing.buy")}</SubmitButton>
    </form>
  );
}

/** Automatic recharge (threshold + pack) and the low-balance alert level. */
export function WalletOptionsForm({ workspaceId, packs, values, cardSaved, stripe, currencySymbol }: { workspaceId: number; packs: Array<{ amount: number; label: string }>; values: { enabled: boolean; threshold: number; amount: number; lowBalance: number }; cardSaved: boolean; stripe: boolean; currencySymbol: string }) {
  const t = useT();
  const uid = useId();
  const [state, action] = useRefreshingAction(saveWalletOptionsAction);
  const [enabled, setEnabled] = useState(values.enabled);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="wid" value={workspaceId} />
      <FormMessage state={state} />
      <Switch name="auto_enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} label={t("dash.billing.auto")} description={stripe ? (cardSaved ? t("dash.billing.autoCard") : t("dash.billing.autoNoCard")) : t("dash.billing.autoReminder")} />
      <div className={cn("grid gap-4 sm:grid-cols-2", !enabled && "opacity-60")}>
        <Field label={t("dash.billing.threshold", { symbol: currencySymbol })} htmlFor={`${uid}-t`}>
          <Input id={`${uid}-t`} name="threshold" type="number" min={0} step="0.01" defaultValue={values.threshold} dir="ltr" disabled={!enabled} />
        </Field>
        <Field label={t("dash.billing.rechargeWith")} htmlFor={`${uid}-a`}>
          <Select id={`${uid}-a`} name="auto_amount" defaultValue={String(values.amount || packs[0]?.amount || "")} disabled={!enabled}>
            {packs.map((p) => (
              <option key={p.amount} value={p.amount}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("dash.billing.lowBalance", { symbol: currencySymbol })} htmlFor={`${uid}-l`} hint={t("dash.billing.lowBalanceHint")}>
        <Input id={`${uid}-l`} name="low_balance" type="number" min={0} step="0.01" defaultValue={values.lowBalance} dir="ltr" className="max-w-48" />
      </Field>
      <SubmitButton pendingText={t("dash.settings.saving")}>{t("dash.billing.saveOptions")}</SubmitButton>
    </form>
  );
}
