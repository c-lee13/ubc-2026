import Link from "next/link";
import { AccountButton } from "@/components/account";
import { LogoMark } from "./LogoMark";
import { FOCUS } from "./styles";

// Shared Wincentive site header: wordmark + W logo, the standard destinations, an optional
// contextual link row, and an optional account control (Circle email login and balance).
//
// Server-compatible: no "use client", no hooks. AccountButton is the client-only account
// control; the wallet session provider lives in the root layout.
//
// Fonts: it uses the CSS variables --font-display and --font-body set in the root layout.

export type SiteHeaderCurrent = "home" | "offers" | "purchases" | "promotions" | "claims";

type SiteHeaderProps = {
  /** Which standard destination is the current page. Sets aria-current="page" on it. */
  current?: SiteHeaderCurrent;
  /** Page-specific links shown before the standard ones (e.g. an in-page "#how-it-works" anchor). */
  extraLinks?: ReadonlyArray<{ label: string; href: string }>;
  /** Show the header account control. Default true. Pass false on pages whose panel already has one. */
  showWallet?: boolean;
  /** Counter screen: logo only, no navigation or account control. */
  kiosk?: boolean;
};

const NAV: ReadonlyArray<{ key: SiteHeaderCurrent; label: string; href: string }> = [
  { key: "home", label: "Home", href: "/" },
  { key: "offers", label: "Offers", href: "/discover" },
  { key: "purchases", label: "My purchases", href: "/me" },
  { key: "promotions", label: "Promotions", href: "/merchant" },
  { key: "claims", label: "Claims", href: "/merchant/claims" },
];

const LINK = `py-1.5 hover:text-[#6133A7] ${FOCUS}`;
const CURRENT = `py-1.5 font-semibold text-[#6133A7] underline decoration-2 underline-offset-[10px] ${FOCUS}`;

export function SiteHeader({
  current,
  extraLinks = [],
  showWallet = true,
  kiosk = false,
}: SiteHeaderProps) {
  return (
    <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8 lg:py-5">
      <Link href="/" aria-label="Wincentive home" className={`flex items-center gap-3 ${FOCUS}`}>
        <LogoMark className="h-10 w-10 rounded-[11px]" />
        <span className="font-[family-name:var(--font-display)] text-[1.35rem] font-bold tracking-[-0.03em]">
          Wincentive
        </span>
      </Link>

      {kiosk ? null : (
        <nav
          aria-label="Primary"
          className="order-3 flex w-full flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium md:order-none md:w-auto md:gap-x-7 md:text-[15px]"
        >
          {extraLinks.map((l) => (
            <a key={l.href} href={l.href} className={LINK}>
              {l.label}
            </a>
          ))}
          {NAV.map((item) =>
            item.key === current ? (
              <Link key={item.key} href={item.href} aria-current="page" className={CURRENT}>
                {item.label}
              </Link>
            ) : (
              <Link key={item.key} href={item.href} className={LINK}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
      )}

      {showWallet && !kiosk ? <AccountButton /> : null}
    </header>
  );
}
