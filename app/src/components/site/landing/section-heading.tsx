import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Eyebrow + title + intro used by every landing section. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  text,
  align = "start",
  tone = "default",
  className,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  text?: ReactNode;
  align?: "start" | "center";
  /** "inverted" for sections on a dark panel. */
  tone?: "default" | "inverted";
  className?: string;
}) {
  const inverted = tone === "inverted";
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      <p
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase tall-script:normal-case",
          inverted ? "border-white/15 bg-white/5 text-fuchsia-200" : "border-primary-line bg-primary-soft text-primary-text",
        )}
      >
        <span aria-hidden className={cn("size-1.5 rounded-full", inverted ? "bg-fuchsia-300" : "bg-primary")} />
        {eyebrow}
      </p>
      <h2
        id={id}
        className={cn(
          "mt-4 text-3xl leading-[1.1] font-bold tracking-tight tall-script:leading-[1.35] tall-script:tracking-normal sm:text-[2.6rem]",
          inverted && "text-white",
        )}
      >
        {title}
      </h2>
      {text ? <p className={cn("mt-4 text-lg leading-relaxed", inverted ? "text-white/70" : "text-muted")}>{text}</p> : null}
    </div>
  );
}

/** A check-marked list of selling points next to a showcase. */
export function PointList({ points, icon }: { points: string[]; icon: ReactNode }) {
  return (
    <ul className="mt-8 space-y-4">
      {points.map((p) => (
        <li key={p} className="flex gap-3">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-text">{icon}</span>
          <span className="leading-relaxed text-muted">{p}</span>
        </li>
      ))}
    </ul>
  );
}
