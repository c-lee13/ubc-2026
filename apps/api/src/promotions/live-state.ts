import type { HedgeRow, PromotionRow, PurchaseRow } from "../store/types";
import { BASE_UNITS_PER_HUNDREDTH, hundredthsToQty, qtyToHundredths } from "../gemini/decimal";

/**
 * What a customer (directory) or merchant (dashboard) should see for a promotion right now.
 * Pure functions: callers pass the live Gemini ask (or null if unavailable) and the clock.
 *
 * Phases:
 *   LIVE                selling: before the deadline, live price within the shop's threshold
 *   PAUSED              before the deadline but not selling (price above threshold, budget used,
 *                       or no live price); checkout should not take payment
 *   WAITING_FOR_RESULT  deadline passed; waiting for Gemini's official result
 *   RESULT_YES / RESULT_NO  resolved on-chain
 */
export type PromoPhase = "LIVE" | "PAUSED" | "WAITING_FOR_RESULT" | "RESULT_YES" | "RESULT_NO";
export type PauseReason =
  | "PRICE_ABOVE_THRESHOLD"
  /** Within the safety buffer under the threshold: a small move would fail the hedge after payment. */
  | "PRICE_NEAR_THRESHOLD"
  | "BUDGET_USED"
  | "NO_LIVE_PRICE";

/**
 * Checkout only opens when the live price is a little UNDER the shop's threshold, so a price tick
 * between "can buy" and the hedge doesn't turn into "paid, then refunded". 2 cents, or a fifth of
 * the threshold for very low thresholds (a 5% shop gets a 1-cent buffer instead of being blocked).
 */
export function buyBuffer(maxYesPriceMicroUsd: bigint): bigint {
  const fifth = maxYesPriceMicroUsd / 5n;
  return fifth < 20_000n ? fifth : 20_000n;
}

export interface LiveState {
  phase: PromoPhase;
  pauseReason: PauseReason | null;
  /** True only when a customer should be allowed to pay right now. */
  canBuy: boolean;
  /** Live best YES ask in micro-USD = market-implied chance the item ends up free. */
  liveAskMicroUsd: string | null;
  /** Simulated hedge cost for one more sale at the live ask (base units). */
  costPerSale: string | null;
  /** Shop's threshold as a share of the item price, in basis points (cap 0.10 = 1000 bps). */
  thresholdBps: number;
  budgetRemaining: string;
}

export function liveState(
  promo: PromotionRow,
  liveAskMicroUsd: bigint | null,
  nowUnix: number,
): LiveState {
  const thresholdBps = Number((promo.maxYesPriceMicroUsd * 10_000n) / 1_000_000n);
  const budgetRemaining = promo.hedgeBudget - promo.reservedPremium;
  const costPerSale =
    liveAskMicroUsd === null ? null : (promo.offerAmount * liveAskMicroUsd + 999_999n) / 1_000_000n;
  const base = {
    liveAskMicroUsd: liveAskMicroUsd?.toString() ?? null,
    costPerSale: costPerSale?.toString() ?? null,
    thresholdBps,
    budgetRemaining: budgetRemaining.toString(),
  };

  if (promo.onChainState === "ResolvedYes") {
    return { ...base, phase: "RESULT_YES", pauseReason: null, canBuy: false };
  }
  if (promo.onChainState === "ResolvedNo") {
    return { ...base, phase: "RESULT_NO", pauseReason: null, canBuy: false };
  }
  if (nowUnix >= promo.depositDeadline) {
    return { ...base, phase: "WAITING_FOR_RESULT", pauseReason: null, canBuy: false };
  }
  const pause = (pauseReason: PauseReason): LiveState => ({
    ...base,
    phase: "PAUSED",
    pauseReason,
    canBuy: false,
  });
  if (liveAskMicroUsd === null || costPerSale === null) return pause("NO_LIVE_PRICE");
  if (liveAskMicroUsd > promo.maxYesPriceMicroUsd) return pause("PRICE_ABOVE_THRESHOLD");
  if (liveAskMicroUsd > promo.maxYesPriceMicroUsd - buyBuffer(promo.maxYesPriceMicroUsd)) {
    return pause("PRICE_NEAR_THRESHOLD");
  }
  if (costPerSale > budgetRemaining) return pause("BUDGET_USED");
  return { ...base, phase: "LIVE", pauseReason: null, canBuy: true };
}

export interface PromoStats {
  purchases: number;
  hedged: number;
  refundedOrCancelled: number;
  /** Gross sales held for hedged purchases (base units). */
  hedgedSales: string;
  /** Simulated YES contracts held (decimal string). */
  contracts: string;
  /** Simulated premium spent (base units). */
  premium: string;
  /**
   * What the shop keeps from hedged sales in each outcome, before cost of goods (base units).
   * SIMULATED: assumes the simulated fills were real. Equal in both outcomes when fully hedged.
   */
  ifYes: string;
  ifNo: string;
}

export function promoStats(purchases: PurchaseRow[], hedges: HedgeRow[]): PromoStats {
  const live = new Set(["SIMULATED_FILLED", "SETTLED_WIN", "SETTLED_LOSS"]);
  const byPurchase = new Map(hedges.map((h) => [h.purchaseId, h]));
  let hedgedSales = 0n;
  let contractsH = 0n;
  let premium = 0n;
  let hedged = 0;
  let refunded = 0;
  for (const p of purchases) {
    const h = byPurchase.get(p.id);
    if (h && live.has(h.status) && ["HEDGED", "RESOLVED", "CLAIMED"].includes(p.status)) {
      hedged++;
      hedgedSales += p.amount;
      contractsH += qtyToHundredths(h.filledContracts);
      premium += h.premium ?? 0n;
    }
    if (["CANCELLED", "REFUNDED", "CANCEL_PENDING", "HEDGE_FAILED"].includes(p.status)) refunded++;
  }
  const payoutIfYes = contractsH * BASE_UNITS_PER_HUNDREDTH;
  return {
    purchases: purchases.length,
    hedged,
    refundedOrCancelled: refunded,
    hedgedSales: hedgedSales.toString(),
    contracts: hundredthsToQty(contractsH),
    premium: premium.toString(),
    // YES: sales refunded to customers, contracts pay out. NO: shop keeps sales, contracts expire.
    ifYes: (payoutIfYes - premium).toString(),
    ifNo: (hedgedSales - premium).toString(),
  };
}

/**
 * Public view of a live state: drops the shop's threshold and remaining budget, which competitors
 * should not see. `costPerSale` and the live price stay: they come from public Gemini prices.
 */
export function publicLiveState(s: LiveState): Omit<LiveState, "thresholdBps" | "budgetRemaining"> {
  const { thresholdBps: _t, budgetRemaining: _b, ...rest } = s;
  return rest;
}
