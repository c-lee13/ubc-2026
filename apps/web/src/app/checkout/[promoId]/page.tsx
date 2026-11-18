import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Checkout: Wincentive (Arc testnet demo)" };

const PURCHASE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * Customer checkout for one promo (reached from the shop's QR code). `promoId` is the promotion id
 * from the API; `?p=<purchaseKey>` opens that purchase's live receipt.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ promoId: string }>;
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const { promoId } = await params;
  const { p } = await searchParams;
  const purchase = typeof p === "string" && PURCHASE_KEY.test(p) ? p : null;
  return (
    <>
      <SiteHeader active="checkout" />
      <main className="mx-auto max-w-[1240px] px-5 pt-4 pb-20 md:px-8 md:pt-8">
        <CheckoutView promoId={decodeURIComponent(promoId)} initialPurchase={purchase} />
      </main>
    </>
  );
}
