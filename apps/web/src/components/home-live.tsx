"use client";

import { DEMO_PURCHASE_AMOUNT } from "@hedged/shared";
import type { ReactNode } from "react";
import { api } from "@/lib/client";
import { cents, clock, conditionText, usd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { ButtonLink, SimTag } from "./ui";
import { Voucher } from "./voucher";

/** Calls to action: the shop side, and the best live promo to buy (or Discover). */
export function HomeLive() {
  const promos = usePoll(() => api.promotions(), 15_000);
  const live = promos.data?.promotions.find((p) => p.live?.canBuy);
  return (
    <div className="mt-9 flex flex-wrap gap-3">
      <ButtonLink href="/merchant" size="lg">
        Run a promo
      </ButtonLink>
      <ButtonLink href={live ? `/checkout/${live.id}` : "/discover"} size="lg" variant="secondary">
        {live ? `Buy a ${live.itemName.toLowerCase()}` : "Find a promo"}
      </ButtonLink>
    </div>
  );
}

/** The hero voucher: the real live promo when one is selling, else a sample. */
export function HomeVoucher() {
  const promos = usePoll(() => api.promotions(), 15_000);
  const p = promos.data?.promotions.find((x) => x.live?.canBuy);
  return p ? (
    <Voucher
      seed={p.promoPda ?? p.id}
      shopName={p.shop.name}
      itemName={p.itemName}
      amount={p.offerAmount}
      condition={conditionText(p.outcomeLabel, p.geminiMarketId)}
      closesLabel={`Sales close ${clock(p.depositDeadline)}`}
      serial={p.promoPda}
      marketId={p.geminiMarketId}
      stamp={{ text: "SELLING NOW", tone: "note" }}
      tilt
    />
  ) : (
    <Voucher
      seed="hill-country-coffee-sample"
      shopName="Hill Country Coffee"
      itemName="Latte"
      amount={DEMO_PURCHASE_AMOUNT}
      condition="SOL closes up"
      closesLabel="Sales close 5 min before the window"
      serial={null}
      sample
      marketId="GEMI-SOL05M-UP"
      tilt
    />
  );
}

/** Live odds of the next SOL window as three numbers: price, cost to cover, what the shop keeps. */
export function HomeNumbers() {
  const windows = usePoll(() => api.windows("SOL", 5, 12), 20_000);
  const next = windows.data?.windows.find(
    (w) => w.bestAskMicroUsd && w.recommendedDepositDeadline * 1000 > Date.now() + 60_000,
  );
  if (!next?.bestAskMicroUsd) return null;
  const cost = (5_000_000n * BigInt(next.bestAskMicroUsd)) / 1_000_000n;
  return (
    <div
      className="grid grid-cols-1 gap-6 sm:grid-cols-3"
      title={`Gemini's live price for the SOL window ending ${clock(next.expiresAt)}`}
    >
      <Figure big={cents(next.bestAskMicroUsd)} label="Live price of a $1 YES contract" />
      <Figure big={usd(cost)} label="Cost to cover a $5 sale" tag={<SimTag />} />
      <Figure big={usd(5_000_000n - cost)} label="The shop keeps, either way" tag={<SimTag />} />
    </div>
  );
}

function Figure({ big, label, tag }: { big: string; label: string; tag?: ReactNode }) {
  return (
    <div>
      <p className="font-display text-[52px] leading-none sm:text-[64px]">{big}</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[15px] text-ink-soft">
        {label} {tag}
      </p>
    </div>
  );
}
