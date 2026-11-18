import type { Metadata } from "next";
import { CounterView } from "@/components/counter-view";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Counter: Hedged (Arc testnet demo)" };

/** The barista's screen for one promo: its QR code and the live order feed. */
export default async function CounterPage({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;
  return (
    <>
      <SiteHeader active="merchant" />
      <main className="mx-auto max-w-[1240px] px-5 pt-4 pb-20 md:px-8 md:pt-8">
        <CounterView promoId={decodeURIComponent(promoId)} />
      </main>
    </>
  );
}
