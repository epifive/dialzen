import { BellRing, CalendarCheck, Headset, House, LifeBuoy, MessageSquareHeart, PackageSearch, PhoneIncoming, PhoneOutgoing, Repeat, Target } from "lucide-react";
import type { MessageKey, Translator } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./section-heading";

type Direction = "inbound" | "outbound" | "both";

/** The eight agent templates of the builder (src/voice/templates.ts), in the same order. */
const TEMPLATES: Array<{ id: string; icon: typeof Headset; direction: Direction; accent: string }> = [
  { id: "receptionist", icon: Headset, direction: "inbound", accent: "from-fuchsia-500 to-pink-500" },
  { id: "appointment_booking", icon: CalendarCheck, direction: "both", accent: "from-violet-500 to-fuchsia-500" },
  { id: "lead_qualification", icon: Target, direction: "both", accent: "from-rose-500 to-orange-400" },
  { id: "customer_support", icon: LifeBuoy, direction: "inbound", accent: "from-sky-500 to-indigo-500" },
  { id: "order_status", icon: PackageSearch, direction: "inbound", accent: "from-amber-500 to-orange-500" },
  { id: "reminder_confirmation", icon: BellRing, direction: "outbound", accent: "from-emerald-500 to-teal-500" },
  { id: "feedback_survey", icon: MessageSquareHeart, direction: "outbound", accent: "from-pink-500 to-rose-500" },
  { id: "real_estate_inquiry", icon: House, direction: "both", accent: "from-teal-500 to-cyan-500" },
];

const DIRECTION_ICON = { inbound: PhoneIncoming, outbound: PhoneOutgoing, both: Repeat } as const;

export function UseCases({ t }: { t: Translator }) {
  return (
    <section id="use-cases" aria-labelledby="uses-title" className="scroll-mt-16 py-24 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading id="uses-title" eyebrow={t("home.usesEyebrow")} title={t("home.usesTitle")} text={t("home.usesText")} />
          <p className="max-w-xs text-sm text-muted lg:text-end">{t("home.usesNote")}</p>
        </div>
        <ul className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TEMPLATES.map(({ id, icon: Icon, direction, accent }) => {
            const DirIcon = DIRECTION_ICON[direction];
            return (
              <li
                key={id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-primary-line hover:shadow-[0_20px_40px_-24px_rgba(112,26,117,0.45)] motion-reduce:hover:translate-y-0"
              >
                <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r opacity-0 transition-opacity group-hover:opacity-100 rtl:bg-gradient-to-l", accent)} />
                <span className="flex items-center justify-between gap-3">
                  <span className={cn("grid size-10 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm rtl:bg-gradient-to-bl", accent)}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line ring-inset">
                    <DirIcon className="size-3" aria-hidden />
                    {t(`home.dir.${direction}` as MessageKey)}
                  </span>
                </span>
                <h3 className="mt-4 text-[17px] font-bold tall-script:leading-snug">{t(`home.tpl.${id}` as MessageKey)}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted">{t(`home.tplText.${id}` as MessageKey)}</p>
                <p dir="auto" className="mt-4 rounded-xl rounded-ss-sm bg-paper px-3 py-2 text-[12.5px] leading-snug text-ink/85 italic ring-1 ring-line ring-inset">
                  {t(`home.tplLine.${id}` as MessageKey)}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
