import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { DISPLAY, FOCUS } from "./styles";

/** Zahin's footer (it was repeated on every page with a different link list; the look is unchanged). */
export function SiteFooter({ links }: { links: ReadonlyArray<{ label: string; href: string }> }) {
  return (
    <footer className="border-t border-[#E6E1D8] bg-white">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-5 py-10 sm:px-8 md:grid-cols-12 md:gap-8">
        <div className="flex items-start gap-3 md:col-span-4">
          <LogoMark className="h-11 w-11 rounded-xl" />
          <div>
            <p className={`${DISPLAY} text-lg font-bold tracking-[-0.02em]`}>Wincentive</p>
            <p className="mt-0.5 text-sm text-[#5A5463]">Outcome-powered commerce.</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-[#4E4858] md:col-span-5">
          Arc testnet demonstration. Valueless test USDC. Gemini market data is read-only, and hedge
          execution is simulated. No real-money transactions or Gemini orders.
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-col gap-2 text-sm font-medium md:col-span-3 md:items-end"
        >
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`hover:text-[#6133A7] ${FOCUS}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
