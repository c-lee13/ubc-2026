/**
 * End-to-end test of @hedged/arc against a LOCAL anvil node running the compiled HedgedEscrow and
 * a 6-decimal MockUSDC (stand-in for Arc's USDC ERC-20 interface). Mirrors
 * packages/solana/scripts/localnet-e2e.ts. Start anvil first, then run:
 *
 *   anvil --port 18545 --silent &
 *   ANVIL_RPC_URL=http://127.0.0.1:18545 pnpm --filter @hedged/arc test:anvil
 *
 * Uses anvil's public dev mnemonic for customer/merchant/admin wallets (local only) and a fresh
 * relayer key written to a temp file OUTSIDE the repo (exercises createArcGatewayFromEnv).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaimEvent, DepositEvent, ResolutionEvent } from "@hedged/shared";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import {
  generatePrivateKey,
  mnemonicToAccount,
  privateKeyToAccount,
  type HDAccount,
} from "viem/accounts";
import {
  HEDGED_ESCROW_ABI,
  HEDGED_ESCROW_BYTECODE,
  MOCK_USDC_ABI,
  MOCK_USDC_BYTECODE,
} from "../src/abi";
import { promoIdOf, purchaseKeyOf, newPurchaseIdHex } from "../src/ids";
import {
  buildApproveTx,
  buildCancelExpiredDepositTx,
  buildClaimMerchantTx,
  buildClaimRefundTx,
  buildDepositTx,
  buildDepositWithPermitTx,
  buildInitializePromoTx,
  type UnsignedTx,
} from "../src/transactions";
import {
  permitTypedData,
  readPermitNonce,
  readTokenDomain,
  receiveAuthorizationTypedData,
} from "../src/checkout";
import { escrowErrorName } from "../src/errors";
import { isEscrowV2 } from "../src/accounts";
import {
  ArcGateway,
  computeStreamsSignature,
  createArcGatewayFromEnv,
  GatewayInvalidStateError,
  ResolutionTooEarlyError,
  runArcStreamsFilterLocally,
  type ArcResolutionEvent,
  startArcStreamsWebhookServer,
} from "../src/server";
import { SolanaGatewayError } from "@hedged/shared";

const RPC = process.env.ANVIL_RPC_URL ?? "http://127.0.0.1:18545";
const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) }) as PublicClient;
const testClient = createTestClient({ chain, mode: "anvil", transport: http(RPC) });
const MN = "test test test test test test test test test test test junk";
const acct = (i: number) => mnemonicToAccount(MN, { addressIndex: i });
const [admin, merchant, alice, bob, carol, dave, frank] = [0, 2, 3, 4, 5, 6, 7].map(acct) as [
  HDAccount,
  HDAccount,
  HDAccount,
  HDAccount,
  HDAccount,
  HDAccount,
  HDAccount,
];
const OFFER = 5_000_000n;
const TIMEOUT = 3n;

let passed = 0;
let failed = 0;
function check(cond: unknown, name: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`, extra ?? "");
  }
}
async function expectGatewayError<T>(
  p: Promise<T>,
  code: string,
  name: string,
  extra?: (e: SolanaGatewayError) => boolean,
) {
  try {
    await p;
    check(false, name, "no error");
  } catch (e) {
    const g = e as SolanaGatewayError;
    check(
      g instanceof SolanaGatewayError && g.code === code && (extra ? extra(g) : true),
      name,
      `${g.name} ${g.code} ${g.message}`,
    );
  }
}

async function send(who: HDAccount, t: UnsignedTx): Promise<Hash> {
  const w = createWalletClient({ chain, transport: http(RPC), account: who });
  const hash = await w.sendTransaction({ to: t.to, data: t.data, value: 0n, account: who, chain });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${t.description} reverted`);
  return hash;
}

async function deploy(
  abi: readonly unknown[],
  bytecode: Hex,
  args: readonly unknown[],
): Promise<Address> {
  const w = createWalletClient({ chain, transport: http(RPC), account: admin });
  const hash = await w.deployContract({
    abi: abi as never,
    bytecode,
    args: args as never,
    account: admin,
    chain,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress) throw new Error("deploy failed");
  return r.contractAddress;
}

const now = async () => Number((await pub.getBlock()).timestamp);
const advance = async (secs: number) => {
  await testClient.increaseTime({ seconds: secs });
  await testClient.mine({ blocks: 1 });
};

async function main() {
  console.log(`anvil e2e against ${RPC}`);
  const relayerKey = generatePrivateKey();
  const keyDir = mkdtempSync(join(tmpdir(), "arc-e2e-"));
  const keyPath = join(keyDir, "relayer.json");
  writeFileSync(keyPath, JSON.stringify({ privateKey: relayerKey }), { mode: 0o600 });
  const relayer = privateKeyToAccount(relayerKey);
  await testClient.setBalance({ address: relayer.address, value: 10n ** 20n });

  const usdc = await deploy(MOCK_USDC_ABI, MOCK_USDC_BYTECODE, []);
  const escrow = await deploy(HEDGED_ESCROW_ABI, HEDGED_ESCROW_BYTECODE, [
    usdc,
    relayer.address,
    TIMEOUT,
  ]);
  console.log("deployed", { usdc, escrow });

  const w = createWalletClient({ chain, transport: http(RPC), account: admin });
  for (const c of [alice, bob, carol]) {
    const h = await w.writeContract({
      address: usdc,
      abi: MOCK_USDC_ABI,
      functionName: "mint",
      args: [c.address, 100n * OFFER],
      account: admin,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash: h });
    await send(c, buildApproveTx(usdc, escrow, "max"));
  }

  const env = {
    ARC_RPC_URL: RPC,
    ALLOW_LOCAL_CHAIN: "1",
    ARC_ESCROW_ADDRESS: escrow,
    ARC_RELAYER_KEY_PATH: keyPath,
    ARC_FINALITY: "finalized",
    ARC_EVENT_SOURCE: "poll",
    ARC_SWEEP_MS: "300",
  } as NodeJS.ProcessEnv;
  const gw = await createArcGatewayFromEnv(env, () => {});

  console.log("\n# config and reads");
  // reads default to the `finalized` commitment: wait until the deploy block is final
  let cfg = await gw.getConfig();
  for (let i = 0; i < 20 && !cfg?.relayer; i++) {
    await new Promise((r) => setTimeout(r, 500));
    cfg = await gw.getConfig();
  }
  const eq = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  check(
    eq(cfg?.relayer, relayer.address) &&
      eq(cfg?.mint, usdc) &&
      eq(cfg?.admin, admin.address) &&
      cfg?.paused === false,
    "getConfig mirrors the constructor",
    cfg,
  );

  // subscribers (from block 0 = full replay semantics)
  const deposits: DepositEvent[] = [];
  const claims: ClaimEvent[] = [];
  const resolutions: ResolutionEvent[] = [];
  let flakyCalls = 0;
  const flakySeen: string[] = [];
  const subD = await gw.subscribeToDeposits(async (e) => void deposits.push(e), { fromSlot: 0 });
  const subC = await gw.subscribeToClaims(async (e) => void claims.push(e), { fromSlot: 0 });
  const subR = await gw.subscribeToResolutions(async (e) => void resolutions.push(e), {
    fromSlot: 0,
  });
  const subF = await gw.subscribeToDeposits(async (e) => {
    flakyCalls++;
    if (flakyCalls === 1) throw new Error("transient handler failure");
    flakySeen.push(`${e.signature}:${e.eventIndex}`);
  });

  console.log("\n# promo A: YES path, hedge failure, timeout race");
  const deadlineA = BigInt((await now()) + 60);
  await send(
    merchant,
    buildInitializePromoTx(escrow, {
      promoNonce: 1n,
      offerAmount: OFFER,
      depositDeadline: deadlineA,
      marketId: "gemini:SOL-UP-5M",
    }),
  );
  const promoA = promoIdOf(merchant.address, 1n);
  const pA = await gw.getPromoState(promoA, "confirmed");
  check(
    pA?.state === "Active" && pA.offerAmount === "5000000" && pA.cancelTimeoutSecs === 3,
    "promo A created with offer + timeout snapshot",
  );

  const idA1 = newPurchaseIdHex();
  const idA2 = newPurchaseIdHex();
  const idB1 = newPurchaseIdHex();
  const depA1 = await send(
    alice,
    buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idA1, amount: OFFER }),
  );
  await send(
    alice,
    buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idA2, amount: OFFER }),
  );
  await send(bob, buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idB1, amount: OFFER }));
  const a1 = purchaseKeyOf(promoA, alice.address, idA1);
  const a2 = purchaseKeyOf(promoA, alice.address, idA2);
  const b1 = purchaseKeyOf(promoA, bob.address, idB1);
  const list = await gw.listPurchases(promoA, "confirmed");
  check(
    list.length === 3 && list.every((u) => u.state === "Deposited"),
    "listPurchases returns all 3 Deposited purchases",
  );

  const v = await gw.verifyTransaction(depA1);
  const ev0 = v.events[0];
  check(
    v.confirmed && v.events.length === 1 && ev0?.name === "DepositEvent" && ev0.purchase === a1,
    "verifyTransaction(deposit) yields one verified DepositEvent",
  );

  const r1 = await gw.markHedged(a1);
  check(!r1.alreadyApplied && r1.signature, "markHedged: Deposited -> Hedged");
  const r1b = await gw.markHedged(a1);
  check(
    r1b.alreadyApplied && r1b.signature === r1.signature,
    "markHedged repeat: alreadyApplied with the original tx",
  );
  await expectGatewayError(
    gw.cancelUnhedged(a1),
    "INVALID_STATE",
    "cancelUnhedged on Hedged: INVALID_STATE",
    (e) => (e as GatewayInvalidStateError).observedState === "Hedged",
  );

  const rc = await gw.cancelUnhedged(b1);
  check(!rc.alreadyApplied, "cancelUnhedged (hedge failure): Deposited -> Cancelled");
  const rcb = await gw.cancelUnhedged(b1);
  check(
    rcb.alreadyApplied && rcb.signature === rc.signature,
    "cancelUnhedged repeat: alreadyApplied",
  );
  await expectGatewayError(
    gw.markHedged(b1),
    "INVALID_STATE",
    "markHedged on Cancelled: INVALID_STATE",
    (e) => (e as GatewayInvalidStateError).observedState === "Cancelled",
  );

  try {
    await gw.resolvePromotion(promoA, "YES");
    check(false, "resolve before deadline must fail");
  } catch (e) {
    const t = e as ResolutionTooEarlyError;
    check(
      t instanceof ResolutionTooEarlyError && t.retryable && t.retryAfterUnix === Number(deadlineA),
      "resolve before deadline: ResolutionTooEarly, retryable, retryAfter = deadline",
    );
  }

  // customer timeout cancel wins the race against a slow markHedged
  await advance(Number(TIMEOUT));
  await send(alice, buildCancelExpiredDepositTx(escrow, a2));
  await expectGatewayError(
    gw.markHedged(a2),
    "INVALID_STATE",
    "markHedged after customer timeout-cancel: INVALID_STATE (race lost)",
    (e) => (e as GatewayInvalidStateError).observedState === "Cancelled",
  );

  console.log("\n# pause and authorization");
  const adminW = createWalletClient({ chain, transport: http(RPC), account: admin });
  const setPaused = async (p: boolean) =>
    pub.waitForTransactionReceipt({
      hash: await adminW.writeContract({
        address: escrow,
        abi: HEDGED_ESCROW_ABI,
        functionName: "setPaused",
        args: [p],
        account: admin,
        chain,
      }),
    });
  const idC0 = newPurchaseIdHex();
  await send(
    carol,
    buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idC0, amount: OFFER }),
  );
  const c0 = purchaseKeyOf(promoA, carol.address, idC0);
  await setPaused(true);
  await expectGatewayError(gw.markHedged(c0), "PAUSED", "markHedged while paused: PAUSED");
  const rcp = await gw.cancelUnhedged(c0);
  check(!rcp.alreadyApplied, "cancelUnhedged works while paused");
  await setPaused(false);
  const strangerKey = join(keyDir, "stranger.json");
  writeFileSync(strangerKey, JSON.stringify({ privateKey: generatePrivateKey() }), { mode: 0o600 });
  const stranger = await createArcGatewayFromEnv(
    { ...env, ARC_RELAYER_KEY_PATH: strangerKey },
    () => {},
  );
  await testClient.setBalance({ address: stranger.relayerAddress, value: 10n ** 20n });
  const idX = newPurchaseIdHex();
  await send(bob, buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idX, amount: OFFER }));
  const x = purchaseKeyOf(promoA, bob.address, idX);
  await expectGatewayError(
    stranger.markHedged(x),
    "NOT_AUTHORIZED",
    "a non-relayer key: NOT_AUTHORIZED",
  );
  await gw.cancelUnhedged(x);
  await expectGatewayError(
    gw.markHedged(`0x${"ab".repeat(32)}`),
    "ACCOUNT_NOT_FOUND",
    "unknown purchase: ACCOUNT_NOT_FOUND",
  );

  console.log("\n# resolve A = YES, claims");
  await advance(70);
  const rr = await gw.resolvePromotion(promoA, "YES");
  check(!rr.alreadyApplied, "resolvePromotion YES after the deadline");
  const rr2 = await gw.resolvePromotion(promoA, "YES");
  check(
    rr2.alreadyApplied && rr2.signature === rr.signature,
    "resolve same outcome again: alreadyApplied",
  );
  await expectGatewayError(
    gw.resolvePromotion(promoA, "NO"),
    "INVALID_STATE",
    "resolve conflicting outcome: INVALID_STATE",
  );

  const balA0 = (await pub.readContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [alice.address],
  })) as bigint;
  const cA1 = await send(alice, buildClaimRefundTx(escrow, a1));
  const cA2 = await send(alice, buildClaimRefundTx(escrow, a2));
  const cB1 = await send(bob, buildClaimRefundTx(escrow, b1));
  await send(carol, buildClaimRefundTx(escrow, c0));
  await send(bob, buildClaimRefundTx(escrow, x));
  const balA1 = (await pub.readContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [alice.address],
  })) as bigint;
  check(
    balA1 - balA0 === 2n * OFFER,
    "alice got exactly 2 x 5 USDC back (YES refund + timeout refund)",
  );
  const vA1 = await gw.verifyTransaction(cA1);
  const vA2 = await gw.verifyTransaction(cA2);
  const vB1 = await gw.verifyTransaction(cB1);
  const kind = (vv: typeof vA1) => (vv.events[0]?.name === "ClaimEvent" ? vv.events[0].kind : null);
  check(
    kind(vA1) === "YES_REFUND" && kind(vA2) === "CANCEL_REFUND" && kind(vB1) === "CANCEL_REFUND",
    "claim txs verify with the right ClaimKind",
  );

  console.log("\n# promo B: NO path, merchant payout");
  const deadlineB = BigInt((await now()) + 30);
  await send(
    merchant,
    buildInitializePromoTx(escrow, {
      promoNonce: 2n,
      offerAmount: OFFER,
      depositDeadline: deadlineB,
      marketId: "gemini:TEXAS-WIN",
    }),
  );
  const promoB = promoIdOf(merchant.address, 2n);
  const idC1 = newPurchaseIdHex();
  await send(
    carol,
    buildDepositTx(escrow, { promoId: promoB, purchaseIdHex: idC1, amount: OFFER }),
  );
  const c1 = purchaseKeyOf(promoB, carol.address, idC1);
  await gw.markHedged(c1);
  await advance(31);
  await gw.resolvePromotion(promoB, "NO");
  const mBal0 = (await pub.readContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [merchant.address],
  })) as bigint;
  const cM = await send(merchant, buildClaimMerchantTx(escrow, c1));
  const mBal1 = (await pub.readContract({
    address: usdc,
    abi: MOCK_USDC_ABI,
    functionName: "balanceOf",
    args: [merchant.address],
  })) as bigint;
  check(
    mBal1 - mBal0 === OFFER && kind(await gw.verifyTransaction(cM)) === "MERCHANT_PAYOUT",
    "merchant paid exactly 5 USDC after NO (MERCHANT_PAYOUT)",
  );

  console.log("\n# conservation");
  const pAf = await gw.getPromoState(promoA, "confirmed");
  const pBf = await gw.getPromoState(promoB, "confirmed");
  check(
    pAf?.outstanding === "0" && pBf?.outstanding === "0" && pAf.vaultBalance === "0",
    "every deposit paid out exactly once; vault = 0 = outstanding",
  );

  console.log("\n# subscriptions: verified, deduped, redelivered, replayable");
  await gw.sweepNow();
  await new Promise((r) => setTimeout(r, 800));
  await gw.sweepNow();
  check(deposits.length === 6, "deposit subscriber got all 6 verified deposits", deposits.length);
  check(
    new Set(deposits.map((d) => `${d.signature}:${d.eventIndex}`)).size === deposits.length,
    "no duplicate chainEventIds",
  );
  check(
    claims.length === 6 &&
      claims.filter((c) => c.kind === "YES_REFUND").length === 1 &&
      claims.filter((c) => c.kind === "MERCHANT_PAYOUT").length === 1,
    "claim subscriber got 6 claims (1 YES, 1 merchant, 4 cancel refunds)",
    claims.map((c) => c.kind),
  );
  check(
    resolutions.length === 2 &&
      resolutions.some((r) => r.outcome === "YES") &&
      resolutions.some((r) => r.outcome === "NO"),
    "resolution subscriber got YES and NO",
  );
  check(
    deposits.every((d) => d.commitment === "finalized" && typeof d.blockTime === "number"),
    "events carry commitment + blockTime",
  );
  // the flaky subscriber started at the head: it only saw new deposits (6 - 0 before?) -> it must have retried once
  check(
    flakyCalls >= 2 && new Set(flakySeen).size === flakySeen.length,
    "a throwing handler is redelivered (at-least-once) without duplicates after ack",
    { flakyCalls, n: flakySeen.length },
  );

  // re-signal the same txs (Streams/WS redelivery): nothing new
  const before = deposits.length;
  gw.ingestStreams(deposits.map((d) => ({ txHash: d.signature as Hex })));
  await gw.sweepNow();
  check(deposits.length === before, "duplicate Streams/WS signals deliver nothing new");

  // replay after a "restart": a NEW subscriber from slot 0 receives history again
  const replay: DepositEvent[] = [];
  const subRe = await gw.subscribeToDeposits(async (e) => void replay.push(e), { fromSlot: 0 });
  for (let i = 0; i < 30 && replay.length < 6; i++) {
    await gw.sweepNow();
    await new Promise((r) => setTimeout(r, 200));
  }
  check(
    replay.length === 6 &&
      replay.map((d) => `${d.signature}:${d.eventIndex}`).join() ===
        deposits.map((d) => `${d.signature}:${d.eventIndex}`).join(),
    "replay fromSlot: identical ids, same order",
  );

  console.log("\n# QuickNode Streams path: filter -> signed webhook -> verified events");
  const logs = await pub.getLogs({ address: escrow, fromBlock: 0n, toBlock: "latest" });
  // Shape as the `logs` dataset: one block entry holding one array per tx (verified shape on arc-testnet)
  const byTx = new Map<string, unknown[]>();
  for (const l of logs) {
    const arr = byTx.get(l.transactionHash!) ?? [];
    arr.push({
      address: l.address,
      topics: l.topics,
      data: l.data,
      transactionHash: l.transactionHash,
      blockNumber: `0x${l.blockNumber!.toString(16)}`,
      logIndex: `0x${l.logIndex!.toString(16)}`,
      removed: false,
    });
    byTx.set(l.transactionHash!, arr);
  }
  const decoy = {
    address: usdc,
    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
    data: "0x",
    transactionHash: `0x${"11".repeat(32)}`,
    blockNumber: "0x1",
    logIndex: "0x0",
  };
  const filtered = runArcStreamsFilterLocally(escrow, { data: [[...byTx.values(), [decoy]]] }) as {
    matchedTransactions: { txHash: string }[];
  };
  check(
    filtered.matchedTransactions.length === byTx.size &&
      !filtered.matchedTransactions.some((t) => t.txHash === decoy.transactionHash),
    "filter keeps every escrow tx and drops the decoy",
    filtered.matchedTransactions.length,
  );

  const secToken = "e2e-streams-token";
  const streamsGw = await createArcGatewayFromEnv(
    { ...env, ARC_EVENT_SOURCE: "streams", ARC_SWEEP_MS: "600000" },
    () => {},
  );
  const streamed: ClaimEvent[] = [];
  const subS = await streamsGw.subscribeToClaims(async (e) => void streamed.push(e)); // starts at head: only signals can deliver history
  const server = await startArcStreamsWebhookServer({
    port: 18546,
    securityToken: secToken,
    escrow,
    onSignals: (s) => streamsGw.ingestStreams(s),
  });
  const body = JSON.stringify(filtered);
  const post = async (sig: string) =>
    fetch("http://127.0.0.1:18546/webhooks/quicknode", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qn-nonce": "n",
        "x-qn-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-qn-signature": sig,
      },
      body,
    });
  const bad = await post("00".repeat(32));
  check(bad.status === 401, "webhook rejects a bad HMAC (401)");
  const good = await post(
    computeStreamsSignature(secToken, "n", String(Math.floor(Date.now() / 1000)), body),
  );
  check(good.status === 200, "webhook accepts a valid HMAC (200)");
  for (let i = 0; i < 20 && streamed.length < 6; i++) {
    await streamsGw.sweepNow();
    await new Promise((r) => setTimeout(r, 200));
  }
  check(
    streamed.length === 6 && streamed.every((c) => c.commitment === "finalized"),
    "Streams-mode gateway delivers the 6 verified ClaimEvents",
    streamed.length,
  );

  await v2Section({ gw, escrow, usdc, relayer: relayer.address, resolutions });

  for (const s of [subD, subC, subR, subF, subRe, subS]) await s.stop();
  await gw.stop();
  await stranger.stop();
  await streamsGw.stop();
  await new Promise<void>((r) => server.close(() => r()));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

/** v2 escrow: automatic payouts (YES / NO / cancel / VOID), VOID rules, one-signature checkout. */
async function v2Section(o: {
  gw: Awaited<ReturnType<typeof createArcGatewayFromEnv>>;
  escrow: Address;
  usdc: Address;
  relayer: Address;
  resolutions: ResolutionEvent[];
}) {
  const { gw, escrow, usdc } = o;
  const bal = async (a: Address) =>
    (await pub.readContract({
      address: usdc,
      abi: MOCK_USDC_ABI,
      functionName: "balanceOf",
      args: [a],
    })) as bigint;
  const state = async (k: Hex) => (await gw.getPurchaseState(k, "confirmed"))?.state;
  const w = createWalletClient({ chain, transport: http(RPC), account: admin });
  for (const c of [dave, frank]) {
    const h = await w.writeContract({
      address: usdc,
      abi: MOCK_USDC_ABI,
      functionName: "mint",
      args: [c.address, 10n * OFFER],
      account: admin,
      chain,
    });
    await pub.waitForTransactionReceipt({ hash: h }); // dave and frank never approve the escrow
  }
  check(await isEscrowV2(pub, escrow), "isEscrowV2 detects the v2 contract");

  console.log("\n# v2 promo C: one-signature checkout, auto cancel refund, VOID");
  const deadlineC = BigInt((await now()) + 60);
  await send(
    merchant,
    buildInitializePromoTx(escrow, {
      promoNonce: 3n,
      offerAmount: OFFER,
      depositDeadline: deadlineC,
      marketId: "gemini:GAME-POSTPONED",
    }),
  );
  const promoC = promoIdOf(merchant.address, 3n);

  // dave signs ONE typed message; the relayer submits and pays the gas
  const domain = await readTokenDomain(pub, usdc);
  const idD = newPurchaseIdHex();
  const td = receiveAuthorizationTypedData({
    domain,
    escrow,
    promoId: promoC,
    customer: dave.address,
    purchaseIdHex: idD,
    amount: OFFER,
    validBefore: deadlineC,
  });
  const signature = await dave.signTypedData(td);
  const auth = {
    promoId: promoC,
    purchaseIdHex: idD,
    customer: dave.address,
    amount: OFFER,
    validAfter: 0n,
    validBefore: deadlineC,
    signature,
  };
  const dave0 = await bal(dave.address);
  const relayerTok0 = await bal(o.relayer);
  await expectGatewayError(
    gw.submitAuthorizedDeposit({ ...auth, purchaseIdHex: newPurchaseIdHex() }),
    "TX_FAILED",
    "signature re-bound to another purchase id: rejected",
  );
  const sd = await gw.submitAuthorizedDeposit(auth);
  const dk = purchaseKeyOf(promoC, dave.address, idD);
  const du = await gw.getPurchaseState(dk, "confirmed");
  check(
    !sd.alreadyApplied &&
      sd.purchasePda === dk &&
      du?.state === "Deposited" &&
      du.customer.toLowerCase() === dave.address.toLowerCase(),
    "depositWithAuthorization: relayer submits, purchase belongs to the signer",
    du,
  );
  check(
    dave0 - (await bal(dave.address)) === OFFER && (await bal(o.relayer)) === relayerTok0,
    "exactly the offer left the customer; the relayer paid only gas",
  );
  const sd2 = await gw.submitAuthorizedDeposit(auth);
  check(
    sd2.alreadyApplied && sd2.signature === sd.signature,
    "resubmitting the same signature: alreadyApplied",
  );
  const vd = await gw.verifyTransaction(sd.signature!);
  const vev = vd.events[0];
  check(
    vd.confirmed &&
      vev?.name === "DepositEvent" &&
      vev.customer.toLowerCase() === dave.address.toLowerCase(),
    "verifyTransaction(signed deposit): DepositEvent for the signer",
  );

  const ids = [newPurchaseIdHex(), newPurchaseIdHex(), newPurchaseIdHex(), newPurchaseIdHex()];
  for (const [who, id] of [
    [alice, ids[0]],
    [bob, ids[1]],
    [carol, ids[2]],
    [alice, ids[3]],
  ] as const)
    await send(who, buildDepositTx(escrow, { promoId: promoC, purchaseIdHex: id!, amount: OFFER }));
  const [c1, c2, c3, c4] = [
    purchaseKeyOf(promoC, alice.address, ids[0]!),
    purchaseKeyOf(promoC, bob.address, ids[1]!),
    purchaseKeyOf(promoC, carol.address, ids[2]!),
    purchaseKeyOf(promoC, alice.address, ids[3]!),
  ];
  for (const k of [c1, c2, dk]) await gw.markHedged(k);
  await gw.cancelUnhedged(c3); // c4 stays Deposited (never hedged)

  const carol0 = await bal(carol.address);
  const sc = await gw.settlePurchase(c3);
  check(
    !sc.alreadyApplied &&
      (await state(c3)) === "Refunded" &&
      (await bal(carol.address)) - carol0 === OFFER,
    "auto refund of a cancelled purchase, no customer tap (promo still Active)",
  );
  check((await gw.settlePurchase(c3)).alreadyApplied, "settlePurchase repeat: alreadyApplied");
  await expectGatewayError(
    gw.settlePurchase(c1),
    "INVALID_STATE",
    "settlePurchase on a Hedged purchase before resolution: INVALID_STATE",
    (e) => (e as GatewayInvalidStateError).observedState === "Hedged",
  );
  const preview = await gw.previewSettlement(c1, "confirmed");
  check(preview.status === "NotDue", "previewSettlement: NotDue while Active", preview);

  await advance(61);
  const rv = await gw.resolvePromotion(promoC, "VOID");
  const pc = await gw.getArcPromoState(promoC, "confirmed");
  check(!rv.alreadyApplied && pc?.state === "ResolvedVoid", "resolvePromotion VOID", pc?.state);
  check(
    (await gw.resolvePromotion(promoC, "VOID")).alreadyApplied,
    "resolve VOID again: alreadyApplied",
  );
  await expectGatewayError(
    gw.resolvePromotion(promoC, "NO"),
    "INVALID_STATE",
    "NO after VOID: INVALID_STATE (no outcome switch)",
  );
  const p1 = await gw.previewSettlement(c1, "confirmed");
  check(
    p1.status === "Payable" &&
      p1.recipient.toLowerCase() === merchant.address.toLowerCase() &&
      p1.kind === "MERCHANT_PAYOUT",
    "preview after VOID: hedged purchase pays the shop",
    p1,
  );

  const m0 = await bal(merchant.address);
  const a0 = await bal(alice.address);
  const b0 = await bal(bob.address);
  const sp = await gw.settlePromotion(promoC);
  check(
    sp.settled.length === 4 &&
      sp.skipped.length === 1 &&
      sp.skipped[0]?.status === "AlreadySettled" &&
      sp.receipts.length === 1,
    "settlePromotion: 4 paid in ONE tx, the refunded one skipped",
    sp,
  );
  check(
    (await bal(merchant.address)) - m0 === 3n * OFFER &&
      (await bal(alice.address)) - a0 === OFFER &&
      (await bal(bob.address)) === b0,
    "VOID: shop keeps the 3 hedged sales; the never-hedged purchase is refunded",
  );
  check(
    (await state(c1)) === "ClaimedByMerchant" &&
      (await state(dk)) === "ClaimedByMerchant" &&
      (await state(c4)) === "Refunded",
    "VOID terminal states",
  );
  const sp2 = await gw.settlePromotion(promoC);
  check(
    sp2.settled.length === 0 && sp2.receipts.length === 0,
    "settlePromotion again: nothing to pay, no tx",
  );
  try {
    await pub.simulateContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "claimMerchant",
      args: [c1],
      account: merchant,
    });
    check(false, "self-claim after auto payout must fail");
  } catch (e) {
    check(escrowErrorName(e) === "AlreadyClaimed", "self-claim after auto payout: AlreadyClaimed");
  }

  console.log("\n# v2 promo D (YES) and E (NO): auto payouts; permit checkout");
  const deadlineD = BigInt((await now()) + 30);
  for (const n of [4n, 5n])
    await send(
      merchant,
      buildInitializePromoTx(escrow, {
        promoNonce: n,
        offerAmount: OFFER,
        depositDeadline: deadlineD,
        marketId: `gemini:AUTO-${n}`,
      }),
    );
  const [promoD, promoE] = [promoIdOf(merchant.address, 4n), promoIdOf(merchant.address, 5n)];
  const idF = newPurchaseIdHex();
  const ptd = permitTypedData({
    domain,
    owner: frank.address,
    escrow,
    amount: OFFER,
    nonce: await readPermitNonce(pub, usdc, frank.address),
    deadline: deadlineD,
  });
  await send(
    frank,
    buildDepositWithPermitTx(escrow, {
      promoId: promoD,
      purchaseIdHex: idF,
      amount: OFFER,
      deadline: deadlineD,
      signature: await frank.signTypedData(ptd),
    }),
  );
  const fk = purchaseKeyOf(promoD, frank.address, idF);
  check((await state(fk)) === "Deposited", "depositWithPermit: no approve tx needed");
  const idE = newPurchaseIdHex();
  await send(bob, buildDepositTx(escrow, { promoId: promoE, purchaseIdHex: idE, amount: OFFER }));
  const ek = purchaseKeyOf(promoE, bob.address, idE);
  await gw.markHedged(fk);
  await gw.markHedged(ek);
  await advance(31);
  await gw.resolvePromotion(promoD, "YES");
  await gw.resolvePromotion(promoE, "NO");
  const f0 = await bal(frank.address);
  const m1 = await bal(merchant.address);
  const sb = await gw.settlePurchases([fk, ek, fk]);
  check(
    sb.settled.length === 2 && sb.receipts.length === 1,
    "settlePurchases across two promos in one tx (duplicate key ignored)",
    sb,
  );
  check(
    (await bal(frank.address)) - f0 === OFFER && (await bal(merchant.address)) - m1 === OFFER,
    "YES pays the customer, NO pays the shop, automatically",
  );
  const vb = await gw.verifyTransaction(sb.receipts[0]!.signature!);
  const kinds = vb.events.filter((e) => e.name === "ClaimEvent").map((e) => e.kind);
  check(
    kinds.includes("YES_REFUND") && kinds.includes("MERCHANT_PAYOUT"),
    "the batch tx verifies with both ClaimEvents",
    kinds,
  );

  console.log("\n# v2 subscriptions and conservation");
  const all: ArcResolutionEvent[] = [];
  const subAll = await gw.subscribeToArcResolutions(async (e) => void all.push(e), {
    fromSlot: 0,
  });
  for (let i = 0; i < 30 && all.length < 5; i++) {
    await gw.sweepNow();
    await new Promise((r) => setTimeout(r, 200));
  }
  check(
    all.length === 5 && all.filter((e) => e.outcome === "VOID").length === 1,
    "subscribeToArcResolutions delivers VOID",
    all.map((e) => e.outcome),
  );
  check(
    !o.resolutions.some((e) => (e.outcome as string) === "VOID"),
    "the shared YES/NO subscription never receives VOID",
  );
  await subAll.stop();
  const outstanding = await Promise.all(
    [promoC, promoD, promoE].map(
      async (p) => (await gw.getPromoState(p, "confirmed"))?.outstanding,
    ),
  );
  check(
    outstanding.every((x) => x === "0") && (await bal(escrow)) === 0n,
    "every v2 deposit paid exactly once; vault = 0",
    outstanding,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export type { ArcGateway };
