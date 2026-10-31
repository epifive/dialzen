import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Default brand mark: a phone handset (earpiece, curved handle, mouthpiece) drawn as vertical
 * sound-wave bars, on the brand colour.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <g fill="white" transform="translate(1.6 1.6) scale(0.9)">
        <rect x="3.6" y="4.95" width="2.4" height="8.1" rx="1.2" />
        <rect x="6.8" y="4.25" width="2.4" height="13.15" rx="1.2" />
        <rect x="10.0" y="4.65" width="2.4" height="16.4" rx="1.2" />
        <rect x="13.2" y="15.85" width="2.4" height="7.35" rx="1.2" />
        <rect x="16.4" y="18.7" width="2.4" height="7.25" rx="1.2" />
        <rect x="19.6" y="18.25" width="2.4" height="9.5" rx="1.2" />
        <rect x="22.8" y="18.3" width="2.4" height="9.4" rx="1.2" />
        <rect x="26.0" y="20.3" width="2.4" height="5.4" rx="1.2" />
      </g>
    </svg>
  );
}

export function Logo({
  siteName,
  logo,
  logoDark,
  href = "/",
  className,
}: {
  siteName: string;
  logo?: string;
  logoDark?: string;
  href?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label={`${siteName} home`}>
      {logo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-uploaded logo of unknown size */}
          <img src={logo} alt={siteName} className={cn("h-8 w-auto max-w-full object-contain object-left rtl:object-right", logoDark && "dark:hidden")} />
          {logoDark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDark} alt={siteName} className="hidden h-8 w-auto max-w-full object-contain object-left dark:block rtl:object-right" />
          ) : null}
        </>
      ) : (
        <>
          <BrandMark className="shrink-0" />
          <span className="truncate font-display text-xl font-bold tracking-tight text-ink">{siteName}</span>
        </>
      )}
    </Link>
  );
}
