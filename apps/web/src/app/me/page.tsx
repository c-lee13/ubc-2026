import type { Metadata } from "next";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { EYEBROW, EYEBROW_RULE, H1 } from "@/components/layout/styles";
import { MeView } from "@/components/me-view";

export const metadata: Metadata = { title: "My purchases: Wincentive" };

// Customer balance and purchases (the prototype's screen, framed in Zahin's layout).
export default function MePage() {
  return (
    <>
      <DisclosureStrip />
      <SiteHeader current="purchases" />
      <main className="mx-auto max-w-[1240px] px-5 pb-20 pt-8 sm:px-8 lg:pt-12">
        <p className={EYEBROW}>
          <span aria-hidden className={EYEBROW_RULE} />
          Your wallet
        </p>
        <h1 className={`${H1} mt-6 mb-10 text-[clamp(2.5rem,5vw,4.2rem)]`}>My purchases.</h1>
        <MeView />
      </main>
      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "Live offers", href: "/discover" },
          { label: "For merchants", href: "/merchant" },
        ]}
      />
    </>
  );
}
