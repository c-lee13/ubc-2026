import assert from "node:assert/strict";
import { test } from "node:test";
import { HEDGED_ESCROW_ABI, promoIdOf, purchaseKeyOf } from "@hedged/arc";
import { SolanaGatewayError } from "@hedged/shared";
import { decodeFunctionData, erc20Abi, type Hex } from "viem";
import { loadConfig } from "../config";
import type { GeminiAdapter } from "../gemini/adapter";
import { buildServer } from "../server";
import { MemoryStore } from "../store/memory-store";
import type { ArcReads } from "./arc-reads";
import { ALREADY_INITIALIZED, CircleError, type CircleClient } from "./client";
import type { OneTapSubmitter } from "./routes";

const USER_TOKEN = "eyJ-test-user-token-0123456789";
const WALLET = {
  id: "11111111-1111-4111-8111-111111111111",
  address: "0x" + "aa".repeat(20),
  blockchain: "ARC-TESTNET",
};
const OTHER_WALLET_ID = "22222222-2222-4222-8222-222222222222";
const ESCROW = "0x" + "e5".repeat(20);
const USDC = "0x3600000000000000000000000000000000000000";
const PROMO_PDA = "0x" + "1a".repeat(32);

interface Call {
  method: string;
  path: string;
  userToken?: string;
  body?: Record<string, unknown>;
}

function fakeCircle(over: Partial<Record<string, (c: Call) => unknown>> = {}) {
  const calls: Call[] = [];
  const client: CircleClient = {
    async request<T>(
      method: "GET" | "POST",
      path: string,
      opts: { userToken?: string; body?: Record<string, unknown> } = {},
    ) {
      const call = { method, path, ...opts };
      calls.push(call);
      const key = `${method} ${path.split("?")[0]}`;
      if (over[key]) return over[key]!(call) as T;
      if (key === "POST /v1/w3s/users/email/token") {
        return { deviceToken: "dt", deviceEncryptionKey: "dek", otpToken: "ot" } as T;
      }
      if (key === "POST /v1/w3s/user/initialize") return { challengeId: "ch-init" } as T;
      if (key === "GET /v1/w3s/wallets") return { wallets: [WALLET] } as T;
      if (key === "POST /v1/w3s/user/transactions/contractExecution") {
        return { challengeId: `ch-${calls.length}` } as T;
      }
      if (key === "POST /v1/faucet/drips") return undefined as T;
      if (key === "POST /v1/w3s/user/sign/typedData") return { challengeId: "ch-sign" } as T;
      throw new Error(`unexpected ${key}`);
    },
  };
  return { client, calls };
}

async function setup(
  opts: {
    allowance?: bigint;
    balance?: bigint;
    ask?: string;
    circle?: ReturnType<typeof fakeCircle>;
    pda?: string | null;
    merchant?: string;
    oneTap?: OneTapSubmitter;
  } = {},
) {
  const store = new MemoryStore();
  const promo = await store.createPromotion({
    promoPda: opts.pda === undefined ? PROMO_PDA : opts.pda,
    promoNonce: "1",
    mint: USDC,
    merchant: opts.merchant ?? "0x" + "bb".repeat(20),
    itemName: "Latte",
    shopName: "Bean There",
    location: "",
    offerAmount: 5_000_000n,
    depositDeadline: Math.floor(Date.now() / 1000) + 3600,
    geminiMarketId: "GEMI-SOL05M2611211505-UP",
    outcomeLabel: "SOL up",
    maxYesPriceMicroUsd: 600_000n,
    hedgeBudget: 100_000_000n,
  });
  const circle = opts.circle ?? fakeCircle();
  const reads: ArcReads = {
    allowance: async () => opts.allowance ?? 0n,
    balance: async () => opts.balance ?? 20_000_000n,
    isV2: async () => false,
  };
  const gemini = {
    getQuote: async (marketId: string) => ({
      quote: {
        source: "gemini-predictions",
        marketId,
        fetchedAt: new Date().toISOString(),
        yesAskMicroUsd: opts.ask ?? "500000",
        asks: [],
      },
    }),
  } as unknown as GeminiAdapter;
  const app = await buildServer(loadConfig({}), {
    store,
    gateway: null,
    gemini,
    wallets: {
      circle: circle.client,
      appId: "app-123",
      arc: {
        escrow: ESCROW,
        token: USDC,
        reads,
        blockchain: "ARC-TESTNET",
        accountType: "EOA",
        allowanceCap: 100_000_000n,
        oneTap: opts.oneTap ?? null,
      },
    },
  });
  app.log.level = "silent";
  const auth = { "x-user-token": USER_TOKEN };
  return { app, promo, store, calls: circle.calls, auth };
}

test("wallet routes are off (503) without Circle config", async () => {
  const app = await buildServer(loadConfig({}), { store: new MemoryStore(), gateway: null });
  app.log.level = "silent";
  const r = await app.inject({
    method: "POST",
    url: "/api/wallet/email-login",
    payload: { email: "a@b.co", deviceId: "device-123" },
  });
  assert.equal(r.statusCode, 503);
  await app.close();
});

test("email login returns exactly what the SDK needs; API key never leaves the server", async () => {
  const { app, calls } = await setup();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/wallet/email-login",
        payload: { email: "nope", deviceId: "device-123" },
      })
    ).statusCode,
    400,
  );
  const r = await app.inject({
    method: "POST",
    url: "/api/wallet/email-login",
    payload: { email: "sam@example.com", deviceId: "device-123" },
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), {
    appId: "app-123",
    deviceToken: "dt",
    deviceEncryptionKey: "dek",
    otpToken: "ot",
  });
  assert.equal(calls[0]!.body!.email, "sam@example.com");
  assert.equal(calls[0]!.body!.deviceId, "device-123");
  assert.match(String(calls[0]!.body!.idempotencyKey), /^[0-9a-f-]{36}$/);
  await app.close();
});

test("wallet init: challenge on first login, alreadyInitialized after; login required", async () => {
  const { app, auth } = await setup();
  assert.equal((await app.inject({ method: "POST", url: "/api/wallet/init" })).statusCode, 401);
  const first = await app.inject({ method: "POST", url: "/api/wallet/init", headers: auth });
  assert.deepEqual(first.json(), { challengeId: "ch-init" });
  await app.close();

  const again = await setup({
    circle: fakeCircle({
      "POST /v1/w3s/user/initialize": () => {
        throw new CircleError(400, ALREADY_INITIALIZED, "user already initialized");
      },
    }),
  });
  const r = await again.app.inject({
    method: "POST",
    url: "/api/wallet/init",
    headers: again.auth,
  });
  assert.deepEqual(r.json(), { alreadyInitialized: true });
  await again.app.close();
});

test("wallet list shows the Arc wallet with its USDC balance", async () => {
  const { app, auth } = await setup({ balance: 12_500_000n });
  const r = (await app.inject({ url: "/api/wallet", headers: auth })).json();
  assert.deepEqual(r.wallets, [{ ...WALLET, usdcBalance: "12500000" }]);
  await app.close();
});

test("checkout: approve once (up to $100), then a one-tap deposit with the right purchase key", async () => {
  const s = await setup({ allowance: 0n });
  const url = (p: string) => `/api/checkout/${s.promo.id}/${p}`;
  const status = (
    await s.app.inject({ url: `${url("status")}?walletId=${WALLET.id}`, headers: s.auth })
  ).json();
  assert.equal(status.needsApproval, true);
  assert.equal(status.canBuy, true);
  assert.equal(status.price, "5000000");

  assert.equal(
    (
      await s.app.inject({
        method: "POST",
        url: url("deposit"),
        headers: s.auth,
        payload: { walletId: WALLET.id },
      })
    ).json().error,
    "approval_needed",
  );
  const approve = await s.app.inject({
    method: "POST",
    url: url("approve"),
    headers: s.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(approve.statusCode, 200);
  const approveCall = s.calls.at(-1)!;
  assert.equal(approveCall.body!.contractAddress, USDC);
  const a = decodeFunctionData({ abi: erc20Abi, data: approveCall.body!.callData as Hex });
  assert.equal(a.functionName, "approve");
  assert.deepEqual([String(a.args![0]).toLowerCase(), a.args![1]], [ESCROW, 100_000_000n]);
  await s.app.close();

  const t = await setup({ allowance: 100_000_000n });
  const dep = await t.app.inject({
    method: "POST",
    url: `/api/checkout/${t.promo.id}/deposit`,
    headers: t.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(dep.statusCode, 200, dep.body);
  const body = dep.json();
  const call = t.calls.at(-1)!;
  assert.equal(call.body!.contractAddress, ESCROW);
  assert.equal(call.body!.walletId, WALLET.id);
  const d = decodeFunctionData({ abi: HEDGED_ESCROW_ABI, data: call.body!.callData as Hex });
  assert.equal(d.functionName, "deposit");
  assert.equal(d.args![0], PROMO_PDA);
  assert.equal(d.args![2], 5_000_000n);
  const expected = purchaseKeyOf(
    PROMO_PDA as Hex,
    WALLET.address as Hex,
    body.purchaseIdHex,
  ).toLowerCase();
  assert.equal(body.purchaseKey, expected);
  assert.equal(body.receipt, `/api/purchases/${expected}`);
  assert.equal(call.body!.refId, expected);
  await t.app.close();
});

test("checkout refusals: paused promo, no balance, someone else's wallet, Solana promo", async () => {
  const paused = await setup({ allowance: 100_000_000n, ask: "900000" });
  const p = await paused.app.inject({
    method: "POST",
    url: `/api/checkout/${paused.promo.id}/deposit`,
    headers: paused.auth,
    payload: { walletId: WALLET.id },
  });
  assert.deepEqual(
    [p.statusCode, p.json().error, p.json().pauseReason],
    [409, "promo_not_buyable", "PRICE_ABOVE_THRESHOLD"],
  );
  await paused.app.close();

  const broke = await setup({ allowance: 100_000_000n, balance: 1_000_000n });
  const b = await broke.app.inject({
    method: "POST",
    url: `/api/checkout/${broke.promo.id}/deposit`,
    headers: broke.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(b.json().error, "insufficient_usdc");
  const other = await broke.app.inject({
    method: "POST",
    url: `/api/checkout/${broke.promo.id}/deposit`,
    headers: broke.auth,
    payload: { walletId: OTHER_WALLET_ID },
  });
  assert.equal(other.statusCode, 404);
  await broke.app.close();

  const sol = await setup({ pda: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" });
  const s = await sol.app.inject({
    url: `/api/checkout/${sol.promo.id}/status?walletId=${WALLET.id}`,
    headers: sol.auth,
  });
  assert.equal(s.json().error, "not_an_arc_promotion");
  await sol.app.close();
});

test("faucet refusal is reported as faucet_unavailable; expired login as circle_session_invalid", async () => {
  const s = await setup({
    circle: fakeCircle({
      "POST /v1/faucet/drips": () => {
        throw new CircleError(403, 1, "Calling the faucet API requires upgrading to mainnet");
      },
    }),
  });
  const f = await s.app.inject({
    method: "POST",
    url: "/api/wallet/faucet",
    headers: s.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(f.statusCode, 502);
  assert.equal(f.json().error, "faucet_unavailable");
  await s.app.close();

  const e = await setup({
    circle: fakeCircle({
      "GET /v1/w3s/wallets": () => {
        throw new CircleError(401, 155104, "Invalid user token");
      },
    }),
  });
  const w = await e.app.inject({ url: "/api/wallet", headers: e.auth });
  assert.equal(w.json().error, "circle_session_invalid");
  await e.app.close();
});

async function addPurchase(
  store: MemoryStore,
  promo: { id: string; promoPda: string | null },
  customer: string,
  onChainState: "Deposited" | "Hedged" | "Cancelled",
  n = 1,
) {
  const key = "0x" + n.toString(16).padStart(2, "0").repeat(32);
  await store.recordDeposit(
    {
      signature: `0x${"ab".repeat(31)}${n.toString(16).padStart(2, "0")}`,
      eventIndex: 0,
      slot: n,
      blockTime: null,
      commitment: "finalized",
      promo: promo.promoPda!,
      purchase: key,
      customer,
      purchaseId: "c".repeat(32),
      amount: "5000000",
      depositedAt: 1_795_370_000 + n,
    },
    promo.id,
  );
  await store.patchPurchase(key, { onChainState });
  return key;
}

const decode = (call: Call) =>
  decodeFunctionData({ abi: HEDGED_ESCROW_ABI, data: call.body!.callData as Hex });

test("shop publishes its draft from its email wallet; the returned promoPda matches the contract id", async () => {
  const s = await setup({ pda: null, merchant: WALLET.address });
  assert.equal(s.promo.status, "DRAFT");
  const r = await s.app.inject({
    method: "POST",
    url: `/api/promotions/${s.promo.id}/initialize`,
    headers: s.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(r.statusCode, 200, r.body);
  const call = s.calls.at(-1)!;
  assert.equal(call.body!.contractAddress, ESCROW);
  const d = decode(call);
  assert.equal(d.functionName, "initializePromo");
  assert.deepEqual(d.args, [
    1n,
    5_000_000n,
    BigInt(s.promo.depositDeadline),
    s.promo.geminiMarketId,
  ]);
  assert.equal(r.json().promoPda, promoIdOf(WALLET.address as Hex, 1n).toLowerCase());
  assert.equal(r.json().confirm, `/api/promotions/${s.promo.id}/confirm`);
  await s.app.close();

  // Another shop's draft, and an already-published promo, are refused.
  const other = await setup({ pda: null });
  const o = await other.app.inject({
    method: "POST",
    url: `/api/promotions/${other.promo.id}/initialize`,
    headers: other.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(o.json().error, "not_this_shops_wallet");
  await other.app.close();
  const live = await setup({ merchant: WALLET.address });
  const l = await live.app.inject({
    method: "POST",
    url: `/api/promotions/${live.promo.id}/initialize`,
    headers: live.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(l.json().error, "already_published");
  await live.app.close();
});

test("customer refund / cancel: only their own purchase, only in a claimable state", async () => {
  const s = await setup();
  const cancelled = await addPurchase(s.store, s.promo, WALLET.address, "Cancelled", 1);
  const deposited = await addPurchase(s.store, s.promo, WALLET.address, "Deposited", 2);
  const hedged = await addPurchase(s.store, s.promo, WALLET.address, "Hedged", 3);
  const someoneElse = await addPurchase(s.store, s.promo, "0x" + "cc".repeat(20), "Cancelled", 4);
  const act = (key: string, kind: string) =>
    s.app.inject({
      method: "POST",
      url: `/api/purchases/${key}/${kind}`,
      headers: s.auth,
      payload: { walletId: WALLET.id },
    });

  const refund = await act(cancelled.toUpperCase().replace("0X", "0x"), "claim-refund");
  assert.equal(refund.statusCode, 200, refund.body);
  assert.equal(decode(s.calls.at(-1)!).functionName, "claimRefund");
  assert.deepEqual(decode(s.calls.at(-1)!).args, [cancelled]);

  const cancel = await act(deposited, "cancel-expired");
  assert.equal(cancel.statusCode, 200, cancel.body);
  assert.equal(decode(s.calls.at(-1)!).functionName, "cancelExpiredDeposit");

  assert.equal(
    (await act(hedged, "claim-refund")).json().error,
    "nothing_to_claim",
    "no result yet",
  );
  assert.equal((await act(hedged, "cancel-expired")).json().error, "not_cancellable");
  assert.equal((await act(someoneElse, "claim-refund")).statusCode, 403);
  assert.equal((await act("0x" + "99".repeat(32), "claim-refund")).statusCode, 404);
  assert.equal((await act("nope", "claim-refund")).statusCode, 400);

  await s.store.setPromotionResolved(s.promo.id, "YES", null);
  assert.equal((await act(hedged, "claim-refund")).statusCode, 200, "YES result: refund claimable");
  await s.app.close();
});

test("shop collects after a NO result: every key checked before any challenge is created", async () => {
  const s = await setup({ merchant: WALLET.address });
  const a = await addPurchase(s.store, s.promo, "0x" + "cc".repeat(20), "Hedged", 1);
  const b = await addPurchase(s.store, s.promo, "0x" + "dd".repeat(20), "Hedged", 2);
  const collect = (purchaseKeys: unknown) =>
    s.app.inject({
      method: "POST",
      url: "/api/purchases/claim-merchant",
      headers: s.auth,
      payload: { walletId: WALLET.id, purchaseKeys },
    });

  const before = s.calls.length;
  const early = await collect([a, b]);
  assert.equal(early.json().error, "nothing_to_collect", "not resolved yet");
  await s.store.setPromotionResolved(s.promo.id, "NO", null);
  const mixed = await collect([a, "0x" + "99".repeat(32)]);
  assert.equal(mixed.statusCode, 404);
  const contractCalls = s.calls.slice(before).filter((c) => c.path.endsWith("contractExecution"));
  assert.equal(contractCalls.length, 0, "a bad key creates no challenges");

  const ok = await collect([a, b, a]);
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(
    ok.json().challenges.map((c: { purchaseKey: string }) => c.purchaseKey),
    [a, b],
  );
  assert.equal(decode(s.calls.at(-1)!).functionName, "claimMerchant");
  assert.equal((await collect([])).statusCode, 400);
  await s.app.close();

  const notMine = await setup();
  const k = await addPurchase(notMine.store, notMine.promo, "0x" + "cc".repeat(20), "Hedged", 1);
  await notMine.store.setPromotionResolved(notMine.promo.id, "NO", null);
  const r = await notMine.app.inject({
    method: "POST",
    url: "/api/purchases/claim-merchant",
    headers: notMine.auth,
    payload: { walletId: WALLET.id, purchaseKeys: [k] },
  });
  assert.equal(r.json().error, "not_this_shops_purchase");
  await notMine.app.close();
});

test("counter feed and customer list: newest first, order code matches the receipt", async () => {
  const s = await setup();
  const first = await addPurchase(s.store, s.promo, WALLET.address, "Hedged", 1);
  const second = await addPurchase(s.store, s.promo, "0x" + "cc".repeat(20), "Deposited", 2);
  await s.store.patchPurchase(first, { status: "HEDGED" });

  const feed = (await s.app.inject({ url: `/api/promotions/${s.promo.id}/purchases` })).json();
  assert.deepEqual(
    feed.purchases.map((p: { purchasePda: string }) => p.purchasePda),
    [second, first],
  );
  assert.equal(feed.purchases[1].canServe, true);
  assert.equal(feed.purchases[0].canServe, false);
  const receipt = (await s.app.inject({ url: `/api/purchases/${first}` })).json();
  assert.equal(feed.purchases[1].orderCode, receipt.orderCode);
  assert.equal((await s.app.inject({ url: "/api/promotions/nope/purchases" })).statusCode, 404);

  const mine = (
    await s.app.inject({
      url: `/api/purchases?customer=${WALLET.address.toUpperCase().replace("0X", "0x")}`,
    })
  ).json();
  assert.deepEqual(
    mine.purchases.map((p: { purchasePda: string }) => p.purchasePda),
    [first],
  );
  assert.equal(mine.purchases[0].promotion.shopName, "Bean There");
  assert.equal((await s.app.inject({ url: "/api/purchases?customer=bad" })).statusCode, 400);
  await s.app.close();
});

function fakeRelayer(fail?: SolanaGatewayError) {
  const calls: Parameters<OneTapSubmitter["submitAuthorizedDeposit"]>[0][] = [];
  const relayer: OneTapSubmitter = {
    async submitAuthorizedDeposit(d) {
      calls.push(d);
      if (fail) throw fail;
      return {
        purchasePda: purchaseKeyOf(d.promoId, d.customer, d.purchaseIdHex),
        signature: "0x" + "77".repeat(32),
      };
    },
  };
  return { relayer, calls };
}

const SIG = "0x" + "ab".repeat(65);

test("one-tap (v2): sign exactly the promo price for this customer, relayer submits", async () => {
  const r = fakeRelayer();
  const s = await setup({ oneTap: r.relayer, allowance: 0n });
  const status = (
    await s.app.inject({
      url: `/api/checkout/${s.promo.id}/status?walletId=${WALLET.id}`,
      headers: s.auth,
    })
  ).json();
  assert.deepEqual([status.checkout, status.needsApproval], ["one-tap", false]);

  const sign = await s.app.inject({
    method: "POST",
    url: `/api/checkout/${s.promo.id}/sign`,
    headers: s.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(sign.statusCode, 200, sign.body);
  const b = sign.json();
  assert.equal(b.challengeId, "ch-sign");
  const call = s.calls.at(-1)!;
  assert.equal(call.path, "/v1/w3s/user/sign/typedData");
  assert.equal(call.userToken, USER_TOKEN);
  assert.equal(call.body!.walletId, WALLET.id);
  const typed = JSON.parse(String(call.body!.data));
  assert.equal(typed.primaryType, "ReceiveWithAuthorization");
  assert.deepEqual(typed.domain, {
    name: "USDC",
    version: "2",
    chainId: 5042002,
    verifyingContract: USDC,
  });
  assert.equal(typed.message.from.toLowerCase(), WALLET.address);
  assert.equal(typed.message.to.toLowerCase(), ESCROW);
  assert.equal(typed.message.value, "5000000");
  assert.equal(typed.message.validAfter, "0");
  assert.equal(typed.message.validBefore, String(b.validBefore));
  const expectedKey = purchaseKeyOf(PROMO_PDA as Hex, WALLET.address as Hex, b.purchaseIdHex);
  assert.equal(typed.message.nonce.toLowerCase(), expectedKey.toLowerCase());
  assert.equal(b.purchaseKey, expectedKey.toLowerCase());
  assert.ok(b.validBefore <= Math.floor(Date.now() / 1000) + 300);
  assert.match(String(call.body!.memo), /Pay \$5\.00 for Latte/);

  const submit = await s.app.inject({
    method: "POST",
    url: b.submit,
    headers: s.auth,
    payload: {
      walletId: WALLET.id,
      purchaseIdHex: b.purchaseIdHex,
      validBefore: b.validBefore,
      signature: SIG,
    },
  });
  assert.equal(submit.statusCode, 200, submit.body);
  assert.equal(submit.json().purchaseKey, b.purchaseKey);
  assert.equal(submit.json().receipt, `/api/purchases/${b.purchaseKey}`);
  assert.deepEqual(r.calls[0], {
    promoId: PROMO_PDA,
    purchaseIdHex: b.purchaseIdHex,
    customer: WALLET.address,
    amount: 5_000_000n,
    validAfter: 0n,
    validBefore: BigInt(b.validBefore),
    signature: SIG,
  });
  await s.app.close();
});

test("one-tap refusals: bad input, expired, price moved, chain rejects, relayer down, v1", async () => {
  const later = Math.floor(Date.now() / 1000) + 200;
  const body = (over: Record<string, unknown> = {}) => ({
    walletId: WALLET.id,
    purchaseIdHex: "c".repeat(32),
    validBefore: later,
    signature: SIG,
    ...over,
  });
  const r = fakeRelayer();
  const s = await setup({ oneTap: r.relayer });
  const submit = (payload: Record<string, unknown>) =>
    s.app.inject({
      method: "POST",
      url: `/api/checkout/${s.promo.id}/submit`,
      headers: s.auth,
      payload,
    });
  assert.equal((await submit(body({ signature: "0x12" }))).json().error, "invalid_signature");
  assert.equal((await submit(body({ purchaseIdHex: "xyz" }))).json().error, "invalid_purchase_id");
  assert.equal((await submit(body({ validBefore: 5 }))).json().error, "signature_expired");
  assert.equal(r.calls.length, 0);
  await s.app.close();

  const paused = await setup({ oneTap: r.relayer, ask: "900000" });
  const p = await paused.app.inject({
    method: "POST",
    url: `/api/checkout/${paused.promo.id}/submit`,
    headers: paused.auth,
    payload: body(),
  });
  assert.deepEqual([p.statusCode, p.json().error], [409, "promo_not_buyable"]);
  assert.equal(r.calls.length, 0, "price moved since signing: nothing submitted");
  await paused.app.close();

  for (const [err, code, error] of [
    [new SolanaGatewayError("TX_FAILED", "bad signature"), 409, "deposit_rejected"],
    [new SolanaGatewayError("RPC_UNAVAILABLE", "down"), 503, "relayer_unavailable"],
  ] as const) {
    const t = await setup({ oneTap: fakeRelayer(err).relayer });
    const res = await t.app.inject({
      method: "POST",
      url: `/api/checkout/${t.promo.id}/submit`,
      headers: t.auth,
      payload: body(),
    });
    assert.deepEqual([res.statusCode, res.json().error], [code, error]);
    await t.app.close();
  }

  const v1 = await setup();
  const sign = await v1.app.inject({
    method: "POST",
    url: `/api/checkout/${v1.promo.id}/sign`,
    headers: v1.auth,
    payload: { walletId: WALLET.id },
  });
  assert.equal(sign.json().error, "one_tap_unavailable");
  const st = (
    await v1.app.inject({
      url: `/api/checkout/${v1.promo.id}/status?walletId=${WALLET.id}`,
      headers: v1.auth,
    })
  ).json();
  assert.equal(st.checkout, "approve-deposit");
  await v1.app.close();
});
