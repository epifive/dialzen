import { AudioLines, CalendarCheck, Check, FileText, Globe, Link2, PhoneForwarded, PhoneOff, Play, RefreshCw, ShieldCheck, Sparkles, Table2, Webhook } from "lucide-react";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { EXAMPLE_BUSINESS } from "./format";
import { FLOAT_SHADOW, MockLabel, Pill, WindowFrame } from "./mock-kit";
import { Showcase } from "./showcase";

const TABS = ["basics", "prompt", "knowledge", "tools", "behaviour", "analysis", "widget", "test"] as const;

/** The agent builder (dashboard → Agents → an agent): the prompt tab with the voice, knowledge and tools beside it. */
function BuilderMockup({ t }: { t: Translator }) {
  const tools: Array<[typeof CalendarCheck, string, boolean]> = [
    [CalendarCheck, t("home.build.toolCal"), true],
    [Table2, t("home.build.toolSheets"), true],
    [PhoneForwarded, t("home.build.toolTransfer"), true],
    [Webhook, t("home.build.toolWebhook"), false],
    [PhoneOff, t("home.build.toolEnd"), true],
  ];
  return (
    <div role="img" aria-label={t("home.build.mockLabel")} className="relative mx-auto w-full max-w-[620px] select-none">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-violet-400/25 via-primary/20 to-transparent blur-3xl" />
      <WindowFrame
        title={
          <>
            <bdi>{t("home.mock.agentName")}</bdi> <span className="font-normal text-muted">· {EXAMPLE_BUSINESS.name}</span>
          </>
        }
        extra={
          <>
            <Pill tone="good" className="max-[420px]:hidden">
              {t("home.build.active")}
            </Pill>
            <Pill tone="info">
              <RefreshCw className="size-3" />
              {t("home.build.synced")}
            </Pill>
          </>
        }
      >
        <div className="flex gap-0.5 overflow-hidden border-b border-line px-3 pt-2 text-[11px] font-medium">
          {TABS.map((tab) => (
            <span key={tab} className={cn("shrink-0 border-b-2 px-2 pb-2", tab === "prompt" ? "border-primary text-ink" : "border-transparent text-muted")}>
              {t(`home.build.tab.${tab}` as MessageKey)}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_13.5rem]">
          {/* Prompt */}
          <div className="min-w-0 space-y-3 p-3 sm:p-4">
            <div>
              <span className="flex items-center justify-between gap-2">
                <MockLabel>{t("home.build.firstMessage")}</MockLabel>
                <Pill tone="good">
                  <ShieldCheck className="size-3" />
                  {t("home.build.disclosure")}
                </Pill>
              </span>
              <p dir="auto" className="mt-1.5 rounded-lg border border-line bg-paper/60 px-2.5 py-2 text-[11.5px] leading-snug">
                {t("home.build.firstMessageText", { business: EXAMPLE_BUSINESS.name })}
              </p>
            </div>
            <div>
              <span className="flex items-center justify-between gap-2">
                <MockLabel>{t("home.build.prompt")}</MockLabel>
                <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-primary to-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white rtl:bg-gradient-to-l">
                  <Sparkles className="size-3" />
                  {t("home.build.improve")}
                </span>
              </span>
              <div dir="auto" className="mt-1.5 space-y-1.5 rounded-lg border border-line px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-ink/85">
                <p className="font-semibold text-primary-text">{t("home.build.promptH1")}</p>
                <p>{t("home.build.promptL1")}</p>
                <p>{t("home.build.promptL2")}</p>
                <p className="font-semibold text-primary-text">{t("home.build.promptH2")}</p>
                <p className="max-sm:hidden">{t("home.build.promptL3")}</p>
                <p className="text-muted">{t("home.build.promptRules")}</p>
              </div>
            </div>
          </div>

          {/* Voice, knowledge and tools */}
          <div className="min-w-0 space-y-3 border-t border-line bg-paper/60 p-3 sm:border-t-0 sm:border-s">
            <div className="rounded-xl border border-line bg-surface p-2.5">
              <MockLabel>{t("home.build.voice")}</MockLabel>
              <span className="mt-1.5 flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-400 to-violet-600 text-white">
                  <AudioLines className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-[12px] font-semibold">{t("home.mock.voice")}</bdi>
                  <span className="block truncate text-[10px] text-muted">{t("home.mock.language")}</span>
                </span>
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-muted">
                  <Play className="size-3 fill-current rtl:-scale-x-100" />
                </span>
              </span>
            </div>
            <div className="rounded-xl border border-line bg-surface p-2.5 max-sm:hidden">
              <MockLabel>{t("home.build.knowledge")}</MockLabel>
              <span className="mt-1.5 block space-y-1 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <FileText className="size-3.5 shrink-0 text-primary-text" />
                  <bdi className="truncate">{t("home.build.kbFile")}</bdi>
                </span>
                <span className="flex items-center gap-1.5">
                  <Link2 className="size-3.5 shrink-0 text-primary-text" />
                  <bdi dir="ltr" className="truncate">
                    {EXAMPLE_BUSINESS.domain}/faq
                  </bdi>
                </span>
              </span>
            </div>
            <div className="rounded-xl border border-line bg-surface p-2.5">
              <MockLabel>{t("home.build.tools")}</MockLabel>
              <span className="mt-1.5 block space-y-1">
                {tools.map(([Icon, label, on]) => (
                  <span key={label} className={cn("flex items-center gap-1.5 text-[11px]", !on && "text-muted")}>
                    <Icon className={cn("size-3.5 shrink-0", on ? "text-primary-text" : "")} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {on ? <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" strokeWidth={3} /> : null}
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>
      </WindowFrame>

      {/* AI prompt assistant */}
      <div
        aria-hidden
        className={cn(
          "absolute -start-6 -bottom-14 z-10 hidden w-[270px] animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.6s_both] rounded-xl border border-line bg-surface/95 p-3 backdrop-blur motion-reduce:animate-none sm:block xl:-start-14",
          FLOAT_SHADOW,
        )}
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-white">
            <Sparkles className="size-3.5" />
          </span>
          {t("home.build.assistant")}
        </span>
        <span dir="auto" className="mt-2 block rounded-lg bg-paper px-2.5 py-1.5 text-[11px] leading-snug text-muted ring-1 ring-line ring-inset">
          {t("home.build.assistantInput")}
        </span>
        <span className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <Check className="size-3.5" strokeWidth={3} />
          {t("home.build.assistantDone")}
        </span>
      </div>

      {/* Languages */}
      <div
        aria-hidden
        className={cn(
          "absolute -end-4 -top-10 z-10 hidden animate-[dz-toast_0.7s_cubic-bezier(0.2,0.9,0.3,1.2)_0.9s_both] items-center gap-2 rounded-xl border border-line bg-surface/95 px-3 py-2 backdrop-blur motion-reduce:animate-none md:flex xl:-end-10",
          FLOAT_SHADOW,
        )}
      >
        <Globe className="size-4 text-primary-text" />
        <span className="flex gap-1 text-[11px] font-semibold">
          {["English", "हिन्दी", "العربية", "Español"].map((l) => (
            <span key={l} className="rounded-md bg-paper px-1.5 py-0.5 ring-1 ring-line ring-inset">
              {l}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

export function BuilderShowcase({ t }: { t: Translator }) {
  return (
    <Showcase
      id="builder"
      eyebrow={t("home.build.eyebrow")}
      title={t("home.build.title")}
      text={t("home.build.text")}
      points={[t("home.build.point1"), t("home.build.point2"), t("home.build.point3"), t("home.build.point4")]}
      visual={<BuilderMockup t={t} />}
    />
  );
}
