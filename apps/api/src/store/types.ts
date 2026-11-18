import type {
  Base58,
  DepositEvent,
  HedgeFailureReason,
  HedgeStatus,
  MarketOutcome,
  MarketQuote,
  OnChainPromoState,
  OnChainPurchaseState,
  PurchaseStatus,
} from "@hedged/shared";

/**
 * Persistence boundary for the orchestrator. Mirrors supabase/migrations/*_init.sql. Two
 * implementations: MemoryStore (tests / local dev, clearly not durable) and a Supabase store.
 * Every method that guards an invariant (CAS transitions, one hedge per purchase, budget
 * reservation) must do so atomically in the implementation, not in the caller.
 */

/**
 * DRAFT = saved by POST /api/promotions, not yet on-chain. ACTIVE = initialize_promo verified on
 * chain with matching parameters (that verification is what proves the merchant owns the wallet).
 */
export type PromotionStatus = "DRAFT" | "ACTIVE";

export interface MerchantRow {
  /** Merchant wallet (base58). */
  pubkey: Base58;
  shopName: string;
  /** Free text, e.g. "Guadalupe St, Austin". */
  location: string;
  createdAt: string;
}

export interface PromotionRow {
  id: string;
  status: PromotionStatus;
  /** Null while DRAFT. */
  promoPda: Base58 | null;
  /** u64 promo PDA seed as a decimal string, chosen by the backend at draft time. */
  promoNonce: string;
  /** Mock USD mint, recorded from chain on activation. */
  mint: Base58 | null;
  merchant: Base58;
  /** What the customer buys, e.g. "Latte". */
  itemName: string;
  /**
   * Shop profile as submitted with this promo. Anyone can submit a draft naming any wallet, so the
   * merchants table is only updated from a promo the wallet itself activated on-chain.
   */
  shopName: string;
  location: string;
  offerAmount: bigint;
  depositDeadline: number;
  onChainState: OnChainPromoState;
  geminiMarketId: string;
  outcomeLabel: string;
  maxYesPriceMicroUsd: bigint;
  hedgeBudget: bigint;
  reservedPremium: bigint;
  resolvedOutcome: "YES" | "NO" | null;
  resolveTxSignature: Base58 | null;
  createdAt: string;
}

export interface PurchaseRow {
  id: string;
  promotionId: string;
  purchasePda: Base58;
  purchaseIdHex: string;
  customer: Base58;
  amount: bigint;
  depositTxSignature: Base58;
  depositEventIndex: number;
  depositedAt: number;
  onChainState: OnChainPurchaseState;
  status: PurchaseStatus;
  attempts: number;
  lastError: string | null;
  needsReconciliation: boolean;
  markHedgedTxSignature: Base58 | null;
  cancelTxSignature: Base58 | null;
  claimTxSignature: Base58 | null;
}

export interface HedgeRow {
  id: string;
  purchaseId: string;
  promotionId: string;
  simulated: true;
  marketId: string;
  quoteId: string | null;
  status: HedgeStatus;
  failureReason: HedgeFailureReason | null;
  requestedContracts: string;
  filledContracts: string;
  avgFillPriceMicroUsd: string | null;
  premium: bigint | null;
  modeledFee: bigint;
  reservedPremium: bigint;
  virtualPayout: bigint | null;
  assumptions: string[];
  quoteFetchedAt: string | null;
  settledAt: string | null;
}

export type NewHedge = Omit<
  HedgeRow,
  "id" | "reservedPremium" | "virtualPayout" | "settledAt" | "simulated"
>;

/** One SIMULATED exposure-desk trade (no Gemini order is placed). */
export interface DeskFillRow {
  id: string;
  simulated: true;
  eventTicker: string;
  marketId: string;
  side: "BUY" | "SELL";
  /** Contracts (decimal string, 0.01 steps). */
  contracts: string;
  /** Base units paid (BUY) or received (SELL). */
  amount: bigint;
  avgPriceMicroUsd: string;
  quoteFetchedAt: string;
  createdAt: string;
}

export type NewDeskFill = Omit<DeskFillRow, "id" | "simulated" | "createdAt">;

export class BudgetExceededError extends Error {
  constructor() {
    super("Simulated premium exceeds the promotion's remaining hedge budget");
    this.name = "BudgetExceededError";
  }
}

/** status is derived: ACTIVE when promoPda is given (tests/imports), otherwise DRAFT. */
export type NewPromotion = Omit<
  PromotionRow,
  | "id"
  | "status"
  | "reservedPremium"
  | "resolvedOutcome"
  | "resolveTxSignature"
  | "onChainState"
  | "createdAt"
>;

export class PromotionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotionConflictError";
  }
}

export interface Store {
  upsertMerchant(merchant: Omit<MerchantRow, "createdAt">): Promise<MerchantRow>;
  getMerchant(pubkey: Base58): Promise<MerchantRow | null>;

  createPromotion(promotion: NewPromotion): Promise<PromotionRow>;
  /**
   * DRAFT -> ACTIVE once the on-chain promo is verified. Idempotent for the same promoPda; throws
   * PromotionConflictError if already active with a different PDA or the PDA is taken.
   */
  activatePromotion(id: string, onChain: { promoPda: Base58; mint: Base58 }): Promise<PromotionRow>;
  listPromotions(filter?: { status?: PromotionStatus; merchant?: Base58 }): Promise<PromotionRow[]>;
  getPromotionByPda(promoPda: Base58): Promise<PromotionRow | null>;
  getPromotion(id: string): Promise<PromotionRow | null>;
  /** Promotions still Active on-chain (reconciliation sweep). */
  listActivePromotions(): Promise<PromotionRow[]>;
  /** Promotions still Active on-chain whose deposit deadline has passed. */
  listPromotionsDueForResolution(nowUnix: number): Promise<PromotionRow[]>;
  setPromotionResolved(
    id: string,
    outcome: "YES" | "NO",
    txSignature: Base58 | null,
  ): Promise<void>;

  /**
   * Record a verified deposit. Idempotent on (signature, eventIndex) AND on purchasePda: a
   * duplicate returns the existing row with created=false.
   */
  recordDeposit(
    event: DepositEvent,
    promotionId: string,
  ): Promise<{ purchase: PurchaseRow; created: boolean }>;
  getPurchaseByPda(purchasePda: Base58): Promise<PurchaseRow | null>;
  listPurchases(promotionId: string): Promise<PurchaseRow[]>;
  /** A customer's purchases across all promos, newest first (customer as stored: canonical). */
  listPurchasesByCustomer(customer: Base58, limit: number): Promise<PurchaseRow[]>;
  /** Compare-and-set. Returns the updated row, or null if status was not in `from`. */
  transitionPurchase(
    purchasePda: Base58,
    from: readonly PurchaseStatus[],
    to: PurchaseStatus,
    patch?: Partial<
      Pick<
        PurchaseRow,
        | "lastError"
        | "onChainState"
        | "needsReconciliation"
        | "markHedgedTxSignature"
        | "cancelTxSignature"
        | "claimTxSignature"
      >
    >,
  ): Promise<PurchaseRow | null>;
  /** Non-status bookkeeping (errors, flags, mirrored on-chain state). */
  patchPurchase(
    purchasePda: Base58,
    patch: Partial<Pick<PurchaseRow, "lastError" | "onChainState" | "needsReconciliation">>,
  ): Promise<void>;

  recordQuote(quote: MarketQuote): Promise<string>;
  /**
   * Insert the single hedge for a purchase, reserving its premium (if filled) against the
   * promotion budget atomically. Returns the existing hedge unchanged if one exists. Throws
   * BudgetExceededError if the reservation does not fit.
   */
  reserveHedge(hedge: NewHedge): Promise<HedgeRow>;
  getHedgeByPurchase(purchaseId: string): Promise<HedgeRow | null>;
  listHedgesByPromotion(promotionId: string): Promise<HedgeRow[]>;
  /** Void a live simulated hedge and release its reservation. Idempotent. */
  voidHedge(hedgeId: string, reason: HedgeFailureReason): Promise<HedgeRow>;
  settleHedge(
    hedgeId: string,
    settlement: {
      status: "SETTLED_WIN" | "SETTLED_LOSS";
      virtualPayout: bigint;
      settledAt: string;
    },
  ): Promise<void>;

  saveOutcome(outcome: MarketOutcome): Promise<void>;

  recordDeskFill(fill: NewDeskFill): Promise<DeskFillRow>;
  /** All desk fills, oldest first (optionally for one event). */
  listDeskFills(eventTicker?: string): Promise<DeskFillRow[]>;

  /** Dedupe any verified chain event. Returns false if it was already recorded. */
  markEventProcessed(
    eventId: string,
    name: string,
    slot: number,
    payload: unknown,
  ): Promise<boolean>;
  getCheckpoint(name: string): Promise<number | null>;
  setCheckpoint(name: string, slot: number): Promise<void>;
}
