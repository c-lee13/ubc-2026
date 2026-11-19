import type { Metadata } from "next";
import { CounterView } from "@/components/counter-view";

export const metadata: Metadata = { title: "Counter: Wincentive" };

/** The counter screen for one promo: its QR code and the live order feed. */
export default async function CounterPage({ params }: { params: Promise<{ promoId: string }> }) {
  const { promoId } = await params;
  return <CounterView promoId={decodeURIComponent(promoId)} />;
}
