import type { PurchaseReceiptDto } from "./api";
import { store } from "./hooks";

/**
 * Customer purchases: what this browser remembers, and how a receipt from GET /api/purchases/:key
 * reads in words. Pure logic, shared by checkout, the receipt page, My purchases and the claims page.
 */

/** A purchase key: bytes32 hex from the Arc escrow (purchaseKeyOf(promo, customer, id)). */
export const PURCHASE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * Purchases made in this browser, per wallet. The main list is the server's
 * (GET /api/purchases?customer=); this only covers the moments before it sees a new payment.
 */
export const myPurchasesKey = (wallet: string) => `hedged:purchases:${wallet.toLowerCase()}`;
export interface MyPurchase {
  purchaseKey: string;
  promotionId: string;
  at: number;
}

export function rememberPurchase(wallet: string, p: MyPurchase) {
  const all = store.get<MyPurchase[]>(myPurchasesKey(wallet)) ?? [];
  store.set(myPurchasesKey(wallet), [...all.filter((x) => x.purchaseKey !== p.purchaseKey), p]);
}

/**
 * Escrow v2 pays out automatically. Only when a payout has not arrived this long after this browser
 * first saw it due (REFUND_READY / YOU_WON, or a NO result for the shop) is the manual claim offered.
 */
export const STUCK_AFTER_SECS = 180;

/** The contract lets a customer cancel a still-uncovered payment this long after paying (Arc demo config). */
export const CANCEL_AFTER_SECS = 600;

/** Escrow states where the purchase's money is still inside the escrow. */
export const HELD = new Set(["Deposited", "Hedged", "Cancelled"]);

/** The on-chain escrow state in words (the authoritative state for the money). */
export const ESCROW_STATE_TEXT: Record<PurchaseReceiptDto["onChainState"], string> = {
  Deposited: "Paid, not covered yet",
  Hedged: "Covered",
  Cancelled: "Refund ready",
  Refunded: "Refunded",
  ClaimedByCustomer: "Paid back to the customer",
  ClaimedByMerchant: "Collected by the shop",
};

/** Why a simulated hedge failed, in words. */
export function failureText(reason: string): string {
  return (
    {
      QUOTE_OVER_CAP: "price over the shop's limit",
      QUOTE_STALE: "price too old",
      QUOTE_UNAVAILABLE: "no live price",
      INSUFFICIENT_LIQUIDITY: "not enough on sale",
      PARTIAL_FILL: "only partly fillable",
      BUDGET_EXCEEDED: "budget used up",
      MARK_HEDGED_FAILED: "couldn't confirm on chain in time",
    }[reason] ?? reason
  );
}

/** The customer can move the money back: a refund entitlement, or a covered purchase that won. */
export function refundClaimable(r: PurchaseReceiptDto): boolean {
  return (
    r.onChainState === "Cancelled" ||
    (r.onChainState === "Hedged" && r.promotion.resolvedOutcome === "YES")
  );
}

export type StageState = "todo" | "doing" | "done" | "failed" | "skipped";

/**
 * The four receipt stages (paid, covered, result, money) from the escrow state and the promo's
 * official result. Only on-chain facts mark a stage done.
 */
export function receiptStages(r: PurchaseReceiptDto | null): {
  paid: StageState;
  covered: StageState;
  result: StageState;
  money: StageState;
} {
  if (!r) return { paid: "doing", covered: "todo", result: "todo", money: "todo" };
  const s = r.onChainState;
  if (s === "Cancelled" || s === "Refunded" || r.step === "REFUNDING") {
    return {
      paid: "done",
      covered: s === "Deposited" ? "doing" : "failed",
      result: "skipped",
      money: s === "Refunded" ? "done" : "doing",
    };
  }
  if (s === "Deposited") return { paid: "done", covered: "doing", result: "todo", money: "todo" };
  const outcome = r.promotion.resolvedOutcome;
  if (!outcome) return { paid: "done", covered: "done", result: "doing", money: "todo" };
  if (outcome === "YES") {
    return {
      paid: "done",
      covered: "done",
      result: "done",
      money: s === "ClaimedByCustomer" ? "done" : "doing",
    };
  }
  return { paid: "done", covered: "done", result: "done", money: "done" };
}

/** The receipt's headline, from the server's receipt step. */
export function receiptHeadline(r: PurchaseReceiptDto | null, item: string): string {
  if (!r) return "Confirming your payment";
  switch (r.step) {
    case "PROCESSING":
      return "One moment…";
    case "REFUNDING":
    case "REFUND_READY":
      return "Your payment is coming back";
    case "REFUNDED":
      return "Refunded";
    case "YOU_WON":
      return `Free ${item.toLowerCase()}!`;
    case "NOT_THIS_TIME":
      return "Not this time";
    case "DONE":
      return "All settled";
    default:
      return "You're in";
  }
}
