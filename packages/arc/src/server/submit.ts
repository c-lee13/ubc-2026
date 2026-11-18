import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  WaitForTransactionReceiptTimeoutError,
  type Address,
  type Hash,
  type PrivateKeyAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { HEDGED_ESCROW_ABI } from "../abi";
import { escrowErrorName, type EscrowErrorName } from "../errors";

/** The contract rejected the call (simulation or mined revert) with a known custom error. */
export class ProgramFailure extends Error {
  constructor(
    readonly errorName: EscrowErrorName | null,
    message: string,
    readonly txHash?: Hash,
  ) {
    super(message);
    this.name = "ProgramFailure";
  }
}
/** Transport-level failure: nothing is known to have been sent. Retryable. */
export class RpcFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcFailure";
  }
}
/** Sent, but no receipt / finality within the budget: outcome UNKNOWN -> re-read state. */
export class SubmitTimeout extends Error {
  constructor(readonly txHash: Hash) {
    super(`transaction ${txHash} not final in time`);
    this.name = "SubmitTimeout";
  }
}

export const isRpcError = (e: unknown) =>
  e instanceof HttpRequestError ||
  e instanceof TimeoutError ||
  (e instanceof BaseError &&
    e.walk((x) => x instanceof HttpRequestError || x instanceof TimeoutError) !== null) ||
  (e instanceof Error &&
    /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|network/i.test(e.message));

export type RelayerFn =
  | "markHedged"
  | "cancelUnhedged"
  | "resolvePromo"
  // v2: the relayer also pushes payouts and submits customers' signed deposits
  | "settlePurchase"
  | "settlePurchases"
  | "settlePromo"
  | "depositWithAuthorization";

/**
 * Simulate -> send -> receipt -> wait for finality. Program errors surface at simulation, before
 * anything is sent. Resolves with the receipt only once the block is at/below the `finalized`
 * head (or merely mined when commitment is "confirmed").
 */
export async function submitRelayerCall(o: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: PrivateKeyAccount;
  escrow: Address;
  functionName: RelayerFn;
  args: readonly unknown[];
  commitment: "confirmed" | "finalized";
  timeoutMs: number;
}): Promise<TransactionReceipt> {
  const started = Date.now();
  let request;
  try {
    ({ request } = await o.publicClient.simulateContract({
      address: o.escrow,
      abi: HEDGED_ESCROW_ABI,
      functionName: o.functionName,
      args: o.args as never,
      account: o.account,
    }));
  } catch (e) {
    const name = escrowErrorName(e);
    if (name) throw new ProgramFailure(name, `${o.functionName} rejected: ${name}`);
    if (isRpcError(e))
      throw new RpcFailure(`simulate ${o.functionName}: ${(e as Error).message.split("\n")[0]}`);
    throw new ProgramFailure(
      null,
      `${o.functionName} simulation failed: ${(e as Error).message.split("\n")[0]}`,
    );
  }

  let hash: Hash;
  try {
    hash = await o.walletClient.writeContract({
      ...request,
      account: o.account,
      chain: o.walletClient.chain ?? null,
    });
  } catch (e) {
    const name = escrowErrorName(e);
    if (name) throw new ProgramFailure(name, `${o.functionName} rejected: ${name}`);
    throw new RpcFailure(`send ${o.functionName}: ${(e as Error).message.split("\n")[0]}`);
  }

  let receipt: TransactionReceipt;
  try {
    receipt = await o.publicClient.waitForTransactionReceipt({
      hash,
      timeout: Math.max(1_000, o.timeoutMs - (Date.now() - started)),
      pollingInterval: 500,
    });
  } catch (e) {
    if (e instanceof WaitForTransactionReceiptTimeoutError || isRpcError(e))
      throw new SubmitTimeout(hash);
    throw e;
  }
  if (receipt.status !== "success") {
    // Mined but reverted (state changed between simulation and inclusion): ask why.
    let name: EscrowErrorName | null = null;
    try {
      await o.publicClient.simulateContract({
        address: o.escrow,
        abi: HEDGED_ESCROW_ABI,
        functionName: o.functionName,
        args: o.args as never,
        account: o.account,
      });
    } catch (e) {
      name = escrowErrorName(e);
    }
    throw new ProgramFailure(
      name,
      `${o.functionName} reverted on-chain${name ? `: ${name}` : ""}`,
      hash,
    );
  }
  if (o.commitment === "finalized") {
    while (true) {
      const fin = await o.publicClient.getBlock({ blockTag: "finalized" }).catch(() => null);
      if (fin && fin.number !== null && fin.number >= receipt.blockNumber) break;
      if (Date.now() - started > o.timeoutMs) throw new SubmitTimeout(hash);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return receipt;
}
