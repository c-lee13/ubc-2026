import type { Metadata } from "next";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DashboardScreen } from "@/components/merchant/DashboardScreen";

export const metadata: Metadata = { title: "Merchant dashboard: Wincentive" };

const WALLET = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

// Merchant dashboard (Zahin's design) on GET /api/merchants/:wallet/dashboard. The shop is the
// signed-in Circle email wallet; `?merchant=<wallet>` opens any shop's dashboard read-only.
export default async function MerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string | string[] }>;
}) {
  const { merchant } = await searchParams;
  const viewAs = typeof merchant === "string" && WALLET.test(merchant) ? merchant : null;
  return (
    <>
      <DisclosureStrip />
      <SiteHeader current="promotions" />
      <main>
        <DashboardScreen viewAs={viewAs} />
      </main>
      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "Claims", href: "/merchant/claims" },
          { label: "Live offers", href: "/discover" },
        ]}
      />
    </>
  );
}
