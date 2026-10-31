import { Bell, Braces, Landmark, Mail, PhoneCall } from "lucide-react";
import { BrandMark } from "@/components/site/logo";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

interface Item {
  /** Brand name (not translated). */
  name: string;
  /** home.int.name.<key>, when the name has words to translate around the brand names. */
  nameKey?: string;
  /** Monogram of the tile (no third-party logos). */
  mark: string;
  tile: string;
  /** home.int.note.<key>, when the item has a note. */
  note?: string;
}

interface Group {
  key: string;
  items: Item[];
}

const LEFT: Group[] = [
  {
    key: "voice",
    items: [
      { name: "ElevenLabs", mark: "11", tile: "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900", note: "elevenlabs" },
      { name: "Retell AI", mark: "R", tile: "bg-indigo-600 text-white", note: "retell" },
    ],
  },
  {
    key: "phone",
    items: [
      { name: "Twilio", mark: "T", tile: "bg-[#f22f46] text-white", note: "twilio" },
      { name: "SIP", mark: "SIP", tile: "bg-slate-600 text-white text-[9px]", note: "sip" },
    ],
  },
  {
    key: "booking",
    items: [
      { name: "Cal.com", mark: "C", tile: "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900", note: "cal" },
      { name: "Google Calendar", mark: "31", tile: "bg-[#1a73e8] text-white text-[10px]", note: "gcal" },
    ],
  },
];

const RIGHT: Group[] = [
  {
    key: "data",
    items: [
      { name: "Google Sheets", mark: "S", tile: "bg-[#188038] text-white", note: "sheets" },
      { name: "Webhooks · n8n · Zapier", nameKey: "webhooks", mark: "{ }", tile: "bg-[#ea4b71] text-white text-[10px]", note: "webhooks" },
    ],
  },
  {
    key: "ai",
    items: [
      { name: "OpenAI-compatible", nameKey: "openai", mark: "AI", tile: "bg-emerald-600 text-white text-[10px]", note: "openai" },
      { name: "Anthropic", mark: "A", tile: "bg-[#d97757] text-white", note: "anthropic" },
    ],
  },
  {
    key: "pay",
    items: [
      { name: "Stripe", mark: "S", tile: "bg-[#635bff] text-white" },
      { name: "PayPal", mark: "P", tile: "bg-[#003087] text-white" },
      { name: "Razorpay", mark: "R", tile: "bg-[#3395ff] text-white" },
    ],
  },
];

function GroupCard({ t, group, side }: { t: Translator; group: Group; side: "start" | "end" }) {
  return (
    <li className="relative rounded-2xl border border-line bg-surface p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-line hover:shadow-md motion-reduce:hover:translate-y-0">
      {/* Connector towards the hub on wide screens. */}
      <span aria-hidden className={cn("absolute top-1/2 hidden w-8 border-t-2 border-dashed border-primary-line lg:block", side === "start" ? "-end-8" : "-start-8")} />
      <p className="text-[11px] font-semibold tracking-wide text-primary-text uppercase tall-script:normal-case">{t(`home.int.group.${group.key}` as MessageKey)}</p>
      <ul className="mt-3 space-y-2.5">
        {group.items.map((item) => (
          <li key={item.name} className="flex items-center gap-3">
            <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-xl font-display text-[13px] font-bold", item.tile)}>
              {item.mark}
            </span>
            <span className="min-w-0">
              <bdi className="block truncate text-sm font-semibold">{item.nameKey ? t(`home.int.name.${item.nameKey}` as MessageKey) : item.name}</bdi>
              {item.note ? <span className="block text-xs text-muted">{t(`home.int.note.${item.note}` as MessageKey)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The services the platform connects to, around the product mark. */
export function Integrations({ t, site }: { t: Translator; site: string }) {
  const notify = ["Email", "Slack", "Microsoft Teams", "Discord", "Telegram"];
  return (
    <section id="integrations" aria-labelledby="int-title" className="scroll-mt-16 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mat-grid relative overflow-hidden rounded-[2rem] border border-line px-3 py-16 sm:px-8 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-80 max-w-3xl rounded-full bg-primary/15 blur-[100px]" />
          <SectionHeading id="int-title" align="center" eyebrow={t("home.int.eyebrow")} title={t("home.int.title")} text={t("home.int.text", { site })} className="relative" />

          <div className="relative mt-14 grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1fr)] lg:gap-8">
            <ul className="order-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:order-1 lg:grid-cols-1">
              {LEFT.map((g) => (
                <GroupCard key={g.key} t={t} group={g} side="start" />
              ))}
            </ul>

            {/* Hub */}
            <div aria-hidden className="relative order-1 mx-auto grid size-56 place-items-center lg:order-2 lg:size-60">
              <span className="absolute inset-0 rounded-full border border-primary-line bg-surface/40" />
              <span className="absolute inset-6 rounded-full border border-dashed border-primary-line" />
              <span className="absolute inset-12 animate-[dz-ring_2.8s_ease-out_infinite] rounded-full bg-primary/25 motion-reduce:animate-none" />
              <span className="absolute inset-12 animate-[dz-ring_2.8s_ease-out_1.4s_infinite] rounded-full bg-primary/20 motion-reduce:animate-none" />
              <span className="relative grid size-24 place-items-center rounded-[1.75rem] bg-surface shadow-[0_20px_50px_-15px_rgba(162,28,175,0.6)] ring-1 ring-primary-line">
                <BrandMark className="size-14" />
              </span>
              <span className="absolute -bottom-3 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white shadow-md shadow-primary/30">
                <bdi>{site}</bdi>
              </span>
              {[0, 60, 120, 180, 240, 300].map((deg) => (
                <span key={deg} className="absolute inset-0" style={{ transform: `rotate(${deg}deg)` }}>
                  <span className="absolute top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary/60" />
                </span>
              ))}
            </div>

            <ul className="order-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {RIGHT.map((g) => (
                <GroupCard key={g.key} t={t} group={g} side="end" />
              ))}
            </ul>
          </div>

          <div className="relative mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted">
              <Bell className="size-4 text-primary-text" aria-hidden />
              {t("home.int.notify")}
            </span>
            {notify.map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium">
                {n === "Email" ? <Mail className="size-3.5 text-muted" aria-hidden /> : null}
                <bdi>{n === "Email" ? t("home.int.email") : n}</bdi>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium">
              <Braces className="size-3.5 text-muted" aria-hidden />
              {t("home.int.api")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium">
              <Landmark className="size-3.5 text-muted" aria-hidden />
              {t("home.int.bank")}
            </span>
          </div>

          <p className="relative mx-auto mt-8 flex max-w-2xl items-start justify-center gap-2 text-center text-sm text-muted">
            <PhoneCall className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
            <span>{t("home.int.footnote")}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
