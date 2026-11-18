import Link from "next/link";
import { AccountButton } from "./account";
import { DevnetBanner } from "./devnet-banner";

type Section = "discover" | "me" | "merchant" | "checkout";

const LINKS: [string, string, Section][] = [
  ["/discover", "Discover", "discover"],
  ["/me", "My promos", "me"],
  ["/merchant", "For shops", "merchant"],
];

export function SiteHeader({ active, kiosk }: { active?: Section; kiosk?: boolean }) {
  const nav = (href: string, label: string, key: Section) => (
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
  );
  return (
    <header>
      <DevnetBanner />
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-5 py-4 md:px-8">
        <Link href="/" className="flex items-center gap-2" aria-label="Wincentive, home">
          {/* The logo sits on pure black; screen blending drops that black into the page. */}
          <img
            src="/wincentive-mark.png"
            alt=""
            width={60}
            height={42}
            className="h-[38px] w-auto mix-blend-screen"
          />
          <span className="font-display text-[22px] tracking-[-0.03em]">Wincentive</span>
        </Link>
        <div className={`flex items-center gap-1 md:gap-2 ${kiosk ? "hidden" : ""}`}>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {LINKS.map(([h, l, k]) => nav(h, l, k))}
          </nav>
          <AccountButton />
        </div>
      </div>
      <nav
        aria-label="Main"
        className={`mx-auto -mt-2 flex max-w-[1240px] gap-1 overflow-x-auto px-3 pb-2 md:hidden ${kiosk ? "hidden" : ""}`}
      >
        {LINKS.map(([h, l, k]) => nav(h, l, k))}
      </nav>
    </header>
  );
}
