import type { FastifyInstance } from "fastify";
import { canonical, isChainId, isWalletAddress } from "../chain-ids";
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
  autoPayout = false,
): { step: ReceiptStep; canServe: boolean; message: string } {
  switch (p.status) {
    case "DEPOSITED":
    case "PENDING_HEDGE":
    case "HEDGE_SIMULATED":
      return { step: "PROCESSING", canServe: false, message: "Locking in your promo…" };
    case "HEDGED":
      return promo.resolvedOutcome
        ? resolved(promo.resolvedOutcome, autoPayout)
        : { step: "HEDGED", canServe: true, message: "You're in. Enjoy, and good luck!" };
    case "HEDGE_FAILED":
    case "CANCEL_PENDING":
      return {
        step: "REFUNDING",
        canServe: false,
        message: "This promo isn't available right now. Your payment is being returned.",
      };
    case "CANCELLED":
      return {
        step: "REFUND_READY",
        canServe: false,
        message: autoPayout ? "Your refund is on its way." : "Your refund is ready to claim.",
      };
    case "REFUNDED":
      return { step: "REFUNDED", canServe: false, message: "Refunded." };
    case "RESOLVED":
      return resolved(promo.resolvedOutcome, autoPayout);
    case "CLAIMED":
      return { step: "DONE", canServe: true, message: "All settled." };
  }
}

function resolved(
  outcome: "YES" | "NO" | null,
  autoPayout: boolean,
): {
  step: ReceiptStep;
  canServe: boolean;
  message: string;
} {
  if (outcome === "YES") {
    return {
      step: "YOU_WON",
      canServe: true,
      message: autoPayout
        ? "It happened! Your money back is on its way."
        : "It happened! Your money back is ready.",
    };
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

/** Short code shown on the customer's receipt and the shop's counter screen, so staff can match them. */
export const orderCode = (purchasePda: string): string => purchasePda.slice(-4).toUpperCase();

/** One line of a list (counter screen, "my purchases"): no hedge detail, that's on the receipt. */
function summary(p: PurchaseRow, promo: PromotionRow, autoPayout: boolean) {
  return {
    purchasePda: p.purchasePda,
    orderCode: orderCode(p.purchasePda),
    customer: p.customer,
    amount: p.amount.toString(),
    depositedAt: p.depositedAt,
    status: p.status,
    onChainState: p.onChainState,
    ...receiptStep(p, promo, autoPayout),
    autoPayout,
    receipt: `/api/purchases/${p.purchasePda}`,
  };
}

const MAX_LIST = 50;

export function registerPurchaseRoutes(
  app: FastifyInstance,
  deps: { store: Store; autoPayout?: boolean },
): void {
  const auto = deps.autoPayout ?? false;
  // Counter screen: a promo's purchases, newest first. Everything here is public chain data.
  app.get<{ Params: { id: string } }>("/api/promotions/:id/purchases", async (req, reply) => {
    const promo = await deps.store.getPromotion(req.params.id);
    if (!promo) return reply.code(404).send({ error: "promotion_not_found" });
    const rows = (await deps.store.listPurchases(promo.id))
      .sort((a, b) => b.depositedAt - a.depositedAt)
      .slice(0, MAX_LIST);
    return { promotionId: promo.id, purchases: rows.map((p) => summary(p, promo, auto)) };
  });

  // Customer's own purchases across promos, newest first: GET /api/purchases?customer=<wallet>.
  app.get<{ Querystring: { customer?: string } }>("/api/purchases", async (req, reply) => {
    const raw = req.query.customer;
    if (typeof raw !== "string" || !isWalletAddress(raw)) {
      return reply.code(400).send({ error: "invalid_customer" });
    }
    const rows = await deps.store.listPurchasesByCustomer(canonical(raw), MAX_LIST);
    const promos = new Map<string, PromotionRow | null>();
    const out = [];
    for (const p of rows) {
      if (!promos.has(p.promotionId)) {
        promos.set(p.promotionId, await deps.store.getPromotion(p.promotionId));
      }
      const promo = promos.get(p.promotionId);
      if (!promo) continue;
      out.push({
        ...summary(p, promo, auto),
        promotion: {
          id: promo.id,
          shopName: promo.shopName,
          itemName: promo.itemName,
          outcomeLabel: promo.outcomeLabel,
          resolvedOutcome: promo.resolvedOutcome,
        },
      });
    }
    return { customer: canonical(raw), purchases: out };
  });

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
      orderCode: orderCode(p.purchasePda),
      customer: p.customer,
      amount: p.amount.toString(),
      // Off-chain processing status and authoritative on-chain escrow state, side by side.
      status: p.status,
      onChainState: p.onChainState,
      ...receiptStep(p, promo, auto),
      // true: payouts are sent automatically (v2), so show no claim button.
      autoPayout: auto,
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
