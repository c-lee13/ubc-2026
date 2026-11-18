import type { Metadata } from "next";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ClaimsScreen } from "@/components/merchant/ClaimsScreen";

export const metadata: Metadata = { title: "Claims: Wincentive" };

// Merchant claims (Zahin's design): every purchase of the signed-in shop's promos, its escrow state
// on Arc and the official outcome, and the shop's claim of covered sales whose outcome was NO.
export default function MerchantClaimsPage() {
  return (
    <>
      <DisclosureStrip />
      <SiteHeader current="claims" />
      <main>
        <ClaimsScreen />
      </main>
      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "Promotions", href: "/merchant" },
          { label: "Live offers", href: "/discover" },
        ]}
      />
    </>
  );
}
