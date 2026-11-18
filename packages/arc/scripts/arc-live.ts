/**
 * LIVE Arc testnet run of every relayer move against the deployed HedgedEscrow.
 * A fresh merchant + customer are funded from the deployer with small amounts of testnet USDC.
 *
 *   ARC_ESCROW_ADDRESS=0x... ARC_RELAYER_KEY_PATH=~/.config/arc/ubc-relayer.json \
 *   ARC_FUNDER_KEY_PATH=~/.config/arc/ubc-deployer.json pnpm --filter @hedged/arc exec tsx scripts/arc-live.ts
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ARC_TESTNET, ARC_TESTNET_RPC } from "../src/config";
import { newPurchaseIdHex, promoIdOf, purchaseKeyOf } from "../src/ids";
import {
  buildApproveTx,
  buildClaimMerchantTx,
  buildClaimRefundTx,
  buildDepositTx,
  buildInitializePromoTx,
  type UnsignedTx,
} from "../src/transactions";
import { createArcGatewayFromEnv, ResolutionTooEarlyError } from "../src/server";
import { loadArcAccount } from "../src/server/keys";

const USDC = "0x3600000000000000000000000000000000000000" as const;
const OFFER = 1_000_000n; // 1 USDC
const pub = createPublicClient({ chain: ARC_TESTNET, transport: http(ARC_TESTNET_RPC) });
let pass = 0;
let fail = 0;
const check = (cond: unknown, name: string, detail?: unknown) => {
  if (cond) pass++;
  else fail++;
  console.log(
    `  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`}`,
  );
};
async function send(who: PrivateKeyAccount, t: UnsignedTx): Promise<Hash> {
  const w = createWalletClient({
    chain: ARC_TESTNET,
    transport: http(ARC_TESTNET_RPC),
    account: who,
  });
  const hash = await w.sendTransaction({
    to: t.to,
    data: t.data,
    value: 0n,
    account: who,
    chain: ARC_TESTNET,
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${t.description} reverted`);
  return hash;
}
const now = async () => Number((await pub.getBlock()).timestamp);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usdcOf = (a: Hex) =>
  pub.readContract({
    address: USDC,
    abi: [
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [a],
  });

const escrow = process.env.ARC_ESCROW_ADDRESS as Hex;
const funder = loadArcAccount(process.env.ARC_FUNDER_KEY_PATH ?? "", { label: "funder key" });
const gw = await createArcGatewayFromEnv({ ...process.env, ARC_FINALITY: "confirmed" });
const cfg = await gw.getConfig();
console.log("escrow", escrow, "relayer", cfg?.relayer);

const merchant = privateKeyToAccount(generatePrivateKey());
const customer = privateKeyToAccount(generatePrivateKey());
console.log("\n[setup] fund a fresh merchant + customer from the deployer");
const fw = createWalletClient({
  chain: ARC_TESTNET,
  transport: http(ARC_TESTNET_RPC),
  account: funder,
});
for (const [to, amt] of [
  [merchant.address, "0.5"],
  [customer.address, "3.5"],
] as const) {
  const h = await fw.sendTransaction({
    to,
    value: parseEther(amt),
    account: funder,
    chain: ARC_TESTNET,
  });
  await pub.waitForTransactionReceipt({ hash: h });
}
check(
  (await usdcOf(customer.address)) >= 3_000_000n,
  "customer holds >= 3 USDC (native gas = ERC-20 balance)",
);

console.log("\n[promo A] YES: hedge one, relayer-cancel one, refunds");
const deadlineA = BigInt((await now()) + 40);
await send(
  merchant,
  buildInitializePromoTx(escrow, {
    promoNonce: 1n,
    offerAmount: OFFER,
    depositDeadline: deadlineA,
    marketId: "LIVE-ARC-YES",
  }),
);
const promoA = promoIdOf(merchant.address, 1n);
check(
  (await gw.getPromoState(promoA, "confirmed"))?.state === "Active",
  "initializePromo live: Active",
);
await send(customer, buildApproveTx(USDC, escrow, 3n * OFFER));
const idA1 = newPurchaseIdHex();
const idA2 = newPurchaseIdHex();
const depSig = await send(
  customer,
  buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idA1, amount: OFFER }),
);
await send(
  customer,
  buildDepositTx(escrow, { promoId: promoA, purchaseIdHex: idA2, amount: OFFER }),
);
const a1 = purchaseKeyOf(promoA, customer.address, idA1);
const a2 = purchaseKeyOf(promoA, customer.address, idA2);
const v = await gw.verifyTransaction(depSig);
check(
  v.confirmed && v.events.some((e) => e.name === "DepositEvent"),
  "verifyTransaction: deposit + DepositEvent",
  v,
);

const h1 = await gw.markHedged(a1);
check(!h1.alreadyApplied && !!h1.signature, "markHedged (relayer) live", h1);
check((await gw.markHedged(a1)).alreadyApplied, "markHedged repeat → alreadyApplied");
const c2 = await gw.cancelUnhedged(a2);
check(!c2.alreadyApplied && !!c2.signature, "cancelUnhedged (relayer) live", c2);
await send(customer, buildClaimRefundTx(escrow, a2));
check(
  (await gw.getPurchaseState(a2, "confirmed"))?.state === "Refunded",
  "customer refunded after cancel",
);
try {
  await gw.resolvePromotion(promoA, "YES");
  check(false, "resolve before deadline → ResolutionTooEarly", "did not throw");
} catch (e) {
  check(
    e instanceof ResolutionTooEarlyError,
    "resolve before deadline → ResolutionTooEarly",
    String(e),
  );
}

console.log("\n[promo B] NO: hedged purchase, merchant collects");
const deadlineB = BigInt((await now()) + 30);
await send(
  merchant,
  buildInitializePromoTx(escrow, {
    promoNonce: 2n,
    offerAmount: OFFER,
    depositDeadline: deadlineB,
    marketId: "LIVE-ARC-NO",
  }),
);
const promoB = promoIdOf(merchant.address, 2n);
const idB = newPurchaseIdHex();
await send(
  customer,
  buildDepositTx(escrow, { promoId: promoB, purchaseIdHex: idB, amount: OFFER }),
);
const b1 = purchaseKeyOf(promoB, customer.address, idB);
await gw.markHedged(b1);

console.log("\n[resolve] waiting for both deadlines on Arc's clock");
while ((await now()) < Number(deadlineA > deadlineB ? deadlineA : deadlineB) + 1) await sleep(1500);
const rA = await gw.resolvePromotion(promoA, "YES");
check(!rA.alreadyApplied && !!rA.signature, "resolvePromotion YES (relayer) live", rA);
check(
  (await gw.resolvePromotion(promoA, "YES")).alreadyApplied,
  "resolve YES repeat → alreadyApplied",
);
const rB = await gw.resolvePromotion(promoB, "NO");
check(!rB.alreadyApplied && !!rB.signature, "resolvePromotion NO (relayer) live", rB);

const before = await usdcOf(customer.address);
await send(customer, buildClaimRefundTx(escrow, a1));
const after = await usdcOf(customer.address);
check(after - before > 900_000n, "YES: customer claims the refund (+1 USDC minus gas)", {
  before,
  after,
});
await send(merchant, buildClaimMerchantTx(escrow, b1));
check(
  (await gw.getPurchaseState(b1, "confirmed"))?.state === "ClaimedByMerchant",
  "NO: merchant collects",
);

console.log(`\npromo A ${promoA}\npromo B ${promoB}\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
