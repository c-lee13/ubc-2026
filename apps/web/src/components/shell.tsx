"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { usd } from "@/lib/format";
import { useWallet } from "@/lib/wallet/session";
import { IconReceipt, IconTicket, IconUser } from "./icons";
import { Wordmark } from "./kit";

/** Phone-width column, centered on bigger screens. */
export function Column({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[480px] ${className}`}>{children}</div>;
}

/** The profile button: the signed-in person's initial, else a person icon. */
export function ProfileButton() {
  const w = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted && w.phase === "ready" && w.wallet;
  const initial = (w.email?.[0] ?? "").toUpperCase();
  return (
    <Link
      href="/profile"
      aria-label="Profile"
      className="flex h-10 items-center gap-2 rounded-full pl-1 pr-1 text-ink-2 transition-colors hover:text-ink"
    >
      {ready ? (
        <span className="font-num pr-0.5 text-[17px] text-ink">{usd(w.wallet!.usdcBalance)}</span>
      ) : null}
      <span
        className={`grid h-9 w-9 place-items-center rounded-full ${ready ? "bg-ribbon text-black" : "bg-surface-2 ring-1 ring-inset ring-line-strong"}`}
      >
        {ready ? <span className="font-title text-[15px]">{initial}</span> : <IconUser size={19} />}
      </span>
    </Link>
  );
}

export function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 bg-black/85 backdrop-blur-md">
      <Column className="flex h-[60px] items-center justify-between px-4">
        <Link href="/" aria-label="Wincentive home">
          <Wordmark />
        </Link>
        {right ?? <ProfileButton />}
      </Column>
    </header>
  );
}

const TABS = [
  { href: "/", label: "Coupons", Icon: IconTicket },
  { href: "/me", label: "My promos", Icon: IconReceipt },
];

export function BottomTabs() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-black/90 pb-safe backdrop-blur-md"
    >
      <Column className="grid grid-cols-2">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex h-[60px] flex-col items-center justify-center gap-1 text-[12px] font-semibold transition-colors ${active ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
            >
              <Icon size={22} strokeWidth={active ? 2.1 : 1.8} />
              {label}
            </Link>
          );
        })}
      </Column>
    </nav>
  );
}

/** Customer screens: top bar, content, the two bottom tabs. */
export function CustomerShell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <main className="pb-[92px]">
        <Column className="px-4">{children}</Column>
      </main>
      <BottomTabs />
    </>
  );
}
