"use client";

import { api } from "@/lib/client";
import { cents, clock, usd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { ButtonLink } from "./ui";

/** Calls to action: the merchant side, and the best live promo to buy (if any). */
export function HomeLive() {
  const promos = usePoll(() => api.promotions(), 15_000);
  const live = promos.data?.promotions.find((p) => p.live?.canBuy);

  return (
    <div className="mt-9">
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/merchant" size="lg">
          Run a promo
        </ButtonLink>
        <ButtonLink
          href={live ? `/checkout/${live.id}` : "/discover"}
          size="lg"
          variant="secondary"
        >
          {live ? `Buy a ${live.itemName.toLowerCase()}` : "Find a promo"}
        </ButtonLink>
      </div>
      <p className="mt-3 text-[14px] text-ink-soft" aria-live="polite">
        {promos.error && !promos.data
          ? "The promo server is offline right now, so live promos can't be listed."
          : promos.loading && !promos.data
            ? "Looking for a live promo…"
            : live
              ? `${live.shop.name} is selling now: ${live.itemName}, ${usd(live.offerAmount)}, money back if ${live.outcomeLabel.replace(/\.$/, "")}.`
              : "No promo is selling right now. Start one as a shop, then buy it with another email."}
      </p>
    </div>
  );
}

/** Live odds of the next SOL window and what that means for one $5 refund. */
export function HomeOdds() {
  const windows = usePoll(() => api.windows("SOL", 5, 12), 20_000);
  const next = windows.data?.windows.find(
    (w) => w.bestAskMicroUsd && w.recommendedDepositDeadline * 1000 > Date.now() + 60_000,
  );
  if (!next?.bestAskMicroUsd) return null;
  const cost = (5_000_000n * BigInt(next.bestAskMicroUsd)) / 1_000_000n;
  return (
    <p className="text-[14px] text-ink-soft">
      <span className="font-semibold text-ink">Live on Gemini:</span> the SOL window closing at{" "}
      {clock(next.expiresAt)} sells at {cents(next.bestAskMicroUsd)}. Covering a $5 refund costs{" "}
      {usd(cost)}, so the shop keeps {usd(5_000_000n - cost)} of each sale whichever way SOL moves,
      before the cost of the coffee.
    </p>
  );
}
