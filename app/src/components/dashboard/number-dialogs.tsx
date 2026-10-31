"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, ShoppingCart, X } from "lucide-react";
import { buyNumberAction, importNumberAction } from "@/app/actions/dashboard/numbers";
import { HiddenFields, useRefreshingAction } from "@/components/dashboard/client-kit";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Hint, Input, Select } from "@/components/ui/field";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Carrier, ProviderId } from "@/voice/types";

/** Buy / import dialogs of the Numbers page (native <dialog>, works with the keyboard and in RTL). */

export interface NumberProviderOption {
  id: ProviderId;
  name: string;
  purchase: boolean;
  countries: string[];
  imports: Carrier[];
}

function Dialog({ open, onClose, title, text, children }: { open: boolean; onClose: () => void; title: string; text: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-muted">{text}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("dash.numbers.close")} title={t("dash.numbers.close")} className="rounded-lg p-1.5 text-muted hover:bg-primary-soft hover:text-ink">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

const CARRIER_KEY: Record<Carrier, MessageKey> = {
  retell: "dash.numbers.carrier.retell",
  twilio: "dash.numbers.carrier.twilio",
  sip: "dash.numbers.carrier.sip",
  exotel: "dash.numbers.carrier.exotel",
  telnyx: "dash.numbers.carrier.telnyx",
  plivo: "dash.numbers.carrier.plivo",
  simulated: "dash.numbers.carrier.simulated",
};

export function BuyNumberDialog({ wid, providers, rentalLabel, disabled, openOnLoad = false }: { wid: number; providers: NumberProviderOption[]; rentalLabel: string; disabled: boolean; openOnLoad?: boolean }) {
  const t = useT();
  const sellers = providers.filter((p) => p.purchase);
  const [open, setOpen] = useState(openOnLoad);
  const [provider, setProvider] = useState(sellers[0]?.id ?? "");
  const [tollFree, setTollFree] = useState(false);
  const [state, action, pending] = useRefreshingAction(buyNumberAction);
  const countries = sellers.find((p) => p.id === provider)?.countries ?? ["US", "CA"];
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={disabled}>
        <ShoppingCart aria-hidden />
        {t("dash.numbers.buy")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("dash.numbers.buyTitle")} text={t("dash.numbers.buyText")}>
        {sellers.length ? (
          <form action={action} className="space-y-4">
            <HiddenFields fields={{ wid }} />
            <Field label={t("dash.numbers.provider")} htmlFor="buy-provider">
              <Select id="buy-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
                {sellers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("dash.numbers.country")} htmlFor="buy-country">
                <Select id="buy-country" name="country" defaultValue={countries[0]}>
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {t(c === "CA" ? "dash.numbers.countryCA" : "dash.numbers.countryUS")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("dash.numbers.areaCode")} htmlFor="buy-area">
                <Input id="buy-area" name="area_code" inputMode="numeric" pattern="\d{3}" maxLength={3} placeholder="415" dir="ltr" required={!tollFree} disabled={tollFree} />
              </Field>
            </div>
            <Hint className="-mt-2">{t("dash.numbers.areaCodeHint")}</Hint>
            <Checkbox name="toll_free" label={t("dash.numbers.tollFree")} checked={tollFree} onChange={(e) => setTollFree(e.target.checked)} />
            <Field label={t("dash.numbers.label")} htmlFor="buy-label" hint={t("dash.numbers.labelHint")}>
              <Input id="buy-label" name="label" maxLength={120} placeholder={t("dash.numbers.labelPlaceholder")} />
            </Field>
            {rentalLabel ? <Alert tone="info">{t("dash.numbers.rentalNote", { price: rentalLabel })}</Alert> : null}
            {state.error ? <Alert tone="error">{state.error}</Alert> : null}
            {state.success ? <Alert tone="success">{state.success}</Alert> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {state.success ? t("dash.numbers.close") : t("dash.numbers.cancel")}
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? t("dash.numbers.buying") : t("dash.numbers.buySubmit")}
              </Button>
            </div>
          </form>
        ) : (
          <Alert tone="warning">{t("dash.numbers.noPurchase")}</Alert>
        )}
      </Dialog>
    </>
  );
}

export function ImportNumberDialog({ wid, providers, disabled, openOnLoad = false }: { wid: number; providers: NumberProviderOption[]; disabled: boolean; openOnLoad?: boolean }) {
  const t = useT();
  const importers = providers.filter((p) => p.imports.length);
  const [open, setOpen] = useState(openOnLoad);
  const [provider, setProvider] = useState(importers[0]?.id ?? "");
  const carriers: Carrier[] = (importers.find((p) => p.id === provider)?.imports ?? []).filter((c) => c !== "retell");
  const [carrier, setCarrier] = useState<Carrier>(carriers[0] ?? "sip");
  const current = carriers.includes(carrier) ? carrier : (carriers[0] ?? "sip");
  const [state, action, pending] = useRefreshingAction(importNumberAction);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <Download aria-hidden />
        {t("dash.numbers.import")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("dash.numbers.importTitle")} text={t("dash.numbers.importText")}>
        {importers.length ? (
          <form action={action} className="space-y-4" autoComplete="off">
            <HiddenFields fields={{ wid }} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("dash.numbers.provider")} htmlFor="imp-provider">
                <Select id="imp-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
                  {importers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("dash.numbers.carrier")} htmlFor="imp-carrier">
                <Select id="imp-carrier" name="carrier" value={current} onChange={(e) => setCarrier(e.target.value as Carrier)}>
                  {carriers.map((c) => (
                    <option key={c} value={c}>
                      {t(CARRIER_KEY[c])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("dash.numbers.number")} htmlFor="imp-number" hint={t("dash.numbers.numberHint")}>
              <Input id="imp-number" name="e164" type="tel" required placeholder="+14155550123" dir="ltr" maxLength={20} />
            </Field>
            <Field label={t("dash.numbers.label")} htmlFor="imp-label">
              <Input id="imp-label" name="label" maxLength={120} placeholder={t("dash.numbers.labelPlaceholder")} />
            </Field>
            {current === "twilio" ? (
              <>
                <Field label={t("dash.numbers.twilioSid")} htmlFor="imp-sid">
                  <Input id="imp-sid" name="twilio_sid" required placeholder="AC…" dir="ltr" autoComplete="off" />
                </Field>
                <Field label={t("dash.numbers.twilioToken")} htmlFor="imp-token" hint={t("dash.numbers.twilioHint")}>
                  <Input id="imp-token" name="twilio_token" type="password" required dir="ltr" autoComplete="new-password" />
                </Field>
              </>
            ) : current !== "simulated" ? (
              <>
                <Field label={t("dash.numbers.sipUri")} htmlFor="imp-sip" hint={provider === "retell" ? t("dash.numbers.sipUriHintRetell") : t("dash.numbers.sipUriHint")}>
                  <Input id="imp-sip" name="sip_uri" required placeholder="yourtrunk.pstn.twilio.com" dir="ltr" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("dash.numbers.sipUser")} htmlFor="imp-user">
                    <Input id="imp-user" name="sip_user" dir="ltr" autoComplete="off" />
                  </Field>
                  <Field label={t("dash.numbers.sipPass")} htmlFor="imp-pass">
                    <Input id="imp-pass" name="sip_pass" type="password" dir="ltr" autoComplete="new-password" />
                  </Field>
                </div>
                <Hint className="-mt-2">{t("dash.numbers.sipOptional")}</Hint>
              </>
            ) : null}
            {state.error ? <Alert tone="error">{state.error}</Alert> : null}
            {state.success ? <Alert tone="success">{state.success}</Alert> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {state.success ? t("dash.numbers.close") : t("dash.numbers.cancel")}
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                {pending ? t("dash.numbers.importing") : t("dash.numbers.importSubmit")}
              </Button>
            </div>
          </form>
        ) : (
          <Alert tone="warning">{t("dash.numbers.noImport")}</Alert>
        )}
      </Dialog>
    </>
  );
}
