import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutScreen } from "@/components/checkout/CheckoutScreen";

export const metadata: Metadata = { title: "Checkout: Wincentive" };

const PURCHASE_KEY = /^0x[0-9a-fA-F]{64}$/;

// Checkout for one promo, reached from a coupon card or the shop's QR code. Old links with
// ?p=<purchaseKey> go straight to that receipt.
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ promoId: string }>;
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const { promoId } = await params;
  const { p } = await searchParams;
  if (typeof p === "string" && PURCHASE_KEY.test(p)) redirect(`/purchases/${p}`);
  return <CheckoutScreen promoId={decodeURIComponent(promoId)} />;
}
