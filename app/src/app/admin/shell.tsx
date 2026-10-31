"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PanelsTopLeft,
  CreditCard,
  ExternalLink,
  FileText,
  Gauge,
  Inbox,
  Languages,
  Layers,
  Newspaper,
  LogOut,
  Menu,
  ReceiptText,
  Server,
  Settings,
  ShieldCheck,
  AudioLines,
  Users,
  X,
} from "lucide-react";
import { logout } from "@/app/actions/auth";
import { Logo } from "@/components/site/logo";
import { ThemeToggle, type ThemeChoice } from "@/components/site/theme";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: Gauge, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/plans", label: "Plans", icon: Layers },
  { href: "/admin/voice", label: "Voice providers", icon: AudioLines },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, badge: "payments" as const },
  { href: "/admin/billing", label: "Billing", icon: ReceiptText },
  { href: "/admin/compliance", label: "Compliance", icon: ShieldCheck },
  { href: "/admin/pages", label: "Pages", icon: FileText },
  { href: "/admin/blog", label: "Blog", icon: Newspaper },
  { href: "/admin/languages", label: "Languages", icon: Languages },
  { href: "/admin/messages", label: "Messages", icon: Inbox, badge: "messages" as const },
  { href: "/admin/settings/general", label: "Settings", icon: Settings, match: "/admin/settings" },
  { href: "/admin/system", label: "System", icon: Server },
];

export function AdminShell({
  siteName,
  logo,
  logoDark,
  user,
  badges,
  demo,
  defaultTheme,
  children,
}: {
  siteName: string;
  logo: string;
  logoDark: string;
  user: { name: string; email: string };
  badges: { messages: number; payments: number };
  demo: boolean;
  defaultTheme: ThemeChoice;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile drawer after navigating
    setOpen(false);
  }, [pathname]);

  const nav = (
    <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-0.5">
        {NAV.map((item) => {
          // The most specific matching item wins (Voice providers is inside Settings).
          const matches = (i: (typeof NAV)[number]) => (i.exact ? pathname === i.href : pathname.startsWith(i.match ?? i.href));
          const best = NAV.filter(matches).sort((a, b) => (b.match ?? b.href).length - (a.match ?? a.href).length)[0];
          const active = best === item;
          const count = item.badge ? badges[item.badge] : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary-soft text-primary" : "text-muted hover:bg-paper hover:text-ink",
                )}
              >
                <item.icon className="size-[18px]" aria-hidden />
                {item.label}
                {count > 0 ? (
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none text-white">{count}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );

  const footer = (
    <div className="border-t border-line p-3">
      <p className="truncate px-2 text-sm font-medium">{user.name}</p>
      <p className="truncate px-2 text-xs text-muted">{user.email}</p>
      <Link
        href="/dashboard"
        className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary-soft"
      >
        <PanelsTopLeft className="size-4" aria-hidden />
        My workspaces (customer dashboard)
      </Link>
      <div className="mt-1 flex items-center gap-1">
        <Link href="/" target="_blank" className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-paper hover:text-ink">
          <ExternalLink className="size-4" aria-hidden />
          View site
        </Link>
        <ThemeToggle defaultTheme={defaultTheme} />
        <form action={logout}>
          <button type="submit" aria-label="Sign out" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-paper hover:text-ink">
            <LogOut className="size-[18px]" />
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Logo siteName={siteName} logo={logo} logoDark={logoDark} href="/admin" />
        </div>
        {nav}
        {footer}
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="grid size-9 place-items-center rounded-lg text-muted">
          <Menu className="size-5" />
        </button>
        <Logo siteName={siteName} logo={logo} logoDark={logoDark} href="/admin" />
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Logo siteName={siteName} logo={logo} logoDark={logoDark} href="/admin" />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="grid size-9 place-items-center rounded-lg text-muted">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      ) : null}

      <main className="min-w-0">
        {demo ? (
          <p className="bg-marker px-4 py-2 text-center text-sm font-medium text-[#3d2e00]">
            Demo mode: you can explore everything, but saving is disabled.
          </p>
        ) : null}
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{children}</div>
      </main>
    </div>
  );
}
