import type { ClaimKind } from "@hedged/shared";

function decodeFail(what: string): never {
  throw new Error(`unknown escrow event value: ${what} (ABI out of date?)`);
}
import { decodeEventLog, type Address, type Hex, type Log } from "viem";
import { HEDGED_ESCROW_ABI } from "./abi";
import { CLAIM_KIND_NAMES } from "./accounts";
import { fromBytes16 } from "./ids";

/**
 * Decodes the escrow's five events from receipt logs into the @hedged/shared payload shapes
 * (minus ChainPosition, which the server attaches after verification). `eventIndex` = position
 * among THIS contract's decoded events in the transaction, exactly as on Solana, so
 * `chainEventId = "${txHash}:${eventIndex}"`. The EVM `logIndex` is kept for diagnostics.
 */
export type DecodedEscrowEvent =
  | {
      name: "DepositEvent";
      promo: Hex;
      purchase: Hex;
      customer: Address;
      purchaseId: string;
      amount: string;
      depositedAt: number;
    }
  | { name: "HedgeMarkedEvent"; promo: Hex; purchase: Hex; relayer: Address; markedAt: number }
  | {
      name: "PurchaseCancelledEvent";
      promo: Hex;
      purchase: Hex;
      customer: Address;
      amount: string;
      cancelledAt: number;
    }
  | {
      name: "ResolutionEvent";
      promo: Hex;
      /** v2 adds "VOID" (contract `Outcome.Void` = 2). */
      outcome: ArcOutcome;
      relayer: Address;
      resolvedAt: number;
    }
  | {
      name: "ClaimEvent";
      promo: Hex;
      purchase: Hex;
      recipient: Address;
      amount: string;
      kind: ClaimKind;
      claimedAt: number;
    };

export type ArcOutcome = "YES" | "NO" | "VOID";
export const OUTCOMES: readonly ArcOutcome[] = ["YES", "NO", "VOID"];

export type IndexedEscrowEvent = DecodedEscrowEvent & { eventIndex: number; logIndex: number };

type MinimalLog = Pick<Log, "address" | "data" | "topics"> & { logIndex?: number | null };

export function decodeEscrowLogs(
  logs: readonly MinimalLog[],
  escrow: Address,
): IndexedEscrowEvent[] {
  const out: IndexedEscrowEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== escrow.toLowerCase()) continue;
    let d;
    try {
      d = decodeEventLog({
        abi: HEDGED_ESCROW_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
    } catch {
      continue; // not one of ours (cannot happen for our own address unless the ABI is stale)
    }
    const a = d.args as Record<string, unknown>;
    const base = { eventIndex: out.length, logIndex: Number(log.logIndex ?? -1) };
    switch (d.eventName) {
      case "DepositEvent":
        out.push({
          ...base,
          name: "DepositEvent",
          promo: a.promo as Hex,
          purchase: a.purchase as Hex,
          customer: a.customer as Address,
          purchaseId: fromBytes16(a.purchaseId as Hex),
          amount: String(a.amount),
          depositedAt: Number(a.depositedAt),
        });
        break;
      case "HedgeMarkedEvent":
        out.push({
          ...base,
          name: "HedgeMarkedEvent",
          promo: a.promo as Hex,
          purchase: a.purchase as Hex,
          relayer: a.relayer as Address,
          markedAt: Number(a.markedAt),
        });
        break;
      case "PurchaseCancelledEvent":
        out.push({
          ...base,
          name: "PurchaseCancelledEvent",
          promo: a.promo as Hex,
          purchase: a.purchase as Hex,
          customer: a.customer as Address,
          amount: String(a.amount),
          cancelledAt: Number(a.cancelledAt),
        });
        break;
      case "ResolutionEvent":
        out.push({
          ...base,
          name: "ResolutionEvent",
          promo: a.promo as Hex,
          // Never map an unknown value to YES/NO: a VOID read as NO would pay out wrongly.
          outcome: OUTCOMES[Number(a.outcome)] ?? decodeFail(`outcome ${String(a.outcome)}`),
          relayer: a.relayer as Address,
          resolvedAt: Number(a.resolvedAt),
        });
        break;
      case "ClaimEvent":
        out.push({
          ...base,
          name: "ClaimEvent",
          promo: a.promo as Hex,
          purchase: a.purchase as Hex,
          recipient: a.recipient as Address,
          amount: String(a.amount),
          kind: CLAIM_KIND_NAMES[Number(a.kind)] ?? decodeFail(`claim kind ${String(a.kind)}`),
          claimedAt: Number(a.claimedAt),
        });
        break;
    }
  }
  return out;
}
