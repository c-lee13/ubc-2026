import type { Metadata } from "next";
import { DashboardScreen } from "@/components/merchant/DashboardScreen";

export const metadata: Metadata = { title: "Workspace: Wincentive" };

const WALLET = /^0x[0-9a-fA-F]{40}$/;

// The merchant workspace for the signed-in shop, or a read-only view of `?merchant=<wallet>`.
export default async function MerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string | string[] }>;
}) {
  const { merchant } = await searchParams;
  const viewAs = typeof merchant === "string" && WALLET.test(merchant) ? merchant : null;
  return <DashboardScreen viewAs={viewAs} />;
}
