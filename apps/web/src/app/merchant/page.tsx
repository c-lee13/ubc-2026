import type { Metadata } from "next";
import { MerchantView } from "@/components/merchant/merchant-view";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "For shops: Wincentive (Arc testnet demo)" };

const WALLET = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export default async function MerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string | string[] }>;
}) {
  const { merchant } = await searchParams;
  const viewAs = typeof merchant === "string" && WALLET.test(merchant) ? merchant : null;
  return (
    <>
      <SiteHeader active="merchant" />
      <main className="mx-auto max-w-[1240px] px-5 pt-6 pb-20 md:px-8 md:pt-10">
        <MerchantView viewAs={viewAs} />
      </main>
    </>
  );
}
