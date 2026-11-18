import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketOutcome, MarketQuote } from "@hedged/shared";
import type { GeminiAdapter, QuoteResult } from "../gemini/adapter";
import { GeminiUnavailableError } from "../gemini/client";
import { MemoryStore } from "../store/memory-store";
import { FakeSolanaGateway } from "./fake-gateway";
import { createOrchestrator, type Settler } from "./orchestrator";

/*
 * Scenario tests for CLAUDE.md §5.1 against an in-memory store and the FAKE gateway (no Solana,
 * no network). Gemini is a scripted stub; live Gemini is covered separately.
 */

const MARKET = "GEMI-TEST-EVT-TEX";
const PROMO = "PROMO_PDA";

function setup(
  opts: { asks?: [string, string][]; budget?: bigint; cap?: bigint; settler?: Settler } = {},
) {
  let clock = Date.parse("2026-11-21T15:00:00.000Z");
  const now = () => new Date(clock);
  const nowUnix = () => Math.floor(clock / 1000);
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(nowUnix);
  gateway.addPromo({ promoPda: PROMO, marketId: MARKET, depositDeadline: nowUnix() + 3600 });

  const gem = {
    asks: opts.asks ?? ([["340000", "1000"]] as [string, string][]),
    quoteFailures: 0,
    quoteCalls: 0,
    outcome: null as MarketOutcome | null,
  };
  const gemini: Pick<GeminiAdapter, "getQuote" | "getOutcome"> = {
    async getQuote(marketId): Promise<QuoteResult> {
      gem.quoteCalls++;
      if (gem.quoteFailures-- > 0) throw new GeminiUnavailableError("fake 503");
      const quote: MarketQuote = {
        source: "gemini-predictions",
        marketId,
        fetchedAt: now().toISOString(),
        yesAskMicroUsd: gem.asks[0]![0],
        asks: gem.asks.map(([priceMicroUsd, quantity]) => ({ priceMicroUsd, quantity })),
      };
      return {
        quote,
        eventTicker: "TEST-EVT",
        eventTitle: "Test",
        outcomeLabel: "Texas",
        marketState: "open",
      };
    },
    async getOutcome() {
      return gem.outcome;
    },
  };

  const orch = createOrchestrator({
    store,
    gateway,
    settler: opts.settler ?? null,
    gemini,
    config: {
      maxQuoteAgeMs: 15_000,
      feeBps: 0,
      hedgeWindowFraction: 0.7,
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    },
    now,
    sleep: async () => {},
    random: () => 0.5,
  });

  const promoReady = store.createPromotion({
    promoPda: PROMO,
    promoNonce: "1",
    mint: "FAKE_MINT",
    itemName: "Latte",
    shopName: "Bean There",
    location: "Austin",
    merchant: "FAKE_MERCHANT",
    offerAmount: 5_000_000n,
    depositDeadline: nowUnix() + 3600,
    geminiMarketId: MARKET,
    outcomeLabel: "Texas wins",
    maxYesPriceMicroUsd: opts.cap ?? 500_000n,
    hedgeBudget: opts.budget ?? 100_000_000n,
  });

  return {
    store,
    gateway,
    gem,
    orch,
    promoReady,
    advance: (secs: number) => void (clock += secs * 1000),
    purchase: (pda: string) => store.getPurchaseByPda(pda),
    hedgeOf: async (pda: string) =>
      store.getHedgeByPurchase((await store.getPurchaseByPda(pda))!.id),
  };
}

test("happy path: deposit -> simulated hedge -> mark_hedged -> HEDGED", async () => {
  const t = setup();
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));

  const p = await t.purchase("P1");
  assert.equal(p?.status, "HEDGED");
  assert.equal(t.gateway.purchases.get("P1")?.state, "Hedged");
  const h = await t.hedgeOf("P1");
  assert.equal(h?.status, "SIMULATED_FILLED");
  assert.equal(h?.premium, 1_700_000n);
  assert.equal((await t.store.getPromotion(promo.id))?.reservedPremium, 1_700_000n);
});

test("duplicate deposit event creates no second hedge and no second mark_hedged", async () => {
  const t = setup();
  await t.promoReady;
  const ev = t.gateway.deposit(PROMO, "P1");
  await t.orch.handleDeposit(ev);
  await t.orch.handleDeposit(ev);
  await t.orch.handleDeposit({ ...ev, eventIndex: 0 });
  assert.equal(t.store.hedges.size, 1);
  assert.equal(t.gem.quoteCalls, 1);
  assert.equal(t.gateway.calls.filter((c) => c.method === "markHedged").length, 1);
});

test("quote over cap -> HEDGE_FAILED -> cancel_unhedged -> CANCELLED, nothing reserved", async () => {
  const t = setup({ asks: [["930000", "1000"]], cap: 500_000n });
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  const p = await t.purchase("P1");
  assert.equal(p?.status, "CANCELLED");
  assert.match(p?.lastError ?? "", /QUOTE_OVER_CAP/);
  assert.equal(t.gateway.purchases.get("P1")?.state, "Cancelled");
  assert.equal((await t.hedgeOf("P1"))?.failureReason, "QUOTE_OVER_CAP");
  assert.equal((await t.store.getPromotion(promo.id))?.reservedPremium, 0n);
});

test("transient Gemini outage is retried, then hedges", async () => {
  const t = setup();
  await t.promoReady;
  t.gem.quoteFailures = 2;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  assert.equal((await t.purchase("P1"))?.status, "HEDGED");
  assert.equal(t.gem.quoteCalls, 3);
});

test("Gemini down past the retry cap -> cancelled (never a made-up price)", async () => {
  const t = setup();
  await t.promoReady;
  t.gem.quoteFailures = 99;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  const p = await t.purchase("P1");
  assert.equal(p?.status, "CANCELLED");
  assert.match(p?.lastError ?? "", /QUOTE_UNAVAILABLE/);
  assert.equal(t.store.hedges.size, 0);
});

test("partial simulated fill is not treated as covered -> cancelled", async () => {
  const t = setup({
    asks: [
      ["340000", "3"],
      ["600000", "100"],
    ],
    cap: 400_000n,
  });
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  assert.equal((await t.purchase("P1"))?.status, "CANCELLED");
  assert.equal((await t.hedgeOf("P1"))?.failureReason, "PARTIAL_FILL");
  assert.equal((await t.store.getPromotion(promo.id))?.reservedPremium, 0n);
});

test("budget: second purchase that does not fit is cancelled", async () => {
  const t = setup({ budget: 2_000_000n });
  await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P2"));
  assert.equal((await t.purchase("P1"))?.status, "HEDGED");
  assert.equal((await t.purchase("P2"))?.status, "CANCELLED");
  assert.equal((await t.hedgeOf("P2"))?.failureReason, "BUDGET_EXCEEDED");
});

test("no new hedge once 70% of the cancel window has passed", async () => {
  const t = setup();
  await t.promoReady;
  const ev = t.gateway.deposit(PROMO, "P1");
  t.advance(421); // 600s timeout * 0.7 = 420s
  await t.orch.handleDeposit(ev);
  const p = await t.purchase("P1");
  assert.equal(p?.status, "CANCELLED");
  assert.match(p?.lastError ?? "", /HEDGE_WINDOW_CLOSED/);
  assert.equal(t.gem.quoteCalls, 0);
});

test("race: customer cancels before mark_hedged lands -> hedge VOIDED, budget released", async () => {
  const t = setup();
  const promo = await t.promoReady;
  const ev = t.gateway.deposit(PROMO, "P1");
  t.gateway.failNext("markHedged", "RPC_UNAVAILABLE");
  // The customer's cancel_expired_deposit lands while our mark_hedged is being retried.
  const origMark = t.gateway.markHedged.bind(t.gateway);
  let first = true;
  t.gateway.markHedged = async (pda) => {
    if (first) {
      first = false;
      t.gateway.customerCancel(pda);
    }
    return origMark(pda);
  };
  await t.orch.handleDeposit(ev);
  const p = await t.purchase("P1");
  assert.equal(p?.status, "CANCELLED");
  assert.equal((await t.hedgeOf("P1"))?.status, "VOIDED");
  assert.equal((await t.store.getPromotion(promo.id))?.reservedPremium, 0n);
  assert.equal(t.gateway.calls.filter((c) => c.method === "cancelUnhedged").length, 0);
});

test("TX_TIMEOUT that actually landed: re-read sees Hedged, no blind resubmit", async () => {
  const t = setup();
  await t.promoReady;
  t.gateway.failNext("markHedged", "TX_TIMEOUT", 1, true);
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  assert.equal((await t.purchase("P1"))?.status, "HEDGED");
  assert.equal(t.gateway.calls.filter((c) => c.method === "markHedged").length, 1);
});

test("restart mid-flight: reconcile resumes from the stored hedge without re-quoting", async () => {
  const t = setup();
  const promo = await t.promoReady;
  // Exactly what a crash right after persisting the hedge (before mark_hedged) leaves behind.
  const ev = t.gateway.deposit(PROMO, "P1");
  const { purchase } = await t.store.recordDeposit(ev, promo.id);
  await t.store.transitionPurchase("P1", ["DEPOSITED"], "PENDING_HEDGE");
  await t.store.reserveHedge({
    purchaseId: purchase.id,
    promotionId: promo.id,
    marketId: MARKET,
    quoteId: null,
    status: "SIMULATED_FILLED",
    failureReason: null,
    requestedContracts: "5",
    filledContracts: "5",
    avgFillPriceMicroUsd: "340000",
    premium: 1_700_000n,
    modeledFee: 0n,
    assumptions: [],
    quoteFetchedAt: new Date().toISOString(),
  });
  await t.store.transitionPurchase("P1", ["PENDING_HEDGE"], "HEDGE_SIMULATED");

  // Duplicate delivery of the same deposit after restart, then the reconciliation sweep.
  await t.orch.handleDeposit(ev);
  await t.orch.reconcilePromotion(promo.id);

  assert.equal((await t.purchase("P1"))?.status, "HEDGED");
  assert.equal(t.gem.quoteCalls, 0);
  assert.equal(t.store.hedges.size, 1);
  assert.equal((await t.store.getPromotion(promo.id))?.reservedPremium, 1_700_000n);
});

test("RPC down during the pre-hedge check: purchase stays put for a later retry", async () => {
  const t = setup();
  await t.promoReady;
  t.gateway.failNext("getPurchaseState", "RPC_UNAVAILABLE", 3);
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  assert.equal((await t.purchase("P1"))?.needsReconciliation, false);
  assert.equal((await t.purchase("P1"))?.status, "PENDING_HEDGE");
  assert.equal(t.gem.quoteCalls, 0);
  const promo = (await t.store.getPromotionByPda(PROMO))!;
  await t.orch.reconcilePromotion(promo.id);
  assert.equal((await t.purchase("P1"))?.status, "HEDGED");
});

test("resolution waits for the deadline and an OFFICIAL outcome, then settles hedges", async () => {
  const t = setup();
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));

  t.gem.outcome = {
    marketId: MARKET,
    outcome: "YES",
    source: "gemini-official-settlement",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  assert.equal(await t.orch.resolveIfFinal((await t.store.getPromotion(promo.id))!), "PENDING");
  t.advance(3600);
  t.gem.outcome = null;
  await t.orch.resolveDuePromotions();
  assert.equal(t.gateway.promos.get(PROMO)?.state, "Active"); // no official outcome yet

  t.gem.outcome = {
    marketId: MARKET,
    outcome: "YES",
    source: "gemini-official-settlement",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  await t.orch.resolveDuePromotions();
  assert.equal(t.gateway.promos.get(PROMO)?.state, "ResolvedYes");
  assert.equal((await t.purchase("P1"))?.status, "RESOLVED");
  const h = await t.hedgeOf("P1");
  assert.equal(h?.status, "SETTLED_WIN");
  assert.equal(h?.virtualPayout, 5_000_000n);

  // Customer claims the YES refund.
  await t.orch.handleClaim(t.gateway.claim("P1"));
  assert.equal((await t.purchase("P1"))?.status, "CLAIMED");
});

test("NO outcome settles the hedge as a loss and the merchant claims", async () => {
  const t = setup();
  await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  t.advance(3600);
  t.gem.outcome = {
    marketId: MARKET,
    outcome: "NO",
    source: "gemini-official-settlement",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  await t.orch.resolveDuePromotions();
  assert.equal((await t.hedgeOf("P1"))?.status, "SETTLED_LOSS");
  assert.equal((await t.hedgeOf("P1"))?.virtualPayout, 0n);
  await t.orch.handleClaim(t.gateway.claim("P1"));
  assert.equal((await t.purchase("P1"))?.status, "CLAIMED");
});

test("demo-fixture outcomes are never used to resolve on-chain automatically", async () => {
  const t = setup();
  await t.promoReady;
  t.advance(3600);
  t.gem.outcome = {
    marketId: MARKET,
    outcome: "YES",
    source: "manual-demo-fixture",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  await t.orch.resolveDuePromotions();
  assert.equal(t.gateway.promos.get(PROMO)?.state, "Active");
});

test("cancelled purchase: customer refund claim -> REFUNDED", async () => {
  const t = setup({ asks: [["930000", "1000"]] });
  await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  assert.equal((await t.purchase("P1"))?.status, "CANCELLED");
  const claim = t.gateway.claim("P1");
  await t.orch.handleClaim(claim);
  const p = await t.purchase("P1");
  assert.equal(p?.status, "REFUNDED");
  assert.equal(p?.claimTxSignature, claim.signature);
});

test("reconcile: chain Hedged with no ledger hedge is flagged, not silently accepted", async () => {
  const t = setup();
  const promo = await t.promoReady;
  const ev = t.gateway.deposit(PROMO, "P1");
  await t.store.recordDeposit(ev, promo.id);
  t.gateway.purchases.get("P1")!.state = "Hedged"; // someone marked it without our hedge
  const report = await t.orch.reconcilePromotion(promo.id);
  assert.equal(report.flagged.length, 1);
  assert.equal((await t.purchase("P1"))?.needsReconciliation, true);
});

test("fix: deposit into a promo the backend doesn't track is refunded, not ignored", async () => {
  const t = setup();
  await t.promoReady;
  t.gateway.addPromo({ promoPda: "OTHER_PROMO", marketId: MARKET });
  await t.orch.handleDeposit(t.gateway.deposit("OTHER_PROMO", "P9"));
  assert.equal(t.gateway.purchases.get("P9")?.state, "Cancelled");
  assert.equal(t.gem.quoteCalls, 0);
});

test("fix: RPC outage after mark_hedged failures keeps the hedge and retries later", async () => {
  const t = setup();
  const promo = await t.promoReady;
  const ev = t.gateway.deposit(PROMO, "P1");
  // Pre-hedge read OK; then mark_hedged and every re-read fail.
  const realRead = t.gateway.getPurchaseState.bind(t.gateway);
  let reads = 0;
  t.gateway.getPurchaseState = async (pda) => {
    if (++reads > 1)
      throw new (await import("@hedged/shared")).SolanaGatewayError("RPC_UNAVAILABLE", "down");
    return realRead(pda);
  };
  t.gateway.failNext("markHedged", "RPC_UNAVAILABLE", 3);
  await t.orch.handleDeposit(ev);
  const mid = await t.purchase("P1");
  assert.equal(mid?.status, "HEDGE_SIMULATED");
  assert.equal(mid?.needsReconciliation, false);
  assert.equal((await t.hedgeOf("P1"))?.status, "SIMULATED_FILLED");

  t.gateway.getPurchaseState = realRead; // RPC recovers
  await t.orch.reconcilePromotion(promo.id);
  assert.equal((await t.purchase("P1"))?.status, "HEDGED");
});

test("fix: claim recorded before the result still gets its hedge settled", async () => {
  const t = setup();
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  t.advance(3600);
  // Another instance resolves on-chain and the customer claims before we apply the result.
  await t.gateway.resolvePromotion(PROMO, "YES");
  await t.orch.handleClaim(t.gateway.claim("P1"));
  assert.equal((await t.purchase("P1"))?.status, "CLAIMED");
  await t.orch.handleResolution({
    signature: "SIG",
    eventIndex: 0,
    slot: 99,
    blockTime: null,
    commitment: "finalized",
    promo: PROMO,
    outcome: "YES",
    relayer: "FAKE_RELAYER",
    resolvedAt: Math.floor(Date.now() / 1000),
  });
  assert.equal((await t.hedgeOf("P1"))?.status, "SETTLED_WIN");
  assert.equal((await t.store.getPromotion(promo.id))?.resolvedOutcome, "YES");
});

test("fix: a failing purchase during resolution does not block the others; sweep finishes it", async () => {
  const t = setup();
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1")); // hedged
  const ev2 = t.gateway.deposit(PROMO, "P2");
  await t.store.recordDeposit(ev2, promo.id); // recorded, not processed yet
  t.advance(3600);
  t.gem.outcome = {
    marketId: MARKET,
    outcome: "NO",
    source: "gemini-official-settlement",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  // P2's refund path hits a dead RPC during resolution.
  t.gateway.failNext("getPurchaseState", "RPC_UNAVAILABLE", 3);
  await t.orch.resolveDuePromotions();
  assert.equal((await t.purchase("P1"))?.status, "RESOLVED");
  assert.equal((await t.hedgeOf("P1"))?.status, "SETTLED_LOSS");
  assert.notEqual((await t.purchase("P2"))?.status, "CANCELLED");

  // Promo is resolved, but the sweep still picks it up and refunds P2.
  const fresh = (await t.store.getPromotion(promo.id))!;
  assert.equal(await t.orch.needsSweep(fresh), true);
  await t.orch.reconcilePromotion(promo.id);
  assert.equal((await t.purchase("P2"))?.status, "CANCELLED");
  assert.equal(await t.orch.needsSweep((await t.store.getPromotion(promo.id))!), false);
});

/** Records payout pushes; the chain side is the fake gateway's claim (what settlement does). */
function fakeSettler() {
  const calls: string[] = [];
  let failNext = 0;
  const s: Settler & { calls: string[]; failNext(n: number): void } = {
    calls,
    failNext: (n) => void (failNext = n),
    async settlePurchase(pda) {
      calls.push(`purchase:${pda}`);
      if (failNext-- > 0) throw new Error("rpc down");
    },
    async settlePromotion(promoPda) {
      calls.push(`promo:${promoPda}`);
      if (failNext-- > 0) throw new Error("rpc down");
      return { settled: [], skipped: [] };
    },
  };
  return s;
}

test("v2: a relayer cancel is followed by an automatic refund push", async () => {
  const settler = fakeSettler();
  const t = setup({ asks: [["930000", "1000"]], settler });
  await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  assert.equal((await t.purchase("P1"))?.status, "CANCELLED");
  assert.deepEqual(settler.calls, ["purchase:P1"]);
});

test("v2: resolution pushes the promo's payouts; a failed push is retried by the sweep", async () => {
  const settler = fakeSettler();
  const t = setup({ settler });
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  t.advance(3600);
  t.gem.outcome = {
    marketId: MARKET,
    outcome: "NO",
    source: "gemini-official-settlement",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  settler.failNext(99); // every attempt fails: resolution itself must still succeed
  await t.orch.resolveDuePromotions();
  assert.equal(t.gateway.promos.get(PROMO)?.state, "ResolvedNo");
  assert.equal((await t.purchase("P1"))?.status, "RESOLVED");
  assert.ok(settler.calls.includes(`promo:${PROMO}`));

  // Unpaid purchase keeps the promo in the sweep, which pushes again.
  const active = (await t.store.getPromotion(promo.id))!;
  assert.equal(await t.orch.needsSweep(active), true);
  settler.failNext(0);
  settler.calls.length = 0;
  await t.orch.reconcilePromotion(promo.id);
  assert.deepEqual(settler.calls, [`promo:${PROMO}`]);

  // Once the payout's ClaimEvent is recorded, the promo leaves the sweep.
  await t.orch.handleClaim(t.gateway.claim("P1"));
  assert.equal((await t.purchase("P1"))?.status, "CLAIMED");
  assert.equal(await t.orch.needsSweep(active), false);
});

test("v1 (no settler): nothing is pushed; a resolved promo leaves the sweep (claims are manual)", async () => {
  const t = setup();
  const promo = await t.promoReady;
  await t.orch.handleDeposit(t.gateway.deposit(PROMO, "P1"));
  t.advance(3600);
  t.gem.outcome = {
    marketId: MARKET,
    outcome: "NO",
    source: "gemini-official-settlement",
    resolvedAt: "2026-11-21T23:00:00.000Z",
    fetchedAt: "2026-11-21T23:01:00.000Z",
  };
  await t.orch.resolveDuePromotions();
  assert.equal(await t.orch.needsSweep((await t.store.getPromotion(promo.id))!), false);
});
