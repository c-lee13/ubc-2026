import type { MarketWindow } from "@hedged/shared";
import {
  ApiError,
  type CreatePromotionDto,
  type DashboardDto,
  type PurchaseReceiptDto,
} from "./api";
import { api, chain } from "./client";
import { store } from "./hooks";

/**
 * Shop-side logic shared by the dashboard, Create promotion and Claims: unfinished publishes kept
 * in this browser, the publish confirmation retry, and a promo's purchase list. No UI here.
 */

export type DashboardPromo = DashboardDto["promotions"][number];

/** Time to approve the promo in the wallet and have the backend verify it before sales close. */
export const MIN_LEAD_SECS = 150;

/** A SOL window can still be sold: enough time before its deadline, and a live price. */
export function windowUsable(w: MarketWindow, now: number): { ok: boolean; why?: string } {
  if (w.recommendedDepositDeadline - now < MIN_LEAD_SECS)
    return { ok: false, why: "Too late to sell" };
  if (!w.bestAskMicroUsd) return { ok: false, why: "No sellers yet" };
  return { ok: true };
}

/* ---------- unfinished publishes (resume from the dashboard) ---------- */

/** Unfinished publish, kept so a closed tab can finish later. */
export interface LocalDraft {
  promotionId: string;
  init: CreatePromotionDto["initializePromo"];
  /** bytes32 promo id, once the wallet approved creating it. */
  promoId?: string;
}
export const draftKey = (merchant: string) => `hedged:drafts:${merchant}`;

export function localDrafts(merchant: string): LocalDraft[] {
  return store.get<LocalDraft[]>(draftKey(merchant)) ?? [];
}

export function saveDraft(merchant: string, d: LocalDraft) {
  const all = localDrafts(merchant);
  store.set(draftKey(merchant), [...all.filter((x) => x.promotionId !== d.promotionId), d]);
}

export function removeDraft(merchant: string, promotionId: string) {
  store.set(
    draftKey(merchant),
    localDrafts(merchant).filter((x) => x.promotionId !== promotionId),
  );
}

/** The backend reads the promo from Arc and activates it once every field matches. */
export async function confirmWithRetry(promotionId: string, promoPda: string): Promise<void> {
  const end = Date.now() + 75_000;
  for (;;) {
    try {
      await api.confirmPromotion(promotionId, promoPda);
      return;
    } catch (err) {
      const retry = err instanceof ApiError && err.code === "promo_not_found_on_chain_yet";
      if (!retry || Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/* ---------- a promo's purchases ---------- */

export interface PurchaseList {
  rows: PurchaseReceiptDto[];
  /** Where the list came from, for the honest footnote. */
  source: "api" | "chain";
}

/**
 * A promo's purchases. Preferred: GET /api/promotions/:id/purchases (PROPOSED, not in apps/api
 * yet). Fallback: read the purchase keys from the Arc escrow (needs NEXT_PUBLIC_ARC_ESCROW_ADDRESS)
 * and fetch each receipt. Null when neither is available.
 */
export async function loadPurchases(p: {
  id: string;
  promoPda: string | null;
}): Promise<PurchaseList | null> {
  try {
    return { rows: (await api.promotionPurchases(p.id)).purchases, source: "api" };
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
  const reads = chain().reads;
  if (!reads || !p.promoPda) return null;
  const onChain = await reads.purchasesOf(p.promoPda);
  const rows = await Promise.all(onChain.map((c) => api.purchase(c.purchasePda).catch(() => null)));
  return { rows: rows.filter((r): r is PurchaseReceiptDto => r !== null), source: "chain" };
}

/** Totals across a shop's promos (hedge figures are SIMULATED). */
export function sumStats(promos: DashboardPromo[]) {
  let purchases = 0,
    hedged = 0,
    refunded = 0,
    premium = 0n,
    open = 0;
  for (const p of promos) {
    purchases += p.stats.purchases;
    hedged += p.stats.hedged;
    refunded += p.stats.refundedOrCancelled;
    premium += BigInt(p.stats.premium);
    if (p.live?.phase === "LIVE" || p.live?.phase === "PAUSED") open += 1;
  }
  return { purchases, hedged, refunded, premium, open };
}
