"use client";
// App sidebar. MVP-0: only Home is live; later pages are shown disabled to signal
// product scope for the demo. Admin sits at the bottom, out of the main nav.
import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Rss,
  PieChart,
  Heart,
  CreditCard,
  Gift,
  Clock,
  MessageSquare,
  SlidersHorizontal,
} from "lucide-react";
import { APP_NAME } from "@alfred/shared";
import { cn } from "@alfred/ui";

type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;
type Item = { href: string; label: string; icon: IconType; soon?: boolean };

const NAV: Item[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/feed", label: "Feed", icon: Rss, soon: true },
  { href: "/profile", label: "Spending", icon: PieChart, soon: true },
  { href: "/wishlist", label: "Wishlist", icon: Heart },
  { href: "/mandates", label: "Mandates", icon: CreditCard },
  { href: "/rewards", label: "Rewards", icon: Gift },
  { href: "/timekeeper", label: "Timekeeper", icon: Clock },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2 px-5">
        <span className="h-2 w-2 rounded-full bg-accent" />
        <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon, soon }) => {
          const active = pathname === href;
          const base =
            "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors";
          if (soon) {
            return (
              <span key={href} className={cn(base, "cursor-default text-text-muted/50")}>
                <Icon size={16} strokeWidth={1.75} />
                {label}
                <span className="ml-auto text-[10px] uppercase tracking-wide text-text-muted/40">soon</span>
              </span>
            );
          }
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                base,
                active ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-2",
              )}
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <Link
          href="/admin"
          className={cn(
            "flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors",
            pathname === "/admin" ? "bg-accent-subtle text-accent" : "text-text-muted hover:bg-surface-2",
          )}
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} />
          Demo control
        </Link>
      </div>
    </aside>
  );
}
