import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketSummary } from "@hedged/shared";
import { loadConfig } from "./config";
import type { GeminiAdapter } from "./gemini/adapter";
import { FakeSolanaGateway } from "./orchestration/fake-gateway";
import { buyBuffer, liveState } from "./promotions/live-state";
import { buildServer } from "./server";
import { MemoryStore } from "./store/memory-store";
import type { PromotionRow } from "./store/types";

const NOW = Math.floor(Date.now() / 1000);
const row = (p: Partial<PromotionRow> = {}): PromotionRow => ({
  id: "p1",
  status: "ACTIVE",
  promoPda: "0x" + "1a".repeat(32),
  promoNonce: "1",
  mint: "M",
  merchant: "0x" + "bb".repeat(20),
  itemName: "Latte",
  shopName: "Bean There",
  location: "",
  offerAmount: 5_000_000n,
  depositDeadline: NOW + 3600,
  onChainState: "Active",
  geminiMarketId: "GEMI-X-Y",
  outcomeLabel: "x",
  maxYesPriceMicroUsd: 500_000n,
  hedgeBudget: 100_000_000n,
  reservedPremium: 0n,
  resolvedOutcome: null,
  resolveTxSignature: null,
  createdAt: new Date().toISOString(),
  ...p,
});

test("buy buffer: checkout closes 2 cents under the shop's max (smaller buffer for low maxes)", () => {
  assert.equal(liveState(row(), 480_000n, NOW).phase, "LIVE");
  const near = liveState(row(), 490_000n, NOW);
  assert.deepEqual(
    [near.phase, near.pauseReason, near.canBuy],
    ["PAUSED", "PRICE_NEAR_THRESHOLD", false],
  );
  assert.equal(liveState(row(), 510_000n, NOW).pauseReason, "PRICE_ABOVE_THRESHOLD");
  // A 5% shop: buffer is 1 cent, not 2, so it can still sell.
  assert.equal(buyBuffer(50_000n), 10_000n);
  assert.equal(liveState(row({ maxYesPriceMicroUsd: 50_000n }), 40_000n, NOW).phase, "LIVE");
  assert.equal(
    liveState(row({ maxYesPriceMicroUsd: 50_000n }), 41_000n, NOW).pauseReason,
    "PRICE_NEAR_THRESHOLD",
  );
});

function gemini(asks: Record<string, string>): GeminiAdapter {
  const market = {
    marketId: "GEMI-X-Y",
    marketKind: "STANDARD",
    marketState: "open",
    category: "Sports",
    startsAt: null,
    opensAt: null,
    expiresAt: new Date((NOW + 7200) * 1000).toISOString(),
    eventTitle: "T",
    outcomeLabel: "x",
  } as unknown as MarketSummary;
  const book = (id: string) => ({
    asks: [{ priceMicroUsd: asks[id] ?? "500000", quantity: "100000" }],
    bids: [],
    fetchedAt: new Date().toISOString(),
  });
  return {
    getMarket: async () => market,
    getQuote: async (id: string) => ({
      quote: {
        source: "gemini-predictions",
        marketId: id,
        fetchedAt: new Date().toISOString(),
        yesAskMicroUsd: asks[id] ?? "400000",
        asks: [],
      },
    }),
    getBook: async (id: string) => book(id),
    getEventInfo: async (ticker: string) =>
      ticker.endsWith("-M")
        ? {
            eventTicker: ticker,
            title: "Arkansas vs Texas",
            exclusive: true,
            contracts: [
              { marketId: "TEX", label: "Texas" },
              { marketId: "ARK", label: "Arkansas" },
            ],
          }
        : { eventTicker: ticker, title: "Spread", exclusive: false, contracts: [] },
  } as unknown as GeminiAdapter;
}

test("public responses hide the shop's max cost and budget; the shop itself still sees them", async () => {
  const store = new MemoryStore();
  const merchant = "0x" + "bb".repeat(20);
  let owner = false;
  const app = await buildServer(loadConfig({}), {
    store,
    gateway: new FakeSolanaGateway(() => NOW),
    gemini: gemini({}),
  });
  app.log.level = "silent";
  const created = await app.inject({
    method: "POST",
    url: "/api/promotions",
    payload: {
      merchant,
      shopName: "Bean There",
      itemName: "Latte",
      geminiMarketId: "GEMI-X-Y",
      offerAmount: "5000000",
      depositDeadline: NOW + 3600,
      maxYesPriceMicroUsd: "500000",
      hedgeBudget: "100000000",
    },
  });
  assert.equal(
    created.json().promotion.hedgeBudget,
    "100000000",
    "the creator sees what they typed",
  );
  await store.activatePromotion(created.json().promotion.id, {
    promoPda: "0x" + "1a".repeat(32),
    mint: "M",
  });

  const pub = (await app.inject({ url: "/api/promotions" })).json().promotions[0];
  for (const k of ["hedgeBudget", "maxYesPriceMicroUsd"]) assert.equal(k in pub, false, k);
  for (const k of ["thresholdBps", "budgetRemaining"]) assert.equal(k in pub.live, false, k);
  assert.ok(pub.live.costPerSale, "public price info stays");
  const one = (await app.inject({ url: `/api/promotions/${pub.id}` })).json().promotion;
  assert.equal("hedgeBudget" in one, false);
  await app.close();

  // Dashboard: public view without the shop's login, owner view with it.
  const app2 = await buildServer(loadConfig({}), { store, gateway: null, gemini: gemini({}) });
  app2.log.level = "silent";
  const anon = (await app2.inject({ url: `/api/merchants/${merchant}/dashboard` })).json();
  assert.equal(anon.viewer, "public");
  assert.equal("hedgeBudget" in anon.promotions[0], false);
  assert.ok(anon.promotions[0].stats, "sales stats are public chain data");
  await app2.close();

  owner = true;
  const { registerPromotionRoutes } = await import("./routes/promotions");
  const Fastify = (await import("fastify")).default;
  const app3 = Fastify();
  registerPromotionRoutes(app3, {
    store,
    gateway: null,
    gemini: gemini({}),
    isMerchant: async () => owner,
  });
  const mine = (
    await app3.inject({
      url: `/api/merchants/${merchant}/dashboard`,
      headers: { "x-user-token": "t".repeat(30) },
    })
  ).json();
  assert.equal(mine.viewer, "owner");
  assert.equal(mine.promotions[0].hedgeBudget, "100000000");
  assert.equal(mine.promotions[0].live.thresholdBps, 5000);
  await app3.close();
});

test("netting demo: two shops on opposite sides, live-priced, nothing stored", async () => {
  const store = new MemoryStore();
  const app = await buildServer(loadConfig({}), {
    store,
    gateway: null,
    gemini: gemini({ TEX: "920000", ARK: "90000" }),
  });
  app.log.level = "silent";
  const r = await app.inject({
    url: "/api/desk/demo?event=NCAAF-2611212030-ARK-TEX-M&a=100&b=60&price=5000000",
  });
  assert.equal(r.statusCode, 200, r.body);
  const d = r.json();
  assert.equal(d.simulated, true);
  assert.equal(d.scenario, "demo");
  assert.equal(d.hedgingEverySaleCosts, "487000000"); // 100 x $4.60 + 60 x $0.45
  assert.deepEqual(d.deskBuys, [{ marketId: "TEX", contracts: "200", cost: "184000000" }]);
  assert.equal(d.savings, "303000000");
  assert.equal(d.covered, true);
  assert.deepEqual(
    d.pnlIfWins.map((o: { pnl: string }) => o.pnl),
    ["3000000", "3000000"],
  );
  assert.equal(store.deskFills.length, 0, "nothing stored");
  assert.equal((await app.inject({ url: "/api/desk/demo?event=NCAAF-X-S" })).statusCode, 422);
  assert.equal((await app.inject({ url: "/api/desk/demo?event=bad!" })).statusCode, 400);
  await app.close();
});

test("CORS: several comma-separated origins are allowed, others are not", async () => {
  const config = loadConfig({ API_CORS_ORIGIN: "http://localhost:3000, https://app.example.com/" });
  assert.deepEqual(config.corsOrigin, ["http://localhost:3000", "https://app.example.com"]);
  const app = await buildServer(config, {
    store: new MemoryStore(),
    gateway: null,
    gemini: gemini({}),
  });
  app.log.level = "silent";
  const pre = (origin: string) =>
    app.inject({
      method: "OPTIONS",
      url: "/api/wallet",
      headers: {
        origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-user-token",
      },
    });
  const ok = await pre("https://app.example.com");
  assert.equal(ok.headers["access-control-allow-origin"], "https://app.example.com");
  assert.match(String(ok.headers["access-control-allow-headers"]), /x-user-token/i);
  assert.equal(
    (await pre("https://evil.example")).headers["access-control-allow-origin"],
    undefined,
  );
  await app.close();
});
