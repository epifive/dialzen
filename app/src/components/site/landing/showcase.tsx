import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PointList, SectionHeading } from "./section-heading";

/** A feature showcase: heading and selling points on one side, an illustration on the other. */
export function Showcase({
  id,
  eyebrow,
  title,
  text,
  points,
  visual,
  reverse = false,
  tinted = false,
  footer,
}: {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  visual: ReactNode;
  /** Illustration first on wide screens. */
  reverse?: boolean;
  /** Surface background with borders (alternate sections). */
  tinted?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-16 overflow-x-clip py-24 sm:py-28", tinted && "border-y border-line bg-surface")}>
      <div
        className={cn(
          "mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 sm:px-6 lg:gap-16",
          reverse ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]" : "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
        )}
      >
        <div className={cn(reverse && "lg:order-2")}>
          <SectionHeading id={`${id}-title`} eyebrow={eyebrow} title={title} text={text} />
          <PointList points={points} icon={<Check className="size-3.5" aria-hidden strokeWidth={3} />} />
          {footer}
        </div>
        <div className={cn("min-w-0", reverse && "lg:order-1")}>{visual}</div>
      </div>
    </section>
  );
}
