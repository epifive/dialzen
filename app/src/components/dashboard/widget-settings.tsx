"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { saveAgentAction } from "@/app/actions/dashboard/agents";
import { useRefreshingAction } from "@/components/dashboard/client-kit";
import { CopyField } from "@/components/dashboard/copy";
import { Alert } from "@/components/ui/alert";
import { Field, Hint, Input, Select, Switch, Textarea } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import type { WidgetSettings } from "@/voice/types";

/** The Widget tab: switch, allowed sites, look, and the embed code. */
export function WidgetSettingsForm({
  wid,
  agentId,
  widget,
  widgetKey,
  origin,
  platformColor,
  simulated,
  readOnly,
}: {
  wid: number;
  agentId: number;
  widget: WidgetSettings;
  widgetKey: string;
  origin: string;
  platformColor: string;
  simulated: boolean;
  readOnly: boolean;
}) {
  const t = useT();
  const [state, action] = useRefreshingAction(saveAgentAction);
  const [title, setTitle] = useState(widget.title);
  const [useColor, setUseColor] = useState(Boolean(widget.color));
  const [color, setColor] = useState(widget.color || platformColor);
  const [position, setPosition] = useState(widget.position);
  const snippet = `<script async src="${origin}/dz-widget.js" data-agent="${widgetKey}"></script>`;
  const shown = useColor ? color : platformColor;
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="wid" value={wid} />
      <input type="hidden" name="agent_id" value={agentId} />
      <input type="hidden" name="section" value="widget" />
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="rounded-xl border border-line p-4">
          <Switch name="enabled" defaultChecked={widget.enabled} label={t("dash.widget.enable")} description={t("dash.widget.enableHint")} />
        </div>
        {simulated ? <Alert tone="info">{t("dash.widget.simulatedNote")}</Alert> : null}
        <Field label={t("dash.widget.domains")} htmlFor="w-domains" hint={t("dash.widget.domainsHint")}>
          <Textarea id="w-domains" name="allowed_domains" defaultValue={widget.allowedDomains.join("\n")} rows={3} className="min-h-20 font-mono text-[13px]" dir="ltr" placeholder={"example.com\n*.example.com"} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("dash.widget.title")} htmlFor="w-title" hint={t("dash.widget.titleHint")}>
            <Input id="w-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} dir="auto" />
          </Field>
          <Field label={t("dash.widget.position")} htmlFor="w-pos">
            <Select id="w-pos" name="position" value={position} onChange={(e) => setPosition(e.target.value as WidgetSettings["position"])}>
              <option value="bottom-right">{t("dash.widget.pos.bottom-right")}</option>
              <option value="bottom-left">{t("dash.widget.pos.bottom-left")}</option>
            </Select>
          </Field>
          <div>
            <Switch name="use_color" checked={useColor} onChange={(e) => setUseColor(e.target.checked)} label={t("dash.widget.ownColor")} />
            <div className="mt-2 flex items-center gap-2">
              <input type="color" name="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!useColor} aria-label={t("dash.widget.color")} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1 disabled:opacity-50" />
              <code dir="ltr" className="text-xs text-muted">
                {shown}
              </code>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{t("dash.widget.preview")}</p>
          <div className={cn("relative h-28 overflow-hidden rounded-xl border border-dashed border-line bg-paper", position === "bottom-left" ? "text-start" : "text-end")}>
            <span className="absolute start-4 top-3 text-xs text-muted">{t("dash.widget.previewSite")}</span>
            <span
              className={cn("absolute bottom-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg", position === "bottom-left" ? "left-4" : "right-4")}
              style={{ background: shown }}
            >
              <Phone className="size-4" aria-hidden />
              <span dir="auto">{title || t("dash.widget.defaultTitle")}</span>
            </span>
          </div>
        </div>
      </fieldset>
      <div>
        <p className="mb-2 text-sm font-medium">{t("dash.widget.embed")}</p>
        <CopyField value={snippet} label={t("dash.widget.embed")} multiline />
        <Hint>{t("dash.widget.embedHint")}</Hint>
      </div>
      <FormMessage state={state} />
      {!readOnly ? <SubmitButton pendingText={t("dash.agent.saving")}>{t("dash.agent.save")}</SubmitButton> : null}
    </form>
  );
}
