"use client";

import Link from "next/link";
import { DEMO_PURCHASE_AMOUNT } from "@hedged/shared";
import type { PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { clock, conditionText, usd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { BTN_SECONDARY } from "../layout/styles";
import { OutcomePlayground } from "./OutcomePlayground";

/** The first promo selling right now, polled from GET /api/promotions (null until one is). */
function useSellingPromo(): PromotionDto | null {
  const promos = usePoll(() => api.promotions(), 15_000);
  return promos.data?.promotions.find((p) => p.live?.canBuy) ?? null;
}

/**
 * The hero preview: Zahin's Outcome Playground on the promo selling right now, or on Zahin's
 * labeled sample when nothing is selling (or the promo server is offline).
 */
export function HomePlayground() {
  const p = useSellingPromo();
  if (!p) {
    return (
      <OutcomePlayground
        merchantName="Sample Merchant"
        name="Sample Outcome Refund"
        description="A fictional product or service used to demonstrate how an outcome-based refund promotion looks."
        price={usd(DEMO_PURCHASE_AMOUNT)}
        refundCondition="the example outcome happens"
        live={false}
        marketId={null}
        checkoutHref="/discover"
      />
    );
  }
  const price = usd(p.offerAmount);
  return (
    <OutcomePlayground
      merchantName={p.shop.name}
      name={p.itemName}
      description={`Pay ${price} for a ${p.itemName.toLowerCase()}. Sales close at ${clock(p.depositDeadline)}.`}
      price={price}
      refundCondition={conditionText(p.outcomeLabel, p.geminiMarketId)}
      live
      marketId={p.geminiMarketId}
      checkoutHref={`/checkout/${p.id}`}
    />
  );
}

/** Hero secondary action: straight to the live promo's checkout, else the list of offers. */
export function ExploreDemoLink() {
  const p = useSellingPromo();
  return (
    <Link href={p ? `/checkout/${p.id}` : "/discover"} className={BTN_SECONDARY}>
      Explore demo
    </Link>
  );
}
