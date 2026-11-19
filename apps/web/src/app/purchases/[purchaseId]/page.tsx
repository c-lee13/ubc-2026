import type { Metadata } from "next";
import { ReceiptScreen } from "@/components/purchases/ReceiptScreen";

export const metadata: Metadata = { title: "Receipt: Wincentive" };

// The live receipt for one purchase key (bytes32 hex from the Arc escrow): GET /api/purchases/:key,
// polled. `?new=1` right after paying plays the one-time "You're in" moment.
export default async function PurchaseReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { purchaseId } = await params;
  const { new: fresh } = await searchParams;
  return <ReceiptScreen purchaseKey={decodeURIComponent(purchaseId)} fresh={fresh === "1"} />;
}
