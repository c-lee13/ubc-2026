import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import {
  chainEventId,
  type DepositEvent,
  type MarketOutcome,
  type MarketQuote,
} from "@hedged/shared";
import { hundredthsToQty, qtyToHundredths } from "../gemini/decimal";
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
 * Store backed by Supabase Postgres (supabase/migrations/20261117000000_init.sql), using the
 * SERVICE-ROLE key. Server-only: never import this from apps/web.
 *
 * Invariants live in the database, not here: CAS transitions (`transition_purchase`), one hedge
 * per purchase + atomic budget reservation (`reserve_simulated_hedge`), reservation release
 * (`void_simulated_hedge`), unique deposit events, RLS with no anon access.
 *
 * Money and nonces are bigint/numeric in Postgres. PostgREST would return them as JSON numbers,
 * which lose precision above 2^53, so every such column is read with a ::text cast.
 */

const PROMO_COLS = [
  "id",
  "status",
  "promo_pda",
  "promo_nonce::text",
  "mint",
  "merchant",
  "item_name",
  "shop_name",
  "location",
  "offer_amount::text",
  "deposit_deadline::text",
  "on_chain_state",
  "gemini_market_id",
  "outcome_label",
  "max_yes_price_micro_usd::text",
  "hedge_budget::text",
  "coupon_total",
  "reserved_premium::text",
  "resolved_outcome",
  "resolve_tx_signature",
  "created_at",
].join(",");

const PURCHASE_COLS = [
  "id",
  "promotion_id",
  "purchase_pda",
  "purchase_id_hex",
  "customer",
  "amount::text",
  "deposit_tx_signature",
  "deposit_event_index",
  "deposited_at::text",
  "on_chain_state",
  "status",
  "attempts",
  "last_error",
  "needs_reconciliation",
  "mark_hedged_tx_signature",
  "cancel_tx_signature",
  "claim_tx_signature",
].join(",");

const HEDGE_COLS = [
  "id",
  "purchase_id",
  "promotion_id",
  "market_id",
  "quote_id::text",
  "status",
  "failure_reason",
  "requested_contracts::text",
  "filled_contracts::text",
  "avg_fill_price_micro_usd::text",
  "premium::text",
  "modeled_fee::text",
  "reserved_premium::text",
  "virtual_payout::text",
  "assumptions",
  "quote_fetched_at",
  "settled_at",
].join(",");

const MERCHANT_COLS = "pubkey,shop_name,location,created_at";
const DESK_COLS =
  "id,event_ticker,market_id,side,contracts::text,amount::text,avg_price_micro_usd::text,quote_fetched_at,created_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = "23505";

type Row = Record<string, unknown>;

export class SupabaseStoreError extends Error {
  constructor(
    op: string,
    readonly cause: PostgrestError,
  ) {
    super(`supabase ${op}: ${cause.message} (${cause.code})`);
    this.name = "SupabaseStoreError";
  }
}

export function createSupabaseStore(url: string, serviceRoleKey: string): SupabaseStore {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return new SupabaseStore(client);
}

export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  // ---- merchants -----------------------------------------------------------------------------

  async upsertMerchant(m: Omit<MerchantRow, "createdAt">): Promise<MerchantRow> {
    const { data, error } = await this.db
      .from("merchants")
      .upsert(
        {
          pubkey: m.pubkey,
          shop_name: m.shopName,
          location: m.location,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "pubkey" },
      )
      .select(MERCHANT_COLS)
      .single();
    return toMerchant(must("upsertMerchant", data, error));
  }

  async getMerchant(pubkey: string): Promise<MerchantRow | null> {
    const { data, error } = await this.db
      .from("merchants")
      .select(MERCHANT_COLS)
      .eq("pubkey", pubkey)
      .maybeSingle();
    const row = maybe("getMerchant", data, error);
    return row ? toMerchant(row) : null;
  }

  // ---- promotions ----------------------------------------------------------------------------

  async createPromotion(p: NewPromotion): Promise<PromotionRow> {
    const { data, error } = await this.db
      .from("promotions")
      .insert({
        status: p.promoPda ? "ACTIVE" : "DRAFT",
        promo_pda: p.promoPda,
        promo_nonce: p.promoNonce,
        mint: p.mint,
        merchant: p.merchant,
        item_name: p.itemName,
        shop_name: p.shopName,
        location: p.location,
        offer_amount: p.offerAmount.toString(),
        deposit_deadline: p.depositDeadline,
        gemini_market_id: p.geminiMarketId,
        outcome_label: p.outcomeLabel,
        max_yes_price_micro_usd: p.maxYesPriceMicroUsd.toString(),
        hedge_budget: p.hedgeBudget.toString(),
        coupon_total: p.couponTotal ?? null,
      })
      .select(PROMO_COLS)
      .single();
    return toPromotion(must("createPromotion", data, error));
  }

  async activatePromotion(
    id: string,
    onChain: { promoPda: string; mint: string },
  ): Promise<PromotionRow> {
    const { data, error } = await this.db
      .from("promotions")
      .update({
        status: "ACTIVE",
        promo_pda: onChain.promoPda,
        mint: onChain.mint,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "DRAFT")
      .select(PROMO_COLS);
    if (error?.code === UNIQUE_VIOLATION) {
      throw new PromotionConflictError(`promo PDA ${onChain.promoPda} already registered`);
    }
    const updated = mustRows("activatePromotion", data, error);
    if (updated.length === 1) return toPromotion(updated[0]!);

    const existing = await this.getPromotion(id);
    if (!existing) throw new Error(`promotion ${id} not found`);
    if (existing.status === "ACTIVE" && existing.promoPda === onChain.promoPda) return existing;
    throw new PromotionConflictError(`promotion ${id} already active as ${existing.promoPda}`);
  }

  async listPromotions(
    filter: { status?: PromotionStatus; merchant?: string } = {},
  ): Promise<PromotionRow[]> {
    let q = this.db.from("promotions").select(PROMO_COLS).order("created_at", { ascending: true });
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.merchant) q = q.eq("merchant", filter.merchant);
    const { data, error } = await q;
    return mustRows("listPromotions", data, error).map(toPromotion);
  }

  async getPromotionByPda(promoPda: string): Promise<PromotionRow | null> {
    const { data, error } = await this.db
      .from("promotions")
      .select(PROMO_COLS)
      .eq("status", "ACTIVE")
      .eq("promo_pda", promoPda)
      .maybeSingle();
    const row = maybe("getPromotionByPda", data, error);
    return row ? toPromotion(row) : null;
  }

  async getPromotion(id: string): Promise<PromotionRow | null> {
    if (!UUID_RE.test(id)) return null;
    const { data, error } = await this.db
      .from("promotions")
      .select(PROMO_COLS)
      .eq("id", id)
      .maybeSingle();
    const row = maybe("getPromotion", data, error);
    return row ? toPromotion(row) : null;
  }

  async listActivePromotions(): Promise<PromotionRow[]> {
    const { data, error } = await this.db
      .from("promotions")
      .select(PROMO_COLS)
      .eq("status", "ACTIVE")
      .eq("on_chain_state", "Active");
    return mustRows("listActivePromotions", data, error).map(toPromotion);
  }

  async listPromotionsDueForResolution(nowUnix: number): Promise<PromotionRow[]> {
    const { data, error } = await this.db
      .from("promotions")
      .select(PROMO_COLS)
      .eq("status", "ACTIVE")
      .eq("on_chain_state", "Active")
      .lte("deposit_deadline", nowUnix);
    return mustRows("listPromotionsDueForResolution", data, error).map(toPromotion);
  }

  async setPromotionResolved(id: string, outcome: "YES" | "NO", txSignature: string | null) {
    const update: Row = {
      on_chain_state: outcome === "YES" ? "ResolvedYes" : "ResolvedNo",
      resolved_outcome: outcome,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (txSignature) update.resolve_tx_signature = txSignature;
    const { error } = await this.db.from("promotions").update(update).eq("id", id);
    check("setPromotionResolved", error);
  }

  // ---- purchases -----------------------------------------------------------------------------

  async recordDeposit(e: DepositEvent, promotionId: string) {
    const { data, error } = await this.db
      .from("purchases")
      .insert({
        promotion_id: promotionId,
        purchase_pda: e.purchase,
        purchase_id_hex: e.purchaseId,
        customer: e.customer,
        amount: e.amount,
        deposit_tx_signature: e.signature,
        deposit_event_index: e.eventIndex,
        deposited_at: e.depositedAt,
      })
      .select(PURCHASE_COLS)
      .single();
    await this.markEventProcessed(chainEventId(e), "DepositEvent", e.slot, e);
    if (error?.code === UNIQUE_VIOLATION) {
      const byPda = await this.getPurchaseByPda(e.purchase);
      if (byPda) return { purchase: byPda, created: false };
      const { data: bySig, error: sigErr } = await this.db
        .from("purchases")
        .select(PURCHASE_COLS)
        .eq("deposit_tx_signature", e.signature)
        .eq("deposit_event_index", e.eventIndex)
        .single();
      return { purchase: toPurchase(must("recordDeposit/dup", bySig, sigErr)), created: false };
    }
    return { purchase: toPurchase(must("recordDeposit", data, error)), created: true };
  }

  async getPurchaseByPda(pda: string): Promise<PurchaseRow | null> {
    const { data, error } = await this.db
      .from("purchases")
      .select(PURCHASE_COLS)
      .eq("purchase_pda", pda)
      .maybeSingle();
    const row = maybe("getPurchaseByPda", data, error);
    return row ? toPurchase(row) : null;
  }

  async listPurchases(promotionId: string): Promise<PurchaseRow[]> {
    const { data, error } = await this.db
      .from("purchases")
      .select(PURCHASE_COLS)
      .eq("promotion_id", promotionId)
      .order("created_at", { ascending: true });
    return mustRows("listPurchases", data, error).map(toPurchase);
  }

  async listPurchasesByCustomer(customer: string, limit: number): Promise<PurchaseRow[]> {
    const { data, error } = await this.db
      .from("purchases")
      .select(PURCHASE_COLS)
      .eq("customer", customer)
      .order("created_at", { ascending: false })
      .limit(limit);
    return mustRows("listPurchasesByCustomer", data, error).map(toPurchase);
  }

  async transitionPurchase(
    pda: string,
    from: readonly PurchaseRow["status"][],
    to: PurchaseRow["status"],
    patch: Parameters<Store["transitionPurchase"]>[3] = {},
  ): Promise<PurchaseRow | null> {
    const { data, error } = await this.db
      .rpc("transition_purchase", {
        p_purchase_pda: pda,
        p_from: [...from],
        p_to: to,
        p_patch: purchasePatch(patch),
      })
      .select(PURCHASE_COLS);
    const rows = mustRows("transitionPurchase", data, error);
    return rows[0] ? toPurchase(rows[0]) : null;
  }

  async patchPurchase(pda: string, patch: Parameters<Store["patchPurchase"]>[1]): Promise<void> {
    const update = { ...purchasePatch(patch), updated_at: new Date().toISOString() };
    const { error } = await this.db.from("purchases").update(update).eq("purchase_pda", pda);
    check("patchPurchase", error);
  }

  // ---- quotes / hedges -----------------------------------------------------------------------

  async recordQuote(quote: MarketQuote): Promise<string> {
    const { data, error } = await this.db
      .from("market_quotes")
      .insert({
        market_id: quote.marketId,
        fetched_at: quote.fetchedAt,
        yes_ask_micro_usd: quote.yesAskMicroUsd,
        asks: quote.asks,
      })
      .select("id::text")
      .single();
    return String(must("recordQuote", data, error).id);
  }

  async reserveHedge(h: NewHedge): Promise<HedgeRow> {
    const { data, error } = await this.db
      .rpc("reserve_simulated_hedge", {
        p_hedge: {
          purchase_id: h.purchaseId,
          promotion_id: h.promotionId,
          market_id: h.marketId,
          quote_id: h.quoteId,
          status: h.status,
          failure_reason: h.failureReason,
          requested_contracts: h.requestedContracts,
          filled_contracts: h.filledContracts,
          avg_fill_price_micro_usd: h.avgFillPriceMicroUsd,
          premium: h.premium?.toString() ?? null,
          modeled_fee: h.modeledFee.toString(),
          assumptions: h.assumptions,
          quote_fetched_at: h.quoteFetchedAt,
        },
      })
      .select(HEDGE_COLS);
    if (error?.message?.includes("BUDGET_EXCEEDED")) throw new BudgetExceededError();
    const rows = mustRows("reserveHedge", data, error);
    if (!rows[0]) throw new Error(`reserveHedge returned no row for purchase ${h.purchaseId}`);
    return toHedge(rows[0]);
  }

  async getHedgeByPurchase(purchaseId: string): Promise<HedgeRow | null> {
    const { data, error } = await this.db
      .from("simulated_hedges")
      .select(HEDGE_COLS)
      .eq("purchase_id", purchaseId)
      .maybeSingle();
    const row = maybe("getHedgeByPurchase", data, error);
    return row ? toHedge(row) : null;
  }

  async listHedgesByPromotion(promotionId: string): Promise<HedgeRow[]> {
    const { data, error } = await this.db
      .from("simulated_hedges")
      .select(HEDGE_COLS)
      .eq("promotion_id", promotionId);
    return mustRows("listHedgesByPromotion", data, error).map(toHedge);
  }

  async voidHedge(hedgeId: string, reason: NonNullable<HedgeRow["failureReason"]>) {
    const { data, error } = await this.db
      .rpc("void_simulated_hedge", { p_hedge_id: hedgeId, p_failure_reason: reason })
      .select(HEDGE_COLS);
    const rows = mustRows("voidHedge", data, error);
    if (!rows[0]) throw new Error(`hedge ${hedgeId} not found`);
    return toHedge(rows[0]);
  }

  async settleHedge(
    hedgeId: string,
    s: { status: "SETTLED_WIN" | "SETTLED_LOSS"; virtualPayout: bigint; settledAt: string },
  ): Promise<void> {
    const { error } = await this.db
      .from("simulated_hedges")
      .update({
        status: s.status,
        virtual_payout: s.virtualPayout.toString(),
        settled_at: s.settledAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", hedgeId)
      .not("status", "in", "(SETTLED_WIN,SETTLED_LOSS)");
    check("settleHedge", error);
  }

  // ---- outcomes / events / checkpoints -------------------------------------------------------

  async saveOutcome(o: MarketOutcome): Promise<void> {
    const { error } = await this.db.from("market_outcomes").upsert(
      {
        market_id: o.marketId,
        outcome: o.outcome,
        source: o.source,
        resolved_at: o.resolvedAt,
        fetched_at: o.fetchedAt,
      },
      { onConflict: "market_id" },
    );
    check("saveOutcome", error);
  }

  async recordDeskFill(f: NewDeskFill): Promise<DeskFillRow> {
    const { data, error } = await this.db
      .from("desk_fills")
      .insert({
        event_ticker: f.eventTicker,
        market_id: f.marketId,
        side: f.side,
        contracts: f.contracts,
        amount: f.amount.toString(),
        avg_price_micro_usd: f.avgPriceMicroUsd,
        quote_fetched_at: f.quoteFetchedAt,
      })
      .select(DESK_COLS)
      .single();
    return toDeskFill(must("recordDeskFill", data, error));
  }

  async listDeskFills(eventTicker?: string): Promise<DeskFillRow[]> {
    let q = this.db.from("desk_fills").select(DESK_COLS).order("created_at", { ascending: true });
    if (eventTicker) q = q.eq("event_ticker", eventTicker);
    const { data, error } = await q;
    return mustRows("listDeskFills", data, error).map(toDeskFill);
  }

  async markEventProcessed(
    eventId: string,
    name: string,
    slot: number,
    payload: unknown,
  ): Promise<boolean> {
    const [signature, index] = eventId.split(":");
    const { error } = await this.db.from("chain_events").insert({
      event_id: eventId,
      signature,
      event_index: Number(index),
      name,
      slot,
      payload,
    });
    if (error?.code === UNIQUE_VIOLATION) return false;
    check("markEventProcessed", error);
    return true;
  }

  async getCheckpoint(name: string): Promise<number | null> {
    const { data, error } = await this.db
      .from("checkpoints")
      .select("slot::text")
      .eq("name", name)
      .maybeSingle();
    const row = maybe("getCheckpoint", data, error);
    return row ? Number(row.slot) : null;
  }

  /** Never moves a checkpoint backwards (single worker per subscription). */
  async setCheckpoint(name: string, slot: number): Promise<void> {
    const current = await this.getCheckpoint(name);
    if (current !== null && current >= slot) return;
    const { error } = await this.db
      .from("checkpoints")
      .upsert({ name, slot, updated_at: new Date().toISOString() }, { onConflict: "name" });
    check("setCheckpoint", error);
  }
}

// ---- mapping -----------------------------------------------------------------------------------

function check(op: string, error: PostgrestError | null): void {
  if (error) throw new SupabaseStoreError(op, error);
}

// Column lists use ::text casts, which supabase-js cannot type statically, so results are read as
// plain rows here and mapped explicitly below.
function must(op: string, data: unknown, error: PostgrestError | null): Row {
  check(op, error);
  if (data === null || data === undefined || Array.isArray(data)) {
    throw new Error(`supabase ${op}: expected one row`);
  }
  return data as Row;
}

function mustRows(op: string, data: unknown, error: PostgrestError | null): Row[] {
  check(op, error);
  if (!Array.isArray(data)) throw new Error(`supabase ${op}: expected rows`);
  return data as Row[];
}

function maybe(op: string, data: unknown, error: PostgrestError | null): Row | null {
  check(op, error);
  return (data as Row | null) ?? null;
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const big = (v: unknown) => BigInt(String(v));
const bigOrNull = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));
/** numeric(20,2) comes back as "5.00"; normalise to the "5" / "4.5" format used everywhere. */
const qty = (v: unknown) => hundredthsToQty(qtyToHundredths(String(v)));

function toMerchant(r: Row): MerchantRow {
  return {
    pubkey: String(r.pubkey),
    shopName: String(r.shop_name),
    location: String(r.location),
    createdAt: String(r.created_at),
  };
}

function toPromotion(r: Row): PromotionRow {
  return {
    id: String(r.id),
    status: r.status as PromotionRow["status"],
    promoPda: str(r.promo_pda),
    promoNonce: String(r.promo_nonce),
    mint: str(r.mint),
    merchant: String(r.merchant),
    itemName: String(r.item_name),
    shopName: String(r.shop_name),
    location: String(r.location),
    offerAmount: big(r.offer_amount),
    depositDeadline: Number(r.deposit_deadline),
    onChainState: r.on_chain_state as PromotionRow["onChainState"],
    geminiMarketId: String(r.gemini_market_id),
    outcomeLabel: String(r.outcome_label),
    maxYesPriceMicroUsd: big(r.max_yes_price_micro_usd),
    hedgeBudget: big(r.hedge_budget),
    couponTotal:
      r.coupon_total === null || r.coupon_total === undefined ? null : Number(r.coupon_total),
    reservedPremium: big(r.reserved_premium),
    resolvedOutcome: (r.resolved_outcome as PromotionRow["resolvedOutcome"]) ?? null,
    resolveTxSignature: str(r.resolve_tx_signature),
    createdAt: String(r.created_at),
  };
}

function toPurchase(r: Row): PurchaseRow {
  return {
    id: String(r.id),
    promotionId: String(r.promotion_id),
    purchasePda: String(r.purchase_pda),
    purchaseIdHex: String(r.purchase_id_hex),
    customer: String(r.customer),
    amount: big(r.amount),
    depositTxSignature: String(r.deposit_tx_signature),
    depositEventIndex: Number(r.deposit_event_index),
    depositedAt: Number(r.deposited_at),
    onChainState: r.on_chain_state as PurchaseRow["onChainState"],
    status: r.status as PurchaseRow["status"],
    attempts: Number(r.attempts),
    lastError: str(r.last_error),
    needsReconciliation: Boolean(r.needs_reconciliation),
    markHedgedTxSignature: str(r.mark_hedged_tx_signature),
    cancelTxSignature: str(r.cancel_tx_signature),
    claimTxSignature: str(r.claim_tx_signature),
  };
}

function toHedge(r: Row): HedgeRow {
  return {
    id: String(r.id),
    purchaseId: String(r.purchase_id),
    promotionId: String(r.promotion_id),
    simulated: true,
    marketId: String(r.market_id),
    quoteId: str(r.quote_id),
    status: r.status as HedgeRow["status"],
    failureReason: (r.failure_reason as HedgeRow["failureReason"]) ?? null,
    requestedContracts: qty(r.requested_contracts),
    filledContracts: qty(r.filled_contracts),
    avgFillPriceMicroUsd: str(r.avg_fill_price_micro_usd),
    premium: bigOrNull(r.premium),
    modeledFee: big(r.modeled_fee),
    reservedPremium: big(r.reserved_premium),
    virtualPayout: bigOrNull(r.virtual_payout),
    assumptions: Array.isArray(r.assumptions) ? (r.assumptions as string[]) : [],
    quoteFetchedAt: str(r.quote_fetched_at),
    settledAt: str(r.settled_at),
  };
}

function toDeskFill(r: Row): DeskFillRow {
  return {
    id: String(r.id),
    simulated: true,
    eventTicker: String(r.event_ticker),
    marketId: String(r.market_id),
    side: r.side as DeskFillRow["side"],
    contracts: qty(r.contracts),
    amount: big(r.amount),
    avgPriceMicroUsd: String(r.avg_price_micro_usd),
    quoteFetchedAt: String(r.quote_fetched_at),
    createdAt: String(r.created_at),
  };
}

/** Store patch (camelCase) -> column names; keys that are absent stay absent. */
function purchasePatch(patch: Partial<PurchaseRow>): Row {
  const map: [keyof PurchaseRow, string][] = [
    ["lastError", "last_error"],
    ["onChainState", "on_chain_state"],
    ["needsReconciliation", "needs_reconciliation"],
    ["markHedgedTxSignature", "mark_hedged_tx_signature"],
    ["cancelTxSignature", "cancel_tx_signature"],
    ["claimTxSignature", "claim_tx_signature"],
  ];
  const out: Row = {};
  for (const [k, col] of map) if (k in patch) out[col] = patch[k] ?? null;
  return out;
}
