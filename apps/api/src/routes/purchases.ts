import type { FastifyInstance } from "fastify";
import { canonical, isChainId } from "../chain-ids";
import { hedgeFingerprint } from "../hedging/fingerprint";
import type { PromotionRow, PurchaseRow, Store } from "../store/types";

/**
 * What the customer's receipt and the barista's screen show. Derived only from server state
 * (never from client-submitted fields).
 *   canServe: the barista may hand over the item (hedge confirmed on-chain).
 */
export type ReceiptStep =
  | "PROCESSING"
  | "HEDGED"
  | "REFUNDING"
  | "REFUND_READY"
  | "REFUNDED"
  | "WAITING_FOR_RESULT"
  | "YOU_WON"
  | "NOT_THIS_TIME"
  | "DONE";

export function receiptStep(
  p: Pick<PurchaseRow, "status" | "onChainState">,
  promo: Pick<PromotionRow, "resolvedOutcome">,
): { step: ReceiptStep; canServe: boolean; message: string } {
  switch (p.status) {
    case "DEPOSITED":
    case "PENDING_HEDGE":
    case "HEDGE_SIMULATED":
      return { step: "PROCESSING", canServe: false, message: "Locking in your promo…" };
    case "HEDGED":
      return promo.resolvedOutcome
        ? resolved(promo.resolvedOutcome)
        : { step: "HEDGED", canServe: true, message: "You're in. Enjoy, and good luck!" };
    case "HEDGE_FAILED":
    case "CANCEL_PENDING":
      return {
        step: "REFUNDING",
        canServe: false,
        message: "This promo isn't available right now. Your payment is being returned.",
      };
    case "CANCELLED":
      return { step: "REFUND_READY", canServe: false, message: "Your refund is ready to claim." };
    case "REFUNDED":
      return { step: "REFUNDED", canServe: false, message: "Refunded." };
    case "RESOLVED":
      return resolved(promo.resolvedOutcome);
    case "CLAIMED":
      return { step: "DONE", canServe: true, message: "All settled." };
  }
}

function resolved(outcome: "YES" | "NO" | null): {
  step: ReceiptStep;
  canServe: boolean;
  message: string;
} {
  if (outcome === "YES") {
    return { step: "YOU_WON", canServe: true, message: "It happened! Your money back is ready." };
  }
  if (outcome === "NO") {
    return { step: "NOT_THIS_TIME", canServe: true, message: "Not this time. Thanks for playing!" };
  }
  return {
    step: "WAITING_FOR_RESULT",
    canServe: true,
    message: "Waiting for the official result.",
  };
}

export function registerPurchaseRoutes(app: FastifyInstance, deps: { store: Store }): void {
  // Receipt by purchase PDA (the customer's wallet knows it from the deposit transaction).
  app.get<{ Params: { id: string } }>("/api/purchases/:id", async (req, reply) => {
    if (!isChainId(req.params.id)) return reply.code(400).send({ error: "invalid_purchase_pda" });
    const pda = canonical(req.params.id);
    const p = await deps.store.getPurchaseByPda(pda);
    if (!p) return reply.code(404).send({ error: "purchase_not_found" });
    const promo = await deps.store.getPromotion(p.promotionId);
    if (!promo) return reply.code(404).send({ error: "promotion_not_found" });
    const hedge = await deps.store.getHedgeByPurchase(p.id);

    return {
      purchasePda: p.purchasePda,
      customer: p.customer,
      amount: p.amount.toString(),
      // Off-chain processing status and authoritative on-chain escrow state, side by side.
      status: p.status,
      onChainState: p.onChainState,
      ...receiptStep(p, promo),
      promotion: {
        id: promo.id,
        shopName: promo.shopName,
        itemName: promo.itemName,
        outcomeLabel: promo.outcomeLabel,
        geminiMarketId: promo.geminiMarketId,
        resolvedOutcome: promo.resolvedOutcome,
      },
      hedge: hedge && {
        simulated: true,
        status: hedge.status,
        failureReason: hedge.failureReason,
        contracts: hedge.filledContracts,
        avgFillPriceMicroUsd: hedge.avgFillPriceMicroUsd,
        premium: hedge.premium?.toString() ?? null,
        virtualPayout: hedge.virtualPayout?.toString() ?? null,
        quoteFetchedAt: hedge.quoteFetchedAt,
        fingerprint: hedgeFingerprint(p.purchasePda, hedge),
      },
      transactions: {
        deposit: p.depositTxSignature,
        markHedged: p.markHedgedTxSignature,
        cancel: p.cancelTxSignature,
        claim: p.claimTxSignature,
      },
    };
  });
}
