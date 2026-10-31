"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUser, Crown, LayoutDashboard, LogOut, Menu, Shield, X } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Closes a popover when clicking outside it, pressing Escape or navigating. */
function useDismiss(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    // Close menus after client-side navigation.
    setOpen(false);
  }, [pathname, setOpen]);
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  return ref;
}

export function UserMenu({ name, email, isAdmin, isPremium }: { name: string; email: string; isAdmin: boolean; isPremium: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const item = "flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-primary-soft";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t("nav.accountMenu")}
        className="relative grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-white"
      >
        {initials || <CircleUser className="size-5" />}
        {isPremium ? (
          <span className="absolute -end-1 -bottom-1 grid size-4 place-items-center rounded-full bg-marker text-[#3d2e00] ring-2 ring-paper">
            <Crown className="size-2.5" aria-hidden />
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute end-0 top-full mt-2 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
          <div className="border-b border-line px-3 pt-2 pb-3">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <ul className="py-1 text-sm">
            <li>
              <Link href="/dashboard" className={item}>
                <LayoutDashboard className="size-4 text-muted" aria-hidden />
                {t("nav.dashboard")}
              </Link>
            </li>
            <li>
              <Link href="/account" className={item}>
                <CircleUser className="size-4 text-muted" aria-hidden />
                {t("nav.myAccount")}
              </Link>
            </li>
            {!isPremium ? (
              <li>
                <Link href="/pricing" className={item}>
                  <Crown className="size-4 text-muted" aria-hidden />
                  {t("nav.upgrade")}
                </Link>
              </li>
            ) : null}
            {isAdmin ? (
              <li>
                <Link href="/admin" className={item}>
                  <Shield className="size-4 text-muted" aria-hidden />
                  {t("nav.admin")}
                </Link>
              </li>
            ) : null}
          </ul>
          <form action={logout} className="border-t border-line pt-1">
            <button type="submit" className={cn(item, "w-full text-sm")}>
              <LogOut className="size-4 text-muted" aria-hidden />
              {t("nav.signOut")}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function MobileMenu({
  signedIn,
  isAdmin,
  showPricing,
  showBlog,
  showContact,
}: {
  signedIn: boolean;
  isAdmin: boolean;
  showPricing: boolean;
  showBlog: boolean;
  showContact: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const link = "block rounded-lg px-2 py-2.5 hover:bg-primary-soft";
  return (
    <div ref={ref} className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        className="grid size-9 place-items-center rounded-lg text-muted hover:bg-primary-soft hover:text-ink"
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open ? (
        <nav aria-label={t("nav.mobileLabel")} className="absolute inset-x-0 top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-surface px-4 pt-2 pb-6 shadow-xl">
          <ul>
            <li>
              <Link href="/#features" className={link}>
                {t("nav.features")}
              </Link>
            </li>
            {showPricing ? (
              <li>
                <Link href="/pricing" className={link}>
                  {t("nav.pricing")}
                </Link>
              </li>
            ) : null}
            {showBlog ? (
              <li>
                <Link href="/blog" className={link}>
                  {t("nav.blog")}
                </Link>
              </li>
            ) : null}
            {showContact ? (
              <li>
                <Link href="/contact" className={link}>
                  {t("nav.contact")}
                </Link>
              </li>
            ) : null}
            {signedIn ? (
              <>
                <li>
                  <Link href="/dashboard" className={link}>
                    {t("nav.dashboard")}
                  </Link>
                </li>
                <li>
                  <Link href="/account" className={link}>
                    {t("nav.myAccount")}
                  </Link>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Link href="/login" className={link}>
                    {t("nav.signIn")}
                  </Link>
                </li>
                <li>
                  <Link href="/register" className={link}>
                    {t("nav.createAccount")}
                  </Link>
                </li>
              </>
            )}
            {isAdmin ? (
              <li>
                <Link href="/admin" className={link}>
                  {t("nav.admin")}
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
