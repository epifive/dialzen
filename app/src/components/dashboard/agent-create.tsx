"use client";

import { useActionState, useState } from "react";
import { BellRing, CalendarCheck, FilePlus2, Headset, House, LifeBuoy, MessageSquareHeart, PackageSearch, Target, type LucideIcon } from "lucide-react";
import { createAgentAction } from "@/app/actions/dashboard/agents";
import { initialFormState } from "@/app/actions/types";
import { Field, Input, Select } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { AGENT_LANGUAGES, providerName } from "@/voice/format";
import type { AgentTemplate } from "@/voice/templates";
import type { ProviderId } from "@/voice/types";

const ICONS: Record<string, LucideIcon> = { Headset, CalendarCheck, Target, LifeBuoy, PackageSearch, BellRing, MessageSquareHeart, House };

/** Template picker of "New agent": eight templates or a blank agent, plus name, language and provider. */
export function AgentCreateForm({
  wid,
  templates,
  providers,
  defaultProvider,
  defaultLanguage,
  initialTemplate,
}: {
  wid: number;
  templates: ReadonlyArray<Pick<AgentTemplate, "id" | "icon" | "direction" | "suggestedTools">>;
  providers: ProviderId[];
  defaultProvider: string;
  defaultLanguage: string;
  initialTemplate: string;
}) {
  const t = useT();
  const [state, action] = useActionState(createAgentAction, initialFormState);
  const [template, setTemplate] = useState(initialTemplate);
  const options = [{ id: "", icon: "", direction: "both" as const, suggestedTools: [] }, ...templates];
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="wid" value={wid} />
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">{t("dash.agents.pickTemplate")}</legend>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {options.map((tpl) => {
            const Icon = tpl.id ? (ICONS[tpl.icon] ?? Headset) : FilePlus2;
            const checked = template === tpl.id;
            return (
              <label
                key={tpl.id || "blank"}
                className={cn(
                  "relative flex cursor-pointer gap-3 rounded-xl border bg-surface p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                  checked ? "border-primary ring-1 ring-primary" : "border-line hover:border-primary-line",
                )}
              >
                <input type="radio" name="template" value={tpl.id} checked={checked} onChange={() => setTemplate(tpl.id)} className="sr-only" />
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", checked ? "bg-primary text-white" : "bg-primary-soft text-primary")}>
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{tpl.id ? t(`dash.tpl.${tpl.id}.name` as MessageKey) : t("dash.agents.blank")}</span>
                  <span className="mt-0.5 block text-sm text-muted">{tpl.id ? t(`dash.tpl.${tpl.id}.desc` as MessageKey) : t("dash.agents.blankText")}</span>
                  {tpl.id ? (
                    <span className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded-full bg-line/70 px-2 py-0.5 text-[11px] text-muted">{t(`dash.agents.dir.${tpl.direction}`)}</span>
                      {tpl.suggestedTools
                        .filter((k) => k !== "end_call")
                        .slice(0, 3)
                        .map((k) => (
                          <span key={k} className="rounded-full bg-line/70 px-2 py-0.5 text-[11px] text-muted">
                            {t(`dash.tool.kind.${k}`)}
                          </span>
                        ))}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="grid gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-3">
        <Field label={t("dash.agents.nameLabel")} htmlFor="agent-name" hint={t("dash.agents.nameHint")}>
          <Input id="agent-name" name="name" maxLength={120} dir="auto" placeholder={template ? t(`dash.tpl.${template}.name` as MessageKey) : t("dash.agents.blankName")} />
        </Field>
        <Field label={t("dash.agents.language")} htmlFor="agent-lang">
          <Select id="agent-lang" name="language" defaultValue={defaultLanguage}>
            {AGENT_LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dash.agents.provider")} htmlFor="agent-provider" hint={providers.length ? undefined : t("dash.agents.noProviders")}>
          <Select id="agent-provider" name="provider" defaultValue={providers.includes(defaultProvider as ProviderId) ? defaultProvider : providers[0]} disabled={!providers.length}>
            {providers.map((p) => (
              <option key={p} value={p}>
                {providerName(p, t)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText={t("dash.agents.creating")}>{t("dash.agents.create")}</SubmitButton>
    </form>
  );
}
