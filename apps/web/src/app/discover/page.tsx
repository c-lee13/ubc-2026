import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover-view";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { EYEBROW, EYEBROW_RULE, H1 } from "@/components/layout/styles";

export const metadata: Metadata = { title: "Live offers: Wincentive" };

// Customer list of live promotions (the prototype's Discover screen, framed in Zahin's layout).
export default function DiscoverPage() {
  return (
    <>
      <DisclosureStrip />
      <SiteHeader current="offers" />
      <main className="mx-auto max-w-[1240px] px-5 pb-20 pt-8 sm:px-8 lg:pt-12">
        <p className={EYEBROW}>
          <span aria-hidden className={EYEBROW_RULE} />
          Live offers
        </p>
        <h1 className={`${H1} mt-6 text-[clamp(2.5rem,5vw,4.2rem)]`}>Free if it happens.</h1>
        <p className="mt-6 mb-10 max-w-[36rem] text-lg leading-relaxed text-[#5A5463]">
          Promotions selling right now. Pay test USDC with your email; if the outcome happens, you
          get it back.
        </p>
        <DiscoverView />
      </main>
      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "My purchases", href: "/me" },
          { label: "For merchants", href: "/merchant" },
        ]}
      />
    </>
  );
}
