import Link from "next/link";
import { AccountButton } from "./account";
import { DevnetBanner } from "./devnet-banner";

type Section = "discover" | "me" | "merchant" | "checkout";

const LINKS: [string, string, Section][] = [
  ["/discover", "Discover", "discover"],
  ["/me", "My promos", "me"],
  ["/merchant", "For shops", "merchant"],
];

/** Phones (the primary layout): logo on top, two tabs at the bottom. Wider screens: top nav. */
const TABS: [string, string, Section][] = [
  ["/discover", "Discover", "discover"],
  ["/me", "My promos", "me"],
];

export function SiteHeader({ active, kiosk }: { active?: Section; kiosk?: boolean }) {
  return (
    <header className="pt-[env(safe-area-inset-top)]">
      <DevnetBanner />
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-4 md:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="Wincentive, home">
          {/* The logo sits on pure black; screen blending drops that black into the page. */}
          <img
            src="/wincentive-mark.png"
            alt=""
            width={60}
            height={42}
            className="h-[34px] w-auto mix-blend-screen md:h-[38px]"
          />
          <span className="font-display text-[20px] tracking-[-0.03em] md:text-[22px]">
            Wincentive
          </span>
        </Link>
        {kiosk ? null : (
          <div className="hidden items-center gap-2 md:flex">
            <nav aria-label="Main" className="flex items-center gap-1">
              {LINKS.map(([href, label, key]) => (
                <Link
                  key={key}
                  href={href}
                  aria-current={active === key ? "page" : undefined}
                  className={`rounded-md px-3 py-2 text-[15px] whitespace-nowrap transition-colors ${
                    active === key ? "bg-ink/[0.07] font-semibold" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <AccountButton />
          </div>
        )}
      </div>
      {kiosk ? null : (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
        >
          <div className="grid grid-cols-2">
            {TABS.map(([href, label, key]) => (
              <Link
                key={key}
                href={href}
                aria-current={active === key ? "page" : undefined}
                className={`relative py-4 text-center text-[15px] font-semibold ${
                  active === key ? "text-ink" : "text-ink-soft"
                }`}
              >
                {active === key ? (
                  <span
                    aria-hidden
                    className="bg-ribbon absolute inset-x-[32%] top-0 h-[3px] rounded-b-full"
                  />
                ) : null}
                {label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
