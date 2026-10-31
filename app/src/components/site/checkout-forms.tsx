"use client";

import { useActionState, useState } from "react";
import { CreditCard, Landmark, Wallet } from "lucide-react";
import { startCheckout, submitOfflinePayment } from "@/app/actions/billing";
import { initialFormState } from "@/app/actions/types";
import { Field, Input } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const ICONS = { stripe: CreditCard, paypal: Wallet, razorpay: Wallet, offline: Landmark } as const;

export function GatewayForm({
  planId,
  cycle,
  gateways,
  total,
}: {
  planId: number;
  cycle: "monthly" | "yearly";
  gateways: Array<{ id: keyof typeof ICONS; label: string }>;
  total: string;
}) {
  const t = useT();
  const [state, action] = useActionState(startCheckout, initialFormState);
  const [selected, setSelected] = useState(gateways[0]?.id);
  return (
    <form action={action} className="space-y-5">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="cycle" value={cycle} />
      <fieldset>
        <legend className="mb-3 text-sm font-medium">{t("checkout.method")}</legend>
        <div className="space-y-2">
          {gateways.map((g) => {
            const Icon = ICONS[g.id];
            return (
              <label
                key={g.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors",
                  selected === g.id ? "border-primary bg-primary-soft" : "border-line hover:border-primary-line",
                )}
              >
                <input
                  type="radio"
                  name="gateway"
                  value={g.id}
                  checked={selected === g.id}
                  onChange={() => setSelected(g.id)}
                  className="accent-[var(--primary)]"
                />
                <Icon className="size-5 text-muted" aria-hidden />
                <span className="text-sm font-medium">{g.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <SubmitButton className="w-full" size="lg" pendingText={t("checkout.redirecting")}>
        {selected === "offline" ? t("checkout.continue") : t("checkout.pay", { total })}
      </SubmitButton>
    </form>
  );
}

export function OfflinePaymentForm({ planId, cycle }: { planId: number; cycle: "monthly" | "yearly" }) {
  const t = useT();
  const [state, action] = useActionState(submitOfflinePayment, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="plan_id" value={planId} />
      <input type="hidden" name="cycle" value={cycle} />
      <Field label={t("checkout.reference")} htmlFor="reference" hint={t("checkout.referenceHint")}>
        <Input id="reference" name="reference" required maxLength={190} />
      </Field>
      <SubmitButton className="w-full" pendingText={t("checkout.submitting")}>
        {t("checkout.submitTransfer")}
      </SubmitButton>
    </form>
  );
}
