import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { areaPaths, waveform } from "./format";

/** Building blocks of the landing page illustrations: plain HTML/SVG, no JavaScript. */

/**
 * Keyframes of the landing page (dz-*): kept here so the page carries its own motion. Every user
 * pairs them with motion-reduce:animate-none.
 */
const KEYFRAMES = `
@keyframes dz-toast{from{opacity:0;transform:translateY(12px) scale(.96)}}
@keyframes dz-wave{0%,100%{transform:scaleY(.38)}50%{transform:scaleY(1)}}
@keyframes dz-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes dz-flow{to{stroke-dashoffset:-24}}
@keyframes dz-fill{from{transform:scaleX(0)}}
@keyframes dz-ping{75%,100%{transform:scale(2.2);opacity:0}}
@keyframes dz-dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
@keyframes dz-ring{0%{transform:scale(.85);opacity:.55}100%{transform:scale(1.5);opacity:0}}
@keyframes dz-glow{50%{opacity:.55}}
`;

export function LandingStyles() {
  return (
    <style href="dz-landing-keyframes" precedence="default">
      {KEYFRAMES}
    </style>
  );
}

/** Shadow of the floating illustration cards. */
export const FLOAT_SHADOW = "shadow-[0_24px_50px_-18px_rgba(74,4,78,0.42)] dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.85)]";

/** Window chrome around an app illustration: traffic lights, a title and extras on the end side. */
export function WindowFrame({ title, extra, children, className }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_100px_-40px_rgba(112,26,117,0.55)] ring-1 ring-black/[0.02] dark:shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line bg-paper/70 px-4 py-2.5">
        <span aria-hidden className="flex shrink-0 gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="min-w-0 truncate font-display text-sm font-semibold">{title}</span>
        {extra ? <span className="ms-auto flex shrink-0 items-center gap-2">{extra}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** An eyebrow-sized label used inside the illustrations. */
export function MockLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("block text-[10px] font-semibold tracking-wide text-muted uppercase tall-script:normal-case", className)}>{children}</span>;
}

/** A round "live" dot with a ping. */
export function LiveDot({ className = "bg-emerald-500" }: { className?: string }) {
  return (
    <span aria-hidden className="relative flex size-2 shrink-0">
      <span className={cn("absolute inset-0 animate-[dz-ping_1.6s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full motion-reduce:animate-none", className)} />
      <span className={cn("relative size-2 rounded-full", className)} />
    </span>
  );
}

/**
 * Voice bars. `live` animates them (a speaking voice); otherwise they are a static recording
 * waveform, filled up to `progress` (0–1) like a player.
 */
export function Waveform({
  bars = 48,
  seed = 1,
  live = false,
  progress,
  className,
  barClass = "bg-primary",
  restClass = "bg-line",
}: {
  bars?: number;
  seed?: number;
  live?: boolean;
  progress?: number;
  className?: string;
  barClass?: string;
  restClass?: string;
}) {
  const heights = waveform(bars, seed);
  return (
    <span aria-hidden className={cn("flex items-center gap-[2px]", className)}>
      {heights.map((h, i) => {
        const played = progress === undefined || i / bars <= progress;
        return (
          <span
            key={i}
            className={cn(
              "block min-w-[2px] flex-1 origin-center rounded-full",
              played ? barClass : restClass,
              live && "animate-[dz-wave_1.1s_ease-in-out_infinite] motion-reduce:animate-none",
            )}
            style={{ height: `${Math.round(h * 100)}%`, ...(live ? { animationDelay: `${-((i * 137) % 1100)}ms` } : {}) }}
          />
        );
      })}
    </span>
  );
}

/** Three dots: the agent is thinking / typing. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1", className)}>
      {[0, 160, 320].map((d) => (
        <span key={d} className="size-1.5 animate-[dz-dot_1.2s_ease-in-out_infinite] rounded-full bg-current motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

/** A small area chart that draws in once. */
export function Sparkline({ values, width = 200, height = 48, id, className }: { values: number[]; width?: number; height?: number; id: string; className?: string }) {
  const { line, area, last } = areaPaths(values, width, height);
  return (
    <svg aria-hidden viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("overflow-visible rtl:-scale-x-100", className)}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        pathLength={1}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="animate-[dz-draw_1.6s_ease-out_0.5s_both] [stroke-dasharray:1] motion-reduce:animate-none"
      />
      <circle cx={last[0]} cy={last[1]} r={3} fill="var(--primary)" className="stroke-surface" strokeWidth={1.5} />
    </svg>
  );
}

/** Badge colours: the same tones as the dashboard (src/voice/format.ts TONE). */
export const TONE = {
  neutral: "bg-line/70 text-muted",
  info: "bg-primary-soft text-primary-text",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

export function Pill({ tone = "neutral", children, className }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", TONE[tone], className)}>{children}</span>;
}
