import type {
  ClaimKind,
  Commitment,
  OnChainConfig,
  OnChainPromoAccount,
  OnChainPromoState,
  OnChainPurchaseAccount,
  OnChainPurchaseState,
} from "@hedged/shared";
import { erc20Abi, type Address, type BlockTag, type Hex, type PublicClient } from "viem";
import { HEDGED_ESCROW_ABI } from "./abi";
import { fromBytes16 } from "./ids";

/**
 * Arc promo states: the shared three plus v2's `ResolvedVoid` (event cancelled / market voided).
 * `@hedged/shared`'s `OnChainPromoState` does not list "ResolvedVoid" yet (README: "Shared/backend
 * changes needed"), so Arc reads use this wider type.
 */
export type ArcPromoState = OnChainPromoState | "ResolvedVoid";
export const PROMO_STATES: readonly ArcPromoState[] = [
  "Active",
  "ResolvedYes",
  "ResolvedNo",
  "ResolvedVoid",
];
export const PURCHASE_STATES: readonly OnChainPurchaseState[] = [
  "Deposited",
  "Hedged",
  "Cancelled",
  "Refunded",
  "ClaimedByCustomer",
  "ClaimedByMerchant",
];

/** "finalized" -> the `finalized` block tag; "confirmed" -> `latest` (Arc finality is sub-second). */
export const blockTagFor = (c: Commitment | undefined): BlockTag =>
  c === "confirmed" ? "latest" : "finalized";

/** Arc promo: the Solana shape plus the per-promo cancel-timeout snapshot; state may be ResolvedVoid. */
export type ArcPromoAccount = Omit<OnChainPromoAccount, "state"> & {
  state: ArcPromoState;
  cancelTimeoutSecs: number;
};
export type ArcConfig = OnChainConfig & { cancelTimeoutSecs: number };

export async function getConfig(
  client: PublicClient,
  escrow: Address,
  commitment?: Commitment,
): Promise<ArcConfig | null> {
  const blockTag = blockTagFor(commitment);
  const code = await client.getCode({ address: escrow, blockTag });
  if (!code || code === "0x") return null;
  const rd = <T>(functionName: "admin" | "relayer" | "token" | "paused" | "cancelTimeoutSecs") =>
    client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName,
      blockTag,
    }) as Promise<T>;
  const [admin, relayer, token, paused, timeout] = await Promise.all([
    rd<Address>("admin"),
    rd<Address>("relayer"),
    rd<Address>("token"),
    rd<boolean>("paused"),
    rd<bigint>("cancelTimeoutSecs"),
  ]);
  return { admin, relayer, mint: token, paused, cancelTimeoutSecs: Number(timeout) };
}

export async function getPromoState(
  client: PublicClient,
  escrow: Address,
  promoId: Hex,
  commitment?: Commitment,
): Promise<ArcPromoAccount | null> {
  const blockTag = blockTagFor(commitment);
  const [p, token] = await Promise.all([
    client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "getPromo",
      args: [promoId],
      blockTag,
    }),
    client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "token",
      blockTag,
    }),
  ]);
  if (!p.exists) return null;
  const vaultBalance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [escrow],
    blockTag,
  });
  return {
    promoPda: promoId,
    merchant: p.merchant,
    mint: token,
    // One contract holds every promo's funds (per-promo accounting below); see README "Vault model".
    vault: escrow,
    promoNonce: p.promoNonce.toString(),
    offerAmount: p.offerAmount.toString(),
    depositDeadline: Number(p.depositDeadline),
    marketId: p.marketId,
    state: promoStateAt(p.state),
    resolvedAt: Number(p.resolvedAt),
    totalDeposited: p.totalDeposited.toString(),
    totalPaidOut: p.totalPaidOut.toString(),
    purchaseCount: p.purchaseCount.toString(),
    outstanding: (p.totalDeposited - p.totalPaidOut).toString(),
    // Contract-wide token balance (pooled across promos): always >= the sum of all outstanding.
    vaultBalance: vaultBalance.toString(),
    cancelTimeoutSecs: Number(p.cancelTimeoutSecs),
  };
}

function promoStateAt(i: number): ArcPromoState {
  const st = PROMO_STATES[i];
  // Never default an unknown state to "Active": that would invite a second resolution attempt.
  if (!st) throw new Error(`unknown on-chain promo state ${i} (ABI out of date?)`);
  return st;
}

function purchaseStateAt(i: number): OnChainPurchaseState {
  const st = PURCHASE_STATES[i];
  if (!st) throw new Error(`unknown on-chain purchase state ${i} (ABI out of date?)`);
  return st;
}

type RawPurchase = {
  promo: Hex;
  customer: Address;
  purchaseId: Hex;
  amount: bigint;
  state: number;
  depositedAt: bigint;
  hedgedAt: bigint;
  cancelledAt: bigint;
  settledAt: bigint;
  exists: boolean;
};

export function mapPurchase(purchaseKey: Hex, u: RawPurchase): OnChainPurchaseAccount {
  return {
    purchasePda: purchaseKey,
    promoPda: u.promo,
    customer: u.customer,
    purchaseId: fromBytes16(u.purchaseId),
    amount: u.amount.toString(),
    state: purchaseStateAt(u.state),
    depositedAt: Number(u.depositedAt),
    hedgedAt: Number(u.hedgedAt),
    cancelledAt: Number(u.cancelledAt),
    settledAt: Number(u.settledAt),
  };
}

export async function getPurchaseState(
  client: PublicClient,
  escrow: Address,
  purchaseKey: Hex,
  commitment?: Commitment,
): Promise<OnChainPurchaseAccount | null> {
  const u = (await client.readContract({
    address: escrow,
    abi: HEDGED_ESCROW_ABI,
    functionName: "getPurchase",
    args: [purchaseKey],
    blockTag: blockTagFor(commitment),
  })) as RawPurchase;
  return u.exists ? mapPurchase(purchaseKey, u) : null;
}

/** Every purchase of a promotion (reconciliation scan), in deposit order. */
export async function listPurchases(
  client: PublicClient,
  escrow: Address,
  promoId: Hex,
  commitment?: Commitment,
): Promise<OnChainPurchaseAccount[]> {
  const blockTag = blockTagFor(commitment);
  const n = await client.readContract({
    address: escrow,
    abi: HEDGED_ESCROW_ABI,
    functionName: "purchaseCountOf",
    args: [promoId],
    blockTag,
  });
  const out: OnChainPurchaseAccount[] = [];
  const PAGE = 200n;
  for (let off = 0n; off < n; off += PAGE) {
    const keys = await client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "purchaseKeysOf",
      args: [promoId, off, PAGE],
      blockTag,
    });
    const rows = await Promise.all(
      keys.map((k) =>
        client.readContract({
          address: escrow,
          abi: HEDGED_ESCROW_ABI,
          functionName: "getPurchase",
          args: [k],
          blockTag,
        }),
      ),
    );
    rows.forEach((u, i) => {
      const k = keys[i];
      if (k && (u as RawPurchase).exists) out.push(mapPurchase(k, u as RawPurchase));
    });
  }
  return out;
}

/** v2 `previewSettlement` statuses, in contract order. */
export const SETTLE_STATUSES = [
  "Payable",
  "NotFound",
  "AlreadySettled",
  "NotDue",
  "Paused",
] as const;
export type SettleStatus = (typeof SETTLE_STATUSES)[number];

export interface SettlementPreview {
  purchasePda: Hex;
  status: SettleStatus;
  /** Who an automatic settlement pays (meaningful when Payable or Paused). */
  recipient: Address;
  amount: string;
  kind: ClaimKind;
}

/** What `settlePurchase` would do for this purchase right now (v2 contracts only). */
export async function previewSettlement(
  client: PublicClient,
  escrow: Address,
  purchaseKey: Hex,
  commitment?: Commitment,
): Promise<SettlementPreview> {
  const [status, recipient, amount, kind] = await client.readContract({
    address: escrow,
    abi: HEDGED_ESCROW_ABI,
    functionName: "previewSettlement",
    args: [purchaseKey],
    blockTag: blockTagFor(commitment),
  });
  return {
    purchasePda: purchaseKey,
    status: SETTLE_STATUSES[status] ?? "NotFound",
    recipient,
    amount: amount.toString(),
    kind: CLAIM_KIND_NAMES[kind] ?? "CANCEL_REFUND",
  };
}

/** Contract `ClaimKind` order (unchanged in v2: a VOID merchant payout is MERCHANT_PAYOUT). */
export const CLAIM_KIND_NAMES: readonly ClaimKind[] = [
  "CANCEL_REFUND",
  "YES_REFUND",
  "MERCHANT_PAYOUT",
];

/** True when the escrow at `escrow` is v2 (auto settlement, VOID, one-signature checkout). */
export async function isEscrowV2(client: PublicClient, escrow: Address): Promise<boolean> {
  try {
    await client.readContract({
      address: escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: "MAX_SETTLE_BATCH",
    });
    return true;
  } catch {
    return false;
  }
}
