import {
  encodeFunctionData,
  erc20Abi,
  maxUint256,
  parseSignature,
  type Address,
  type Hex,
} from "viem";
import { HEDGED_ESCROW_ABI } from "./abi";
import { toBytes16 } from "./ids";

/**
 * Browser-safe UNSIGNED transaction builders for wallet signing (Dev 1). Each returns a plain
 * `{ to, data, value }` request: pass it to wagmi `sendTransaction` / viem `walletClient.sendTransaction`.
 * Nothing here holds a key. Amounts are 6-decimal base units (5 USDC = 5_000_000n).
 */
export interface UnsignedTx {
  to: Address;
  data: Hex;
  value: 0n;
  /** What the wallet will be asked to approve, for UI copy. */
  description: string;
}

const tx = (to: Address, data: Hex, description: string): UnsignedTx => ({
  to,
  data,
  value: 0n,
  description,
});

/** Merchant: `initialize_promo`. Deadline = unix seconds, must be in the future and <= event end. */
export function buildInitializePromoTx(
  escrow: Address,
  a: { promoNonce: bigint; offerAmount: bigint; depositDeadline: bigint; marketId: string },
): UnsignedTx {
  return tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "initializePromo",
      args: [a.promoNonce, a.offerAmount, a.depositDeadline, a.marketId],
    }),
    `Create promo #${a.promoNonce}`,
  );
}

/** Customer step 1 of a deposit: allow the escrow to pull USDC (ERC-20 `approve`). */
export function buildApproveTx(
  token: Address,
  escrow: Address,
  amount: bigint | "max",
): UnsignedTx {
  return tx(
    token,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [escrow, amount === "max" ? maxUint256 : amount],
    }),
    "Allow the escrow to take the payment",
  );
}

/** Customer step 2: `deposit` exactly the promo's offer amount. */
export function buildDepositTx(
  escrow: Address,
  a: { promoId: Hex; purchaseIdHex: string; amount: bigint },
): UnsignedTx {
  return tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "deposit",
      args: [a.promoId, toBytes16(a.purchaseIdHex), a.amount],
    }),
    "Pay into escrow",
  );
}

/** Both deposit transactions in order (approve exactly the amount, then deposit). */
export function buildDepositFlow(
  token: Address,
  escrow: Address,
  a: { promoId: Hex; purchaseIdHex: string; amount: bigint },
): [UnsignedTx, UnsignedTx] {
  return [buildApproveTx(token, escrow, a.amount), buildDepositTx(escrow, a)];
}

export const buildClaimRefundTx = (escrow: Address, purchaseKey: Hex): UnsignedTx =>
  tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "claimRefund",
      args: [purchaseKey],
    }),
    "Claim refund",
  );

export const buildClaimMerchantTx = (escrow: Address, purchaseKey: Hex): UnsignedTx =>
  tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "claimMerchant",
      args: [purchaseKey],
    }),
    "Collect payment",
  );

export const buildCancelExpiredDepositTx = (escrow: Address, purchaseKey: Hex): UnsignedTx =>
  tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "cancelExpiredDeposit",
      args: [purchaseKey],
    }),
    "Cancel my unconfirmed purchase",
  );

// ------------------------------------------------------------------ v2: automatic settlement

/** Contract cap for one batch (`MAX_SETTLE_BATCH`). */
export const MAX_SETTLE_BATCH = 50;

/**
 * Push one purchase's payout to whoever it belongs to (customer: cancelled, never hedged after
 * resolution, or hedged on YES; merchant: hedged on NO or VOID). Anyone may send it: the
 * contract fixes the recipient and amount. Normally the backend relayer does.
 */
export const buildSettlePurchaseTx = (escrow: Address, purchaseKey: Hex): UnsignedTx =>
  tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "settlePurchase",
      args: [purchaseKey],
    }),
    "Pay out this purchase",
  );

/** Batch (at most 50): skips anything already settled / not due instead of reverting. */
export function buildSettlePurchasesTx(escrow: Address, purchaseKeys: readonly Hex[]): UnsignedTx {
  if (purchaseKeys.length > MAX_SETTLE_BATCH)
    throw new Error(`at most ${MAX_SETTLE_BATCH} purchases per batch, got ${purchaseKeys.length}`);
  return tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "settlePurchases",
      args: [purchaseKeys],
    }),
    `Pay out ${purchaseKeys.length} purchases`,
  );
}

/** A page of a promo's purchases in deposit order (limit capped at 50 on-chain). */
export const buildSettlePromoTx = (
  escrow: Address,
  promoId: Hex,
  offset = 0n,
  limit = BigInt(MAX_SETTLE_BATCH),
): UnsignedTx =>
  tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "settlePromo",
      args: [promoId, offset, limit],
    }),
    "Pay out this promo",
  );

// ------------------------------------------------------------------ v2: one-signature checkout

/**
 * `depositWithAuthorization`: the customer's EIP-3009 signature (see `receiveAuthorizationTypedData`)
 * turned into a transaction. ANYONE can send it (normally the backend relayer, which pays the
 * gas); the purchase belongs to `customer`, the signer.
 */
export function buildDepositWithAuthorizationTx(
  escrow: Address,
  a: {
    promoId: Hex;
    purchaseIdHex: string;
    customer: Address;
    amount: bigint;
    validAfter: bigint;
    validBefore: bigint;
    signature: Hex;
  },
): UnsignedTx {
  const { v, r, s } = splitSignature(a.signature);
  return tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "depositWithAuthorization",
      args: [
        a.promoId,
        toBytes16(a.purchaseIdHex),
        a.customer,
        a.amount,
        a.validAfter,
        a.validBefore,
        v,
        r,
        s,
      ],
    }),
    "Pay into escrow (signed authorization)",
  );
}

/** `depositWithPermit`: the customer sends this themselves with an EIP-2612 permit signature. */
export function buildDepositWithPermitTx(
  escrow: Address,
  a: { promoId: Hex; purchaseIdHex: string; amount: bigint; deadline: bigint; signature: Hex },
): UnsignedTx {
  const { v, r, s } = splitSignature(a.signature);
  return tx(
    escrow,
    encodeFunctionData({
      abi: HEDGED_ESCROW_ABI,
      functionName: "depositWithPermit",
      args: [a.promoId, toBytes16(a.purchaseIdHex), a.amount, a.deadline, v, r, s],
    }),
    "Pay into escrow (permit)",
  );
}

/** 65-byte `r || s || v` (or 64-byte EIP-2098) signature -> `{ v, r, s }` for the contract. */
export function splitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const sig = parseSignature(signature);
  const v = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
  return { v: v < 27 ? v + 27 : v, r: sig.r, s: sig.s };
}
