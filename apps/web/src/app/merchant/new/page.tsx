import type { Metadata } from "next";
import { CreatePromo } from "@/components/merchant/CreatePromo";

export const metadata: Metadata = { title: "New promo: Wincentive" };

export default function NewPromotionPage() {
  return <CreatePromo />;
}
