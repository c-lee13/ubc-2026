import { Suspense } from "react";
import { CouponsHome } from "@/components/coupons-home";

// Coupons: the customer's home. First open asks "I'm here to buy / I run a shop" (stored in this
// browser); a shop is sent to its workspace. Promos: GET /api/promotions, polled.
export default function Home() {
  return (
    <Suspense>
      <CouponsHome />
    </Suspense>
  );
}
