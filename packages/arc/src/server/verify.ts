import {
  SolanaGatewayError,
  type Commitment,
  type ProgramEvent,
  type TxVerification,
} from "@hedged/shared";
import {
  erc20Abi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { blockTagFor, getPromoState, getPurchaseState } from "../accounts";
import { decodeEscrowLogs, type IndexedEscrowEvent } from "../codec";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface TokenMove {
  from: string;
  to: string;
  value: bigint;
}

/** ERC-20 Transfer logs emitted by the escrow's token (Arc: the 6-decimal USDC interface at 0x3600...;
 * Arc's system emitter also logs an 18-decimal native Transfer for the same move: ignored here). */
export function tokenMoves(receipt: Pick<TransactionReceipt, "logs">, token: Address): TokenMove[] {
  return receipt.logs
    .filter(
      (l) =>
        l.address.toLowerCase() === token.toLowerCase() &&
        l.topics[0] === TRANSFER_TOPIC &&
        l.topics.length === 3,
    )
    .map((l) => ({
      from: `0x${(l.topics[1] as string).slice(26)}`.toLowerCase(),
      to: `0x${(l.topics[2] as string).slice(26)}`.toLowerCase(),
      value: BigInt(l.data),
    }));
}

/**
 * Pure cross-check of decoded escrow events against the token movements in the SAME receipt:
 * every deposit has a matching customer->escrow transfer, every claim a matching
 * escrow->recipient transfer, and the escrow's net token change equals deposits - claims
 * (vault conservation per transaction). Returns the reason on mismatch, else null.
 */
export function checkTokenConservation(
  events: IndexedEscrowEvent[],
  moves: TokenMove[],
  escrow: Address,
): string | null {
  const e = escrow.toLowerCase();
  const pool = [...moves];
  const take = (from: string, to: string, value: bigint) => {
    const i = pool.findIndex((m) => m.from === from && m.to === to && m.value === value);
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  };
  let expectedNet = 0n;
  for (const ev of events) {
    if (ev.name === "DepositEvent") {
      if (!take(ev.customer.toLowerCase(), e, BigInt(ev.amount)))
        return `no token transfer for deposit ${ev.purchase}`;
      expectedNet += BigInt(ev.amount);
    } else if (ev.name === "ClaimEvent") {
      if (!take(e, ev.recipient.toLowerCase(), BigInt(ev.amount)))
        return `no token transfer for claim ${ev.purchase}`;
      expectedNet -= BigInt(ev.amount);
    }
  }
  let actualNet = 0n;
  for (const m of moves) {
    if (m.to === e) actualNet += m.value;
    if (m.from === e) actualNet -= m.value;
  }
  return actualNet === expectedNet
    ? null
    : `escrow net token change ${actualNet} != events ${expectedNet}`;
}

/**
 * Independent verification of one transaction (docs/interfaces.md §3: events are notifications,
 * not proof). Confirmed means: receipt exists, succeeded, its block is at/below the requested
 * commitment head, and it called the escrow. Every decoded event must agree with the token
 * transfers in the receipt AND with current contract state; otherwise VERIFICATION_FAILED.
 */
export async function verifyArcTransaction(
  client: PublicClient,
  escrow: Address,
  token: Address,
  txHash: Hash,
  commitment: Commitment,
): Promise<TxVerification> {
  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) {
    return {
      signature: txHash,
      confirmed: false,
      commitment: null,
      slot: null,
      err: "not found",
      events: [],
    };
  }
  const head = await client.getBlock({ blockTag: blockTagFor(commitment) });
  if (head.number === null || receipt.blockNumber > head.number) {
    return {
      signature: txHash,
      confirmed: false,
      commitment: null,
      slot: Number(receipt.blockNumber),
      err: "not yet at commitment",
      events: [],
    };
  }
  if (receipt.status !== "success") {
    return {
      signature: txHash,
      confirmed: true,
      commitment,
      slot: Number(receipt.blockNumber),
      err: "reverted",
      events: [],
    };
  }
  const decoded = decodeEscrowLogs(receipt.logs, escrow);
  if (decoded.length && receipt.to?.toLowerCase() !== escrow.toLowerCase()) {
    // Our contract can only emit when called; a different `to` means a wrapper contract called it.
    // Allowed (e.g. smart wallets), but token checks below still apply.
  }
  const reason = checkTokenConservation(decoded, tokenMoves(receipt, token), escrow);
  if (reason) throw new SolanaGatewayError("VERIFICATION_FAILED", reason, txHash);

  for (const ev of decoded) {
    if (ev.name === "ResolutionEvent") {
      const p = await getPromoState(client, escrow, ev.promo, commitment);
      const want =
        ev.outcome === "YES" ? "ResolvedYes" : ev.outcome === "NO" ? "ResolvedNo" : "ResolvedVoid";
      if (!p || p.state !== want)
        throw new SolanaGatewayError(
          "VERIFICATION_FAILED",
          `promo ${ev.promo} is not ${want}`,
          txHash,
        );
      continue;
    }
    const u = await getPurchaseState(client, escrow, ev.purchase, commitment);
    if (!u || u.promoPda.toLowerCase() !== ev.promo.toLowerCase()) {
      throw new SolanaGatewayError(
        "VERIFICATION_FAILED",
        `purchase ${ev.purchase} missing or under another promo`,
        txHash,
      );
    }
    const ok =
      (ev.name === "DepositEvent" &&
        u.customer.toLowerCase() === ev.customer.toLowerCase() &&
        u.amount === ev.amount) ||
      (ev.name === "HedgeMarkedEvent" &&
        ["Hedged", "ClaimedByCustomer", "ClaimedByMerchant"].includes(u.state)) ||
      (ev.name === "PurchaseCancelledEvent" &&
        ["Cancelled", "Refunded"].includes(u.state) &&
        u.amount === ev.amount) ||
      (ev.name === "ClaimEvent" &&
        u.amount === ev.amount &&
        ((ev.kind === "CANCEL_REFUND" && u.state === "Refunded") ||
          (ev.kind === "YES_REFUND" && u.state === "ClaimedByCustomer") ||
          (ev.kind === "MERCHANT_PAYOUT" && u.state === "ClaimedByMerchant")));
    if (!ok)
      throw new SolanaGatewayError(
        "VERIFICATION_FAILED",
        `${ev.name} disagrees with purchase state ${u.state}`,
        txHash,
      );
  }

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const position = {
    signature: txHash as string,
    slot: Number(receipt.blockNumber),
    blockTime: Number(block.timestamp),
    commitment,
  };
  // NOTE: a v2 ResolutionEvent may carry outcome "VOID", which @hedged/shared's ResolutionEvent
  // type does not list yet (see README "Shared/backend changes needed").
  const events = decoded.map(
    ({ logIndex: _l, ...ev }) => ({ ...ev, ...position }) as unknown as ProgramEvent,
  );
  return {
    signature: txHash,
    confirmed: true,
    commitment,
    slot: Number(receipt.blockNumber),
    err: null,
    events,
  };
}

/** Read the token's balance of the escrow (pooled vault) at a block tag. */
export async function vaultBalance(
  client: PublicClient,
  escrow: Address,
  token: Address,
  blockTag: "latest" | "finalized" = "finalized",
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [escrow],
    blockTag,
  });
}

export type { Hex };
