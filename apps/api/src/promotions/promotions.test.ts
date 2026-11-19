import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketSummary, QuoteLevel } from "@hedged/shared";
import { loadConfig } from "../config";
import type { GameLine, GeminiAdapter } from "../gemini/adapter";
import { FakeSolanaGateway } from "../orchestration/fake-gateway";
import { buildServer } from "../server";
import { MemoryStore } from "../store/memory-store";
import type { PromotionRow } from "../store/types";
import { priceLines } from "./line-picker";
import { liveState, soldCoupons } from "./live-state";

const MERCHANT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const PROMO_PDA = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MARKET = "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX";
const NOW = new Date("2026-11-19T18:00:00Z");
const KICKOFF = Math.floor(Date.parse("2026-11-21T20:30:00Z") / 1000);

const promoRow = (p: Partial<PromotionRow> = {}): PromotionRow => ({
  id: "p1",
  status: "ACTIVE",
  promoPda: PROMO_PDA,
  promoNonce: "1",
  mint: "MINT",
  merchant: MERCHANT,
  itemName: "Latte",
  shopName: "Bean There",
  location: "Guadalupe St",
  offerAmount: 5_000_000n,
  depositDeadline: KICKOFF,
  onChainState: "Active",
  geminiMarketId: MARKET,
  outcomeLabel: "Texas wins",
  maxYesPriceMicroUsd: 500_000n,
  hedgeBudget: 100_000_000n,
  couponTotal: null,
  reservedPremium: 0n,
  resolvedOutcome: null,
  resolveTxSignature: null,
  createdAt: NOW.toISOString(),
  ...p,
});
const nowUnix = Math.floor(NOW.getTime() / 1000);

test("live state: LIVE within threshold, PAUSED above it or out of budget", () => {
  const live = liveState(promoRow(), 400_000n, nowUnix);
  assert.equal(live.phase, "LIVE");
  assert.equal(live.canBuy, true);
  assert.equal(live.costPerSale, "2000000");
  assert.equal(live.thresholdBps, 5000);

  const strict = liveState(promoRow({ maxYesPriceMicroUsd: 100_000n }), 400_000n, nowUnix);
  assert.equal(strict.phase, "PAUSED");
  assert.equal(strict.pauseReason, "PRICE_ABOVE_THRESHOLD");
  assert.equal(strict.thresholdBps, 1000); // "10% shop"

  const broke = liveState(promoRow({ hedgeBudget: 1_000_000n }), 400_000n, nowUnix);
  assert.equal(broke.pauseReason, "BUDGET_USED");
  assert.equal(liveState(promoRow(), null, nowUnix).pauseReason, "NO_LIVE_PRICE");
});

test("live state: after kickoff and after the result", () => {
  assert.equal(liveState(promoRow(), 400_000n, KICKOFF).phase, "WAITING_FOR_RESULT");
  assert.equal(
    liveState(promoRow({ onChainState: "ResolvedYes" }), null, KICKOFF).phase,
    "RESULT_YES",
  );
});

const line = (label: string, asks: [string, string][]): GameLine => ({
  marketId: `GEMI-X-${label.replace(/\W/g, "")}`,
  eventTicker: "X",
  eventTitle: "Arkansas vs Texas",
  label,
  asks: asks.map(([priceMicroUsd, quantity]): QuoteLevel => ({ priceMicroUsd, quantity })),
  fetchedAt: NOW.toISOString(),
});

test("line picker suggests the most likely line that fits the budget", () => {
  const { lines, suggested } = priceLines(
    [
      line("Texas", [["920000", "1000"]]),
      line("Texas wins by more than 13.5 points", [["450000", "500"]]),
      line("Texas wins by more than 20.5 points", [["300000", "500"]]),
      line("Texas wins by more than 27.5 points", []),
    ],
    { refundAmount: 5_000_000n, maxCostBps: 4000, maxQuoteAgeMs: 15_000, feeBps: 0 },
    NOW,
  );
  assert.equal(suggested?.label, "Texas wins by more than 20.5 points");
  assert.equal(suggested?.costPerSale, "1500000");
  assert.deepEqual(
    lines.map((l) => [l.label, l.fits, l.reason]),
    [
      ["Texas", false, "QUOTE_OVER_CAP"],
      ["Texas wins by more than 13.5 points", false, "QUOTE_OVER_CAP"],
      ["Texas wins by more than 20.5 points", true, null],
      ["Texas wins by more than 27.5 points", false, "QUOTE_UNAVAILABLE"],
    ],
  );
});

function stubGemini(ask: string): GeminiAdapter {
  const market: MarketSummary = {
    source: "gemini-predictions",
    marketId: MARKET,
    eventTicker: "NCAAF-2611212030-ARK-TEX-M",
    eventTitle: "Arkansas vs Texas",
    outcomeLabel: "Texas",
    category: "Sports",
    marketState: "open",
    bestAskMicroUsd: ask,
    bestBidMicroUsd: null,
    lastTradeMicroUsd: null,
    expiresAt: "2026-11-22T20:30:00.000Z",
    startsAt: "2026-11-21T20:30:00.000Z",
    opensAt: "2026-11-13T00:00:00.000Z",
    marketKind: "STANDARD",
    fetchedAt: new Date().toISOString(),
  };
  const notUsed = async () => {
    throw new Error("not used in this test");
  };
  return {
    listMarkets: notUsed,
    listWindows: notUsed,
    listGameLines: notUsed,
    getEventInfo: notUsed,
    getBook: notUsed,
    getOutcome: async () => null,
    getMarket: async () => market,
    getQuote: async (marketId) => ({
      quote: {
        source: "gemini-predictions",
        marketId,
        fetchedAt: new Date().toISOString(),
        yesAskMicroUsd: ask,
        asks: [{ priceMicroUsd: ask, quantity: "1000" }],
      },
      eventTicker: market.eventTicker,
      eventTitle: market.eventTitle,
      outcomeLabel: "Texas",
      marketState: "open",
    }),
  };
}

test("API: draft -> on-chain confirm -> public directory -> merchant dashboard", async () => {
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
  const app = await buildServer(loadConfig({}), { gemini: stubGemini("400000"), store, gateway });
  app.log.level = "silent";
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // 1. Merchant drafts a promo. A deadline after kickoff is rejected first.
  const body = {
    merchant: MERCHANT,
    shopName: "Bean There",
    location: "Guadalupe St",
    itemName: "Latte",
    geminiMarketId: MARKET,
    offerAmount: "5000000",
    depositDeadline: KICKOFF + 60,
    maxYesPriceMicroUsd: "500000",
    hedgeBudget: "500000000",
  };
  const late = await app.inject({ method: "POST", url: "/api/promotions", payload: body });
  assert.equal(late.statusCode, 422);
  const created = await app.inject({
    method: "POST",
    url: "/api/promotions",
    payload: { ...body, depositDeadline: deadline },
  });
  assert.equal(created.statusCode, 201);
  const { promotion: draft, initializePromo } = created.json();
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.live, null);
  assert.equal((await app.inject({ url: "/api/promotions" })).json().promotions.length, 0);

  // 2. Confirm before it exists on-chain, then with wrong parameters, then correctly.
  const confirm = () =>
    app.inject({
      method: "POST",
      url: `/api/promotions/${draft.id}/confirm`,
      payload: { promoPda: PROMO_PDA },
    });
  assert.equal((await confirm()).statusCode, 409);
  gateway.addPromo({
    promoPda: PROMO_PDA,
    merchant: MERCHANT,
    promoNonce: initializePromo.promoNonce,
    offerAmount: "5000000",
    depositDeadline: deadline,
    marketId: MARKET,
  });
  gateway.promos.get(PROMO_PDA)!.offerAmount = "4000000";
  const mismatch = await confirm();
  assert.equal(mismatch.statusCode, 409);
  assert.deepEqual(mismatch.json().mismatches, ["offerAmount"]);
  gateway.promos.get(PROMO_PDA)!.offerAmount = "5000000";
  const ok = await confirm();
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().promotion.status, "ACTIVE");

  // 3. Customers see it LIVE with the shop's name; checkout pre-check says canBuy.
  const dir = (await app.inject({ url: "/api/promotions" })).json().promotions;
  assert.equal(dir.length, 1);
  assert.equal(dir[0].shop.name, "Bean There");
  assert.equal(dir[0].live.phase, "LIVE");
  assert.equal(dir[0].live.costPerSale, "2000000");
  const one = (await app.inject({ url: `/api/promotions/${draft.id}` })).json().promotion;
  assert.equal(one.live.canBuy, true);

  // 4. Merchant dashboard.
  const dash = (await app.inject({ url: `/api/merchants/${MERCHANT}/dashboard` })).json();
  assert.equal(dash.merchant.shopName, "Bean There");
  assert.equal(dash.simulatedHedges, true);
  assert.equal(dash.promotions[0].stats.purchases, 0);
  await app.close();
});

test("API: confirm needs a Solana gateway", async () => {
  const store = new MemoryStore();
  const app = await buildServer(loadConfig({}), {
    gemini: stubGemini("400000"),
    store,
    gateway: null,
  });
  app.log.level = "silent";
  const draft = await store.createPromotion({ ...promoRow(), promoPda: null, mint: null });
  const res = await app.inject({
    method: "POST",
    url: `/api/promotions/${draft.id}/confirm`,
    payload: { promoPda: PROMO_PDA },
  });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test("fix: a draft naming someone else's wallet cannot change their public shop name", async () => {
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
  const app = await buildServer(loadConfig({}), { gemini: stubGemini("400000"), store, gateway });
  app.log.level = "silent";
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const body = {
    merchant: MERCHANT,
    shopName: "Bean There",
    itemName: "Latte",
    geminiMarketId: MARKET,
    offerAmount: "5000000",
    depositDeadline: deadline,
    maxYesPriceMicroUsd: "500000",
    hedgeBudget: "500000000",
  };
  const real = (await app.inject({ method: "POST", url: "/api/promotions", payload: body })).json();
  gateway.addPromo({
    promoPda: PROMO_PDA,
    merchant: MERCHANT,
    promoNonce: real.initializePromo.promoNonce,
    offerAmount: "5000000",
    depositDeadline: deadline,
    marketId: MARKET,
  });
  await app.inject({
    method: "POST",
    url: `/api/promotions/${real.promotion.id}/confirm`,
    payload: { promoPda: PROMO_PDA },
  });
  // Attacker drafts with the same wallet and a different name; never activatable.
  await app.inject({
    method: "POST",
    url: "/api/promotions",
    payload: { ...body, shopName: "Scam Cafe" },
  });
  const dir = (await app.inject({ url: "/api/promotions" })).json().promotions;
  assert.deepEqual(
    dir.map((p: { shop: { name: string } }) => p.shop.name),
    ["Bean There"],
  );
  assert.equal((await store.getMerchant(MERCHANT))?.shopName, "Bean There");
  await app.close();
});

test("coupons: live state pauses SOLD_OUT once every coupon is sold; refunds give one back", () => {
  const capped = promoRow({ couponTotal: 2 });
  assert.equal(liveState(capped, 400_000n, nowUnix, 1).phase, "LIVE");
  const out = liveState(capped, 400_000n, nowUnix, 2);
  assert.equal(out.phase, "PAUSED");
  assert.equal(out.pauseReason, "SOLD_OUT");
  assert.equal(out.canBuy, false);
  // No limit: the sold count is ignored.
  assert.equal(liveState(promoRow(), 400_000n, nowUnix, 999).phase, "LIVE");
  assert.equal(
    soldCoupons([{ status: "HEDGED" }, { status: "REFUNDED" }, { status: "DEPOSITED" }]),
    2,
  );
});

test("API: coupon total is stored, shown as { total, sold } to everyone, and stops sales", async () => {
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
  const app = await buildServer(loadConfig({}), { gemini: stubGemini("400000"), store, gateway });
  app.log.level = "silent";
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const body = {
    merchant: MERCHANT,
    shopName: "Bean There",
    itemName: "Latte",
    geminiMarketId: MARKET,
    offerAmount: "5000000",
    depositDeadline: deadline,
    maxYesPriceMicroUsd: "500000",
    hedgeBudget: "500000000",
  };
  for (const coupons of [0, 1.5, -3, "abc", 100_001]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/promotions",
      payload: { ...body, coupons },
    });
    assert.equal(res.statusCode, 400, `coupons=${coupons}`);
    assert.equal(res.json().field, "coupons");
  }
  const plain = await app.inject({ method: "POST", url: "/api/promotions", payload: body });
  assert.equal(plain.json().promotion.coupons, null);

  const created = (
    await app.inject({ method: "POST", url: "/api/promotions", payload: { ...body, coupons: 2 } })
  ).json();
  assert.deepEqual(created.promotion.coupons, { total: 2, sold: 0 });
  gateway.addPromo({
    promoPda: PROMO_PDA,
    merchant: MERCHANT,
    promoNonce: created.initializePromo.promoNonce,
    offerAmount: "5000000",
    depositDeadline: deadline,
    marketId: MARKET,
  });
  await app.inject({
    method: "POST",
    url: `/api/promotions/${created.promotion.id}/confirm`,
    payload: { promoPda: PROMO_PDA },
  });

  let n = 0;
  const buy = () =>
    store.recordDeposit(
      {
        signature: `SIG_${++n}`,
        eventIndex: 0,
        slot: n,
        blockTime: null,
        commitment: "finalized",
        promo: PROMO_PDA,
        purchase: `PURCHASE_${n}`,
        customer: "CUSTOMER",
        purchaseId: n.toString(16).padStart(32, "0"),
        amount: "5000000",
        depositedAt: 1_795_370_000,
      },
      created.promotion.id,
    );
  const get = async () =>
    (await app.inject({ url: `/api/promotions/${created.promotion.id}` })).json().promotion;

  await buy();
  let one = await get();
  assert.deepEqual(one.coupons, { total: 2, sold: 1 });
  assert.equal(one.live.canBuy, true);

  const { purchase } = await buy();
  one = await get();
  assert.deepEqual(one.coupons, { total: 2, sold: 2 });
  assert.equal(one.live.pauseReason, "SOLD_OUT");
  assert.equal(one.live.canBuy, false);
  const dir = (await app.inject({ url: "/api/promotions" })).json().promotions;
  assert.deepEqual(dir.find((p: { id: string }) => p.id === one.id).coupons, { total: 2, sold: 2 });
  const dash = (await app.inject({ url: `/api/merchants/${MERCHANT}/dashboard` })).json();
  assert.deepEqual(dash.promotions.find((p: { id: string }) => p.id === one.id).coupons, {
    total: 2,
    sold: 2,
  });

  // A refunded sale gives the coupon back.
  await store.transitionPurchase(purchase.purchasePda, ["DEPOSITED"], "HEDGE_FAILED");
  one = await get();
  assert.deepEqual(one.coupons, { total: 2, sold: 1 });
  assert.equal(one.live.canBuy, true);
  await app.close();
});
