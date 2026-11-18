import type { Metadata } from "next";
import { CounterView } from "@/components/counter-view";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = { title: "Counter: Wincentive" };

/** The barista's screen for one promo: its QR code and the live order feed (kiosk: no nav). */
export default async function CounterPage({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;
  return (
    <>
      <DisclosureStrip />
      <SiteHeader kiosk />
      <main className="mx-auto max-w-[1240px] px-5 pb-20 pt-4 sm:px-8 md:pt-8">
        <CounterView promoId={decodeURIComponent(promoId)} />
      </main>
    </>
  );
}
