import { randomUUID } from "node:crypto";
import {
  chainEventId,
  type DepositEvent,
  type MarketOutcome,
  type MarketQuote,
} from "@hedged/shared";
import {
  BudgetExceededError,
  PromotionConflictError,
  type DeskFillRow,
  type HedgeRow,
  type MerchantRow,
  type NewDeskFill,
  type NewHedge,
  type NewPromotion,
  type PromotionRow,
  type PromotionStatus,
  type PurchaseRow,
  type Store,
} from "./types";

/**
 * IN-MEMORY store for tests and local development only. Not durable: everything is lost on
 * restart. Single-process, so each method body runs atomically (no awaits inside), which matches
 * the guarantees the Supabase functions give with row locks.
 */
export class MemoryStore implements Store {
  readonly promotions = new Map<string, PromotionRow>();
  readonly purchases = new Map<string, PurchaseRow>(); // by purchasePda
  readonly hedges = new Map<string, HedgeRow>(); // by id
  readonly quotes: (MarketQuote & { id: string })[] = [];
  readonly outcomes = new Map<string, MarketOutcome>();
  readonly events = new Set<string>();
  readonly checkpoints = new Map<string, number>();
  readonly merchants = new Map<string, MerchantRow>();
  readonly deskFills: DeskFillRow[] = [];

  async recordDeskFill(f: NewDeskFill): Promise<DeskFillRow> {
    const row: DeskFillRow = {
      ...f,
      id: randomUUID(),
      simulated: true,
      createdAt: new Date().toISOString(),
    };
    this.deskFills.push(row);
    return { ...row };
  }

  async listDeskFills(eventTicker?: string) {
    return this.deskFills
      .filter((f) => !eventTicker || f.eventTicker === eventTicker)
      .map((f) => ({ ...f }));
  }

  async upsertMerchant(m: Omit<MerchantRow, "createdAt">): Promise<MerchantRow> {
    const existing = this.merchants.get(m.pubkey);
    const row: MerchantRow = { ...m, createdAt: existing?.createdAt ?? new Date().toISOString() };
    this.merchants.set(m.pubkey, row);
    return { ...row };
  }

  async getMerchant(pubkey: string) {
    const m = this.merchants.get(pubkey);
    return m ? { ...m } : null;
  }

  async createPromotion(p: NewPromotion): Promise<PromotionRow> {
    const row: PromotionRow = {
      ...p,
      id: randomUUID(),
      status: p.promoPda ? "ACTIVE" : "DRAFT",
      createdAt: new Date().toISOString(),
      reservedPremium: 0n,
      onChainState: "Active",
      resolvedOutcome: null,
      resolveTxSignature: null,
    };
    this.promotions.set(row.id, row);
    return { ...row };
  }

  async activatePromotion(id: string, onChain: { promoPda: string; mint: string }) {
    const p = this.mustPromotion(id);
    if (p.status === "ACTIVE") {
      if (p.promoPda !== onChain.promoPda) {
        throw new PromotionConflictError(`promotion ${id} already active as ${p.promoPda}`);
      }
      return { ...p };
    }
    const taken = [...this.promotions.values()].some((r) => r.promoPda === onChain.promoPda);
    if (taken) throw new PromotionConflictError(`promo PDA ${onChain.promoPda} already registered`);
    Object.assign(p, { status: "ACTIVE", promoPda: onChain.promoPda, mint: onChain.mint });
    return { ...p };
  }

  async listPromotions(filter: { status?: PromotionStatus; merchant?: string } = {}) {
    return [...this.promotions.values()]
      .filter((p) => !filter.status || p.status === filter.status)
      .filter((p) => !filter.merchant || p.merchant === filter.merchant)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => ({ ...p }));
  }

  async getPromotionByPda(promoPda: string) {
    const p = [...this.promotions.values()].find(
      (r) => r.status === "ACTIVE" && r.promoPda === promoPda,
    );
    return p ? { ...p } : null;
  }

  async getPromotion(id: string) {
    const p = this.promotions.get(id);
    return p ? { ...p } : null;
  }

  async listActivePromotions() {
    return [...this.promotions.values()]
      .filter((p) => p.status === "ACTIVE" && p.onChainState === "Active")
      .map((p) => ({ ...p }));
  }

  async listPromotionsDueForResolution(nowUnix: number) {
    return [...this.promotions.values()]
      .filter(
        (p) => p.status === "ACTIVE" && p.onChainState === "Active" && nowUnix >= p.depositDeadline,
      )
      .map((p) => ({ ...p }));
  }

  async setPromotionResolved(id: string, outcome: "YES" | "NO", txSignature: string | null) {
    const p = this.mustPromotion(id);
    p.onChainState = outcome === "YES" ? "ResolvedYes" : "ResolvedNo";
    p.resolvedOutcome = outcome;
    p.resolveTxSignature = txSignature ?? p.resolveTxSignature;
  }

  async recordDeposit(e: DepositEvent, promotionId: string) {
    const existing =
      this.purchases.get(e.purchase) ??
      [...this.purchases.values()].find(
        (r) => r.depositTxSignature === e.signature && r.depositEventIndex === e.eventIndex,
      );
    if (existing) return { purchase: { ...existing }, created: false };
    const row: PurchaseRow = {
      id: randomUUID(),
      promotionId,
      purchasePda: e.purchase,
      purchaseIdHex: e.purchaseId,
      customer: e.customer,
      amount: BigInt(e.amount),
      depositTxSignature: e.signature,
      depositEventIndex: e.eventIndex,
      depositedAt: e.depositedAt,
      onChainState: "Deposited",
      status: "DEPOSITED",
      attempts: 0,
      lastError: null,
      needsReconciliation: false,
      markHedgedTxSignature: null,
      cancelTxSignature: null,
      claimTxSignature: null,
    };
    this.purchases.set(row.purchasePda, row);
    this.events.add(chainEventId(e));
    return { purchase: { ...row }, created: true };
  }

  async getPurchaseByPda(pda: string) {
    const p = this.purchases.get(pda);
    return p ? { ...p } : null;
  }

  async listPurchases(promotionId: string) {
    return [...this.purchases.values()]
      .filter((p) => p.promotionId === promotionId)
      .map((p) => ({ ...p }));
  }

  async listPurchasesByCustomer(customer: string, limit: number) {
    return [...this.purchases.values()]
      .filter((p) => p.customer === customer)
      .sort((a, b) => b.depositedAt - a.depositedAt)
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async transitionPurchase(
    pda: string,
    from: readonly PurchaseRow["status"][],
    to: PurchaseRow["status"],
    patch: Partial<PurchaseRow> = {},
  ) {
    const p = this.purchases.get(pda);
    if (!p || !from.includes(p.status)) return null;
    Object.assign(p, patch, { status: to });
    if (to === "PENDING_HEDGE") p.attempts += 1;
    if (!("lastError" in patch)) p.lastError = null;
    return { ...p };
  }

  async patchPurchase(pda: string, patch: Partial<PurchaseRow>) {
    const p = this.purchases.get(pda);
    if (p) Object.assign(p, patch);
  }

  async recordQuote(quote: MarketQuote) {
    const id = String(this.quotes.length + 1);
    this.quotes.push({ ...quote, id });
    return id;
  }

  async reserveHedge(h: NewHedge): Promise<HedgeRow> {
    const existing = [...this.hedges.values()].find((x) => x.purchaseId === h.purchaseId);
    if (existing) return { ...existing };
    const promo = this.mustPromotion(h.promotionId);
    const live = h.status === "SIMULATED_FILLED" || h.status === "SIMULATED_PARTIAL";
    const reserve = live ? (h.premium ?? 0n) : 0n;
    if (promo.reservedPremium + reserve > promo.hedgeBudget) throw new BudgetExceededError();
    promo.reservedPremium += reserve;
    const row: HedgeRow = {
      ...h,
      id: randomUUID(),
      simulated: true,
      reservedPremium: reserve,
      virtualPayout: null,
      settledAt: null,
    };
    this.hedges.set(row.id, row);
    return { ...row };
  }

  async getHedgeByPurchase(purchaseId: string) {
    const h = [...this.hedges.values()].find((x) => x.purchaseId === purchaseId);
    return h ? { ...h } : null;
  }

  async listHedgesByPromotion(promotionId: string) {
    return [...this.hedges.values()]
      .filter((h) => h.promotionId === promotionId)
      .map((h) => ({ ...h }));
  }

  async voidHedge(hedgeId: string, reason: HedgeRow["failureReason"] & string) {
    const h = this.hedges.get(hedgeId);
    if (!h) throw new Error(`hedge ${hedgeId} not found`);
    if (!["VOIDED", "FAILED", "SETTLED_WIN", "SETTLED_LOSS"].includes(h.status)) {
      this.mustPromotion(h.promotionId).reservedPremium -= h.reservedPremium;
      h.reservedPremium = 0n;
      h.status = "VOIDED";
      h.failureReason = reason;
    }
    return { ...h };
  }

  async settleHedge(
    hedgeId: string,
    s: { status: "SETTLED_WIN" | "SETTLED_LOSS"; virtualPayout: bigint; settledAt: string },
  ) {
    const h = this.hedges.get(hedgeId);
    if (!h) throw new Error(`hedge ${hedgeId} not found`);
    if (h.status === "SETTLED_WIN" || h.status === "SETTLED_LOSS") return;
    Object.assign(h, s);
  }

  async saveOutcome(outcome: MarketOutcome) {
    this.outcomes.set(outcome.marketId, outcome);
  }

  async markEventProcessed(eventId: string) {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }

  async getCheckpoint(name: string) {
    return this.checkpoints.get(name) ?? null;
  }

  async setCheckpoint(name: string, slot: number) {
    this.checkpoints.set(name, Math.max(slot, this.checkpoints.get(name) ?? 0));
  }

  private mustPromotion(id: string): PromotionRow {
    const p = this.promotions.get(id);
    if (!p) throw new Error(`promotion ${id} not found`);
    return p;
  }
}
