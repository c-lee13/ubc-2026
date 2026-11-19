import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { DepositEvent } from "@hedged/shared";
import { MemoryStore } from "./memory-store";
import { createSupabaseStore } from "./supabase-store";
import { BudgetExceededError, PromotionConflictError, type Store } from "./types";

/*
 * One behavioural contract, run against every Store implementation.
 * - MemoryStore: always.
 * - SupabaseStore: only when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (e.g. via
 *   `node --env-file=../../.env`). Rows are created under a random run id and deleted afterwards.
 */

const RUN = randomBytes(4).toString("hex");
const MAX_U64 = "18446744073709551615";

function contract(name: string, store: Store) {
  const tag = (s: string) => `${s}_${RUN}`;
  const merchant = tag(`MERCHANT_${name}`);
  const marketId = tag(`GEMI-TEST-${name}`);

  const newPromo = (over: Record<string, unknown> = {}) =>
    store.createPromotion({
      promoPda: null,
      promoNonce: MAX_U64,
      mint: null,
      merchant,
      itemName: "Latte",
      shopName: "Bean There",
      location: "Austin",
      offerAmount: 5_000_000n,
      depositDeadline: 1_795_379_400,
      geminiMarketId: marketId,
      outcomeLabel: "Texas wins",
      maxYesPriceMicroUsd: 500_000n,
      hedgeBudget: 2_000_000n,
      ...over,
    });

  let seq = 0;
  const deposit = (promo: string, pda: string): DepositEvent => ({
    signature: tag(`SIG_${name}_${++seq}`),
    eventIndex: 0,
    slot: seq,
    blockTime: null,
    commitment: "finalized",
    promo,
    purchase: pda,
    customer: tag("CUSTOMER"),
    purchaseId: randomBytes(16).toString("hex"),
    amount: "5000000",
    depositedAt: 1_795_370_000,
  });

  test(`[${name}] merchants upsert and read back`, async () => {
    await store.upsertMerchant({ pubkey: merchant, shopName: "Old", location: "" });
    const m = await store.upsertMerchant({
      pubkey: merchant,
      shopName: "Bean There",
      location: "Austin",
    });
    assert.equal(m.shopName, "Bean There");
    assert.equal((await store.getMerchant(merchant))?.location, "Austin");
    assert.equal(await store.getMerchant(tag("NOBODY")), null);
  });

  test(`[${name}] promotion draft -> activate (idempotent, conflicts) and queries`, async () => {
    const draft = await newPromo();
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.promoNonce, MAX_U64, "u64 nonce must round-trip exactly");
    assert.equal(draft.offerAmount, 5_000_000n);
    assert.equal(await store.getPromotionByPda(tag("PDA_A")), null);

    const pda = tag(`PDA_${name}_A`);
    const active = await store.activatePromotion(draft.id, { promoPda: pda, mint: "MINT" });
    assert.equal(active.status, "ACTIVE");
    assert.equal(
      (await store.activatePromotion(draft.id, { promoPda: pda, mint: "MINT" })).id,
      draft.id,
    );
    await assert.rejects(
      store.activatePromotion(draft.id, { promoPda: tag("OTHER"), mint: "MINT" }),
      PromotionConflictError,
    );
    const other = await newPromo({ promoNonce: "7" });
    await assert.rejects(
      store.activatePromotion(other.id, { promoPda: pda, mint: "MINT" }),
      PromotionConflictError,
    );

    assert.equal((await store.getPromotionByPda(pda))?.id, draft.id);
    assert.equal(await store.getPromotion("not-a-uuid"), null);
    const mine = await store.listPromotions({ merchant });
    assert.ok(mine.some((p) => p.id === other.id && p.status === "DRAFT"));
    assert.ok(
      (await store.listPromotions({ status: "ACTIVE", merchant })).every(
        (p) => p.status === "ACTIVE",
      ),
    );
    const due = await store.listPromotionsDueForResolution(1_795_379_400);
    assert.ok(due.some((p) => p.id === draft.id));
    assert.ok(!due.some((p) => p.id === other.id), "drafts are never due");
    assert.ok(
      !(await store.listPromotionsDueForResolution(1_795_379_399)).some((p) => p.id === draft.id),
    );

    await store.setPromotionResolved(draft.id, "YES", null);
    const resolved = await store.getPromotion(draft.id);
    assert.equal(resolved?.onChainState, "ResolvedYes");
    assert.equal(resolved?.resolvedOutcome, "YES");
  });

  test(`[${name}] deposits are idempotent; CAS transitions and patches`, async () => {
    const promo = await newPromo({
      promoNonce: "11",
      promoPda: tag(`PDA_${name}_B`),
      mint: "MINT",
    });
    const pda = tag(`PURCHASE_${name}_1`);
    const ev = deposit(promo.promoPda!, pda);
    const first = await store.recordDeposit(ev, promo.id);
    assert.equal(first.created, true);
    assert.equal(first.purchase.status, "DEPOSITED");
    assert.equal((await store.recordDeposit(ev, promo.id)).created, false);
    assert.equal(
      (await store.recordDeposit({ ...ev, signature: tag("SIG_OTHER") }, promo.id)).created,
      false,
    );
    assert.equal((await store.listPurchases(promo.id)).length, 1);
    const mine = await store.listPurchasesByCustomer(ev.customer, 10);
    assert.ok(mine.some((p) => p.purchasePda === pda));
    assert.equal((await store.listPurchasesByCustomer(tag("NOBODY"), 10)).length, 0);

    const leased = await store.transitionPurchase(pda, ["DEPOSITED"], "PENDING_HEDGE");
    assert.equal(leased?.status, "PENDING_HEDGE");
    assert.equal(leased?.attempts, 1);
    assert.equal(await store.transitionPurchase(pda, ["DEPOSITED"], "PENDING_HEDGE"), null);

    const failed = await store.transitionPurchase(pda, ["PENDING_HEDGE"], "HEDGE_FAILED", {
      lastError: "QUOTE_OVER_CAP",
    });
    assert.equal(failed?.lastError, "QUOTE_OVER_CAP");
    const cancelled = await store.transitionPurchase(pda, ["HEDGE_FAILED"], "CANCELLED", {
      onChainState: "Cancelled",
      cancelTxSignature: "SIG_CANCEL",
    });
    assert.equal(cancelled?.lastError, null, "lastError clears when not in the patch");
    assert.equal(cancelled?.onChainState, "Cancelled");
    assert.equal(cancelled?.cancelTxSignature, "SIG_CANCEL");
    const refunded = await store.transitionPurchase(pda, ["CANCELLED"], "REFUNDED", {
      claimTxSignature: "SIG_CLAIM",
    });
    assert.equal(refunded?.cancelTxSignature, "SIG_CANCEL", "absent signature fields are kept");

    await store.patchPurchase(pda, { needsReconciliation: true, lastError: "check me" });
    const patched = await store.getPurchaseByPda(pda);
    assert.equal(patched?.needsReconciliation, true);
    assert.equal(patched?.status, "REFUNDED");
  });

  test(`[${name}] hedges: one per purchase, budget reserved once, void releases, settle once`, async () => {
    const promo = await newPromo({
      promoNonce: "12",
      promoPda: tag(`PDA_${name}_C`),
      mint: "MINT",
    });
    const { purchase: p1 } = await store.recordDeposit(
      deposit(promo.promoPda!, tag(`PUR_${name}_H1`)),
      promo.id,
    );
    const { purchase: p2 } = await store.recordDeposit(
      deposit(promo.promoPda!, tag(`PUR_${name}_H2`)),
      promo.id,
    );
    const quoteId = await store.recordQuote({
      source: "gemini-predictions",
      marketId,
      fetchedAt: new Date().toISOString(),
      yesAskMicroUsd: "340000",
      asks: [{ priceMicroUsd: "340000", quantity: "100" }],
    });
    const hedge = (purchaseId: string, premium: bigint) => ({
      purchaseId,
      promotionId: promo.id,
      marketId,
      quoteId,
      status: "SIMULATED_FILLED" as const,
      failureReason: null,
      requestedContracts: "4.51",
      filledContracts: "4.51",
      avgFillPriceMicroUsd: "340000",
      premium,
      modeledFee: 0n,
      assumptions: ["Simulated only"],
      quoteFetchedAt: new Date().toISOString(),
    });

    const h1 = await store.reserveHedge(hedge(p1.id, 1_700_000n));
    assert.equal(h1.simulated, true);
    assert.equal(h1.filledContracts, "4.51");
    assert.equal(h1.premium, 1_700_000n);
    assert.equal(h1.reservedPremium, 1_700_000n);
    assert.equal((await store.reserveHedge(hedge(p1.id, 1_700_000n))).id, h1.id);
    assert.equal((await store.getPromotion(promo.id))?.reservedPremium, 1_700_000n);
    await assert.rejects(store.reserveHedge(hedge(p2.id, 1_700_000n)), BudgetExceededError);

    const failed = await store.reserveHedge({
      ...hedge(p2.id, 1_700_000n),
      status: "FAILED",
      failureReason: "BUDGET_EXCEEDED",
    });
    assert.equal(failed.reservedPremium, 0n);
    assert.equal((await store.listHedgesByPromotion(promo.id)).length, 2);

    const voided = await store.voidHedge(h1.id, "MARK_HEDGED_FAILED");
    assert.equal(voided.status, "VOIDED");
    await store.voidHedge(h1.id, "MARK_HEDGED_FAILED");
    assert.equal((await store.getPromotion(promo.id))?.reservedPremium, 0n);

    // settle a fresh live hedge, twice
    const promo2 = await newPromo({
      promoNonce: "13",
      promoPda: tag(`PDA_${name}_D`),
      mint: "MINT",
    });
    const { purchase: p3 } = await store.recordDeposit(
      deposit(promo2.promoPda!, tag(`PUR_${name}_H3`)),
      promo2.id,
    );
    const h3 = await store.reserveHedge({ ...hedge(p3.id, 1_000_000n), promotionId: promo2.id });
    const settledAt = new Date().toISOString();
    await store.settleHedge(h3.id, { status: "SETTLED_WIN", virtualPayout: 4_510_000n, settledAt });
    await store.settleHedge(h3.id, { status: "SETTLED_LOSS", virtualPayout: 0n, settledAt });
    const s = await store.getHedgeByPurchase(p3.id);
    assert.equal(s?.status, "SETTLED_WIN");
    assert.equal(s?.virtualPayout, 4_510_000n);
  });

  test(`[${name}] desk fills round-trip and filter by event`, async () => {
    const ev = tag(`EVT_${name}`);
    const fill = await store.recordDeskFill({
      eventTicker: ev,
      marketId: tag(`GEMI-${name}-TEX`),
      side: "BUY",
      contracts: "200.5",
      amount: 184_460_000n,
      avgPriceMicroUsd: "920000",
      quoteFetchedAt: new Date().toISOString(),
    });
    assert.equal(fill.simulated, true);
    assert.equal(fill.contracts, "200.5");
    assert.equal(fill.amount, 184_460_000n);
    await store.recordDeskFill({ ...fill, side: "SELL", contracts: "10" });
    const mine = await store.listDeskFills(ev);
    assert.deepEqual(
      mine.map((f) => [f.side, f.contracts]),
      [
        ["BUY", "200.5"],
        ["SELL", "10"],
      ],
    );
    assert.ok((await store.listDeskFills()).length >= 2);
  });

  test(`[${name}] events dedupe, checkpoints never go backwards, outcomes upsert`, async () => {
    const id = `${tag("EVSIG")}:0`;
    assert.equal(await store.markEventProcessed(id, "ClaimEvent", 5, { a: 1 }), true);
    assert.equal(await store.markEventProcessed(id, "ClaimEvent", 5, { a: 1 }), false);
    const cp = tag(`cp_${name}`);
    assert.equal(await store.getCheckpoint(cp), null);
    await store.setCheckpoint(cp, 100);
    await store.setCheckpoint(cp, 50);
    assert.equal(await store.getCheckpoint(cp), 100);
    const outcome = {
      marketId,
      outcome: "NO" as const,
      source: "gemini-official-settlement" as const,
      resolvedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
    };
    await store.saveOutcome(outcome);
    await store.saveOutcome({ ...outcome, outcome: "YES" });
  });
}

contract("memory", new MemoryStore());

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  contract("supabase", createSupabaseStore(url, key));

  after(async () => {
    // Delete everything this run created (children first).
    const db = createClient(url, key, { auth: { persistSession: false } });
    const like = `%_${RUN}%`;
    const promos = await db.from("promotions").select("id").like("merchant", like);
    const ids = (promos.data ?? []).map((r: { id: string }) => r.id);
    if (ids.length) {
      await db.from("simulated_hedges").delete().in("promotion_id", ids);
      await db.from("purchases").delete().in("promotion_id", ids);
      await db.from("promotions").delete().in("id", ids);
    }
    await db.from("market_quotes").delete().like("market_id", like);
    await db.from("market_outcomes").delete().like("market_id", like);
    await db.from("chain_events").delete().like("event_id", like);
    await db.from("checkpoints").delete().like("name", like);
    await db.from("merchants").delete().like("pubkey", like);
    await db.from("desk_fills").delete().like("event_ticker", like);
  });
} else {
  test(
    "[supabase] skipped: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run",
    { skip: true },
    () => {},
  );
}
