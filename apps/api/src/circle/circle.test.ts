import assert from "node:assert/strict";
import { test } from "node:test";
import { HEDGED_ESCROW_ABI, purchaseKeyOf } from "@hedged/arc";
import { decodeFunctionData, erc20Abi, type Hex } from "viem";
import { loadConfig } from "../config";
import type { GeminiAdapter } from "../gemini/adapter";
import { buildServer } from "../server";
import { MemoryStore } from "../store/memory-store";
import type { ArcReads } from "./arc-reads";
import { ALREADY_INITIALIZED, CircleError, type CircleClient } from "./client";

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
    pda?: string;
  } = {},
) {
  const store = new MemoryStore();
  const promo = await store.createPromotion({
    promoPda: opts.pda ?? PROMO_PDA,
    promoNonce: "1",
    mint: USDC,
    merchant: "0x" + "bb".repeat(20),
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
      },
    },
  });
  app.log.level = "silent";
  const auth = { "x-user-token": USER_TOKEN };
  return { app, promo, calls: circle.calls, auth };
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
