import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketSummary } from "@hedged/shared";
import { canonical, isChainId, isWalletAddress, sameChainString } from "./chain-ids";
import { loadConfig } from "./config";
import type { GeminiAdapter } from "./gemini/adapter";
import { FakeSolanaGateway } from "./orchestration/fake-gateway";
import { buildServer } from "./server";
import { MemoryStore } from "./store/memory-store";

/** Arc runs the same API with EVM ids: 0x addresses (merchant) and 0x bytes32 (promo/purchase). */
const MERCHANT_CHECKSUM: string = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const PROMO_ID: string = "0x" + "1a".repeat(32);
const PURCHASE_KEY: string = "0x" + "2B".repeat(32);
const SOL_PUBKEY: string = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

test("chain ids: Solana and Arc formats accepted, junk rejected, 0x compared case-insensitively", () => {
  assert.ok(isWalletAddress(SOL_PUBKEY));
  assert.ok(isWalletAddress(MERCHANT_CHECKSUM));
  assert.ok(!isWalletAddress("0x1234"));
  assert.ok(!isWalletAddress("not an address"));
  assert.ok(isChainId(PROMO_ID));
  assert.equal(isChainId(MERCHANT_CHECKSUM), false, "an address is not a bytes32 id");
  assert.equal(canonical(MERCHANT_CHECKSUM), MERCHANT_CHECKSUM.toLowerCase());
  assert.equal(canonical(SOL_PUBKEY), SOL_PUBKEY, "base58 is case-sensitive: kept as is");
  assert.ok(sameChainString(MERCHANT_CHECKSUM, MERCHANT_CHECKSUM.toLowerCase()));
});

function stubGemini(): GeminiAdapter {
  const market: MarketSummary = {
    source: "gemini-predictions",
    marketId: "GEMI-SOL05M2611211505-UP",
    eventTicker: "SOL05M2611211505",
    eventTitle: "SOL price",
    outcomeLabel: "Up",
    category: "Crypto",
    marketState: "open",
    bestAskMicroUsd: "500000",
    bestBidMicroUsd: null,
    lastTradeMicroUsd: null,
    expiresAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
    startsAt: null,
    opensAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    marketKind: "UP_DOWN",
    fetchedAt: new Date().toISOString(),
  };
  return {
    getMarket: async () => market,
    getQuote: async (marketId: string) => ({
      quote: {
        source: "gemini-predictions" as const,
        marketId,
        fetchedAt: new Date().toISOString(),
        yesAskMicroUsd: "500000",
        asks: [{ priceMicroUsd: "500000", quantity: "100" }],
      },
      eventTicker: market.eventTicker,
      eventTitle: market.eventTitle,
      outcomeLabel: "Up",
      marketState: "open",
    }),
  } as unknown as GeminiAdapter;
}

test("API with Arc ids: create -> confirm -> directory, dashboard and receipt", async () => {
  const store = new MemoryStore();
  const gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
  const app = await buildServer(loadConfig({}), { gemini: stubGemini(), store, gateway });
  app.log.level = "silent";
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // Merchant's wallet sends a checksummed address; it is stored canonically.
  const created = await app.inject({
    method: "POST",
    url: "/api/promotions",
    payload: {
      merchant: MERCHANT_CHECKSUM,
      shopName: "Bean There",
      itemName: "Latte",
      geminiMarketId: "GEMI-SOL05M2611211505-UP",
      offerAmount: "5000000",
      depositDeadline: deadline,
      maxYesPriceMicroUsd: "600000",
      hedgeBudget: "100000000",
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const { promotion, initializePromo } = created.json();
  assert.equal(promotion.shop.merchant, MERCHANT_CHECKSUM.toLowerCase());

  // The Arc gateway reports the merchant checksummed; ids are bytes32. Confirm still matches.
  gateway.addPromo({
    promoPda: PROMO_ID,
    merchant: MERCHANT_CHECKSUM,
    promoNonce: initializePromo.promoNonce,
    offerAmount: "5000000",
    depositDeadline: deadline,
    marketId: "GEMI-SOL05M2611211505-UP",
  });
  const confirmed = await app.inject({
    method: "POST",
    url: `/api/promotions/${promotion.id}/confirm`,
    payload: { promoPda: PROMO_ID.toUpperCase().replace("0X", "0x") },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().promotion.promoPda, PROMO_ID, "stored lowercase");

  const dir = (await app.inject({ url: "/api/promotions" })).json().promotions;
  assert.equal(dir.length, 1);
  const dash = await app.inject({ url: `/api/merchants/${MERCHANT_CHECKSUM}/dashboard` });
  assert.equal(dash.statusCode, 200, dash.body);
  assert.equal(dash.json().promotions.length, 1);

  // Receipt lookup by a bytes32 purchase key, in any case.
  await store.recordDeposit(
    {
      signature: "0x" + "99".repeat(32),
      eventIndex: 0,
      slot: 1,
      blockTime: null,
      commitment: "finalized",
      promo: PROMO_ID,
      purchase: PURCHASE_KEY.toLowerCase(),
      customer: "0x" + "33".repeat(20),
      purchaseId: "a".repeat(32),
      amount: "5000000",
      depositedAt: 0,
    },
    promotion.id,
  );
  const receipt = await app.inject({ url: `/api/purchases/${PURCHASE_KEY}` });
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.equal(receipt.json().step, "PROCESSING");
  await app.close();
});
