"use client";

import { DEMO_PURCHASE_AMOUNT } from "@hedged/shared";
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

/** Live odds of the next SOL window as one line: sale minus cover equals what the shop keeps. */
export function HomeNumbers() {
  const windows = usePoll(() => api.windows("SOL", 5, 12), 20_000);
  const next = windows.data?.windows.find(
    (w) => w.bestAskMicroUsd && w.recommendedDepositDeadline * 1000 > Date.now() + 60_000,
  );
  if (!next?.bestAskMicroUsd) return null;
  const cost = (5_000_000n * BigInt(next.bestAskMicroUsd)) / 1_000_000n;
  return (
    <div
      title={`Gemini's live price for the SOL window ending ${clock(next.expiresAt)}: ${cents(next.bestAskMicroUsd)} per $1 contract.`}
    >
      {/* Phones: a vertical sum (operators in the left column); wider: one line. */}
      <p className="font-display flex flex-wrap items-baseline gap-x-4 gap-y-2 text-[64px] leading-none max-sm:grid max-sm:grid-cols-[auto_1fr] max-sm:gap-x-3 max-sm:gap-y-4 max-sm:text-[44px]">
        <span aria-hidden className="sm:hidden" />
        <Term big="$5" label="sale" />
        <span className="text-ink-faint">−</span>
        <Term big={usd(cost).replace(/\.00$/, "")} label="cover" sim />
        <span className="text-ink-faint">=</span>
        <Term big={usd(5_000_000n - cost).replace(/\.00$/, "")} label="kept, either way" sim note />
      </p>
    </div>
  );
}

function Term({
  big,
  label,
  sim,
  note,
}: {
  big: string;
  label: string;
  sim?: boolean;
  note?: boolean;
}) {
  return (
    <span className="inline-flex flex-col max-sm:flex-row max-sm:items-baseline max-sm:gap-3">
      <span className={note ? "text-note" : undefined}>{big}</span>
      <span className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-[14px] max-sm:mt-0 font-semibold tracking-normal text-ink-soft [font-stretch:100%] [font-variation-settings:normal]">
        {label} {sim ? <SimTag /> : null}
      </span>
    </span>
  );
}
