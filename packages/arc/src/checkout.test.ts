import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  hashDomain,
  hashTypedData,
  recoverTypedDataAddress,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HEDGED_ESCROW_ABI } from "./abi";
import {
  ARC_TESTNET_USDC_DOMAIN,
  ARC_TESTNET_USDC_DOMAIN_SEPARATOR,
  permitTypedData,
  receiveAuthorizationTypedData,
  toCircleTypedDataJson,
} from "./checkout";
import { decodeEscrowLogs } from "./codec";
import { escrowErrorCode } from "./errors";
import { promoIdOf, purchaseKeyOf } from "./ids";
import {
  buildDepositWithAuthorizationTx,
  buildSettlePurchasesTx,
  MAX_SETTLE_BATCH,
  splitSignature,
} from "./transactions";

const ESCROW = getAddress("0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a");
const M = getAddress("0x00000000000000000000000000000000000000aa");

test("the Arc testnet USDC domain hashes to the DOMAIN_SEPARATOR read on chain", () => {
  assert.equal(
    hashDomain({
      domain: { ...ARC_TESTNET_USDC_DOMAIN, chainId: BigInt(ARC_TESTNET_USDC_DOMAIN.chainId) },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    }),
    ARC_TESTNET_USDC_DOMAIN_SEPARATOR,
  );
});

test("ReceiveWithAuthorization: nonce is the purchase key, signer recovers, Circle JSON matches", async () => {
  const customer = privateKeyToAccount(generatePrivateKey());
  const promoId = promoIdOf(M, 7n);
  const purchaseIdHex = "0123456789abcdef0123456789abcdef";
  const td = receiveAuthorizationTypedData({
    domain: ARC_TESTNET_USDC_DOMAIN,
    escrow: ESCROW,
    promoId,
    customer: customer.address,
    purchaseIdHex,
    amount: 5_000_000n,
    validBefore: 1_900_000_000n,
  });
  assert.equal(td.message.nonce, purchaseKeyOf(promoId, customer.address, purchaseIdHex));
  assert.equal(td.message.to, ESCROW);
  assert.equal(td.message.validAfter, 0n);
  const sig = await customer.signTypedData(td);
  assert.equal(await recoverTypedDataAddress({ ...td, signature: sig }), customer.address);

  // What Circle's sign/typedData endpoint receives as `data`
  const json = JSON.parse(toCircleTypedDataJson(td)) as {
    types: Record<string, { name: string; type: string }[]>;
    domain: typeof ARC_TESTNET_USDC_DOMAIN;
    primaryType: string;
    message: Record<string, string>;
  };
  assert.deepEqual(
    json.types.EIP712Domain?.map((f) => f.name),
    ["name", "version", "chainId", "verifyingContract"],
  );
  assert.equal(json.primaryType, "ReceiveWithAuthorization");
  assert.equal(json.domain.chainId, 5042002);
  assert.equal(json.message.value, "5000000");
  const { EIP712Domain: _d, ...types } = json.types;
  const rehashed = hashTypedData({
    domain: json.domain,
    types,
    primaryType: "ReceiveWithAuthorization",
    message: {
      ...json.message,
      value: BigInt(json.message.value!),
      validAfter: BigInt(json.message.validAfter!),
      validBefore: BigInt(json.message.validBefore!),
    },
  } as Parameters<typeof hashTypedData>[0]);
  assert.equal(rehashed, hashTypedData(td), "the JSON describes the same digest");

  // The signature becomes the relayer's transaction with the customer as `customer`
  const t = buildDepositWithAuthorizationTx(ESCROW, {
    promoId,
    purchaseIdHex,
    customer: customer.address,
    amount: 5_000_000n,
    validAfter: 0n,
    validBefore: 1_900_000_000n,
    signature: sig,
  });
  const d = decodeFunctionData({ abi: HEDGED_ESCROW_ABI, data: t.data });
  assert.equal(d.functionName, "depositWithAuthorization");
  const args = d.args as readonly unknown[];
  assert.equal(args[2], customer.address);
  assert.ok(args[6] === 27 || args[6] === 28);
});

test("permit typed data and signature splitting", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const td = permitTypedData({
    domain: ARC_TESTNET_USDC_DOMAIN,
    owner: owner.address,
    escrow: ESCROW,
    amount: 5_000_000n,
    nonce: 0n,
    deadline: 1_900_000_000n,
  });
  const sig = await owner.signTypedData(td);
  const { v, r, s } = splitSignature(sig);
  assert.ok(v === 27 || v === 28);
  assert.equal(r.length, 66);
  assert.equal(s.length, 66);
  assert.equal(td.message.spender, ESCROW);
});

test("settle batch builder enforces the on-chain cap", () => {
  const k = `0x${"ab".repeat(32)}` as Hex;
  assert.throws(() => buildSettlePurchasesTx(ESCROW, Array(MAX_SETTLE_BATCH + 1).fill(k)));
  const t = buildSettlePurchasesTx(ESCROW, [k, k]);
  assert.equal(
    decodeFunctionData({ abi: HEDGED_ESCROW_ABI, data: t.data }).functionName,
    "settlePurchases",
  );
});

test("a VOID ResolutionEvent decodes as VOID, never as NO; unknown outcomes throw", () => {
  const promo = promoIdOf(M, 1n);
  const log = (outcome: number) => ({
    address: ESCROW,
    topics: encodeEventTopics({
      abi: HEDGED_ESCROW_ABI,
      eventName: "ResolutionEvent",
      args: { promo },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint8" }, { type: "address" }, { type: "uint64" }],
      [outcome, M, 123n],
    ),
    logIndex: 0,
  });
  const [ev] = decodeEscrowLogs([log(2)], ESCROW);
  assert.equal(ev?.name === "ResolutionEvent" && ev.outcome, "VOID");
  const [no] = decodeEscrowLogs([log(1)], ESCROW);
  assert.equal(no?.name === "ResolutionEvent" && no.outcome, "NO");
  assert.throws(() => decodeEscrowLogs([log(3)], ESCROW), /unknown escrow event value/);
});

test("v2 errors are appended after the v1 codes", () => {
  assert.equal(escrowErrorCode("TokenTransferFailed"), 6027);
  assert.equal(escrowErrorCode("BatchTooLarge"), 6028);
  assert.equal(escrowErrorCode("PermitFailed"), 6029);
});
