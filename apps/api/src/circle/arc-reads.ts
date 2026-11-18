import { isEscrowV2 } from "@hedged/arc";
import { createPublicClient, erc20Abi, getAddress, http, type Address } from "viem";

/** Read-only chain lookups the checkout needs (testnet USDC on Arc). Swapped for a fake in tests. */
export interface ArcReads {
  /** USDC (6-decimal base units) the escrow may pull from `owner`. */
  allowance(owner: string): Promise<bigint>;
  /** USDC balance of `owner` (6-decimal base units, ERC-20 interface). */
  balance(owner: string): Promise<bigint>;
  /** True when the escrow is v2 (one-signature checkout, automatic payouts). */
  isV2(): Promise<boolean>;
}

export function createArcReads(rpcUrl: string, token: string, escrow: string): ArcReads {
  const client = createPublicClient({ transport: http(rpcUrl) });
  const t = getAddress(token);
  const e = getAddress(escrow);
  return {
    allowance: (owner) =>
      client.readContract({
        address: t,
        abi: erc20Abi,
        functionName: "allowance",
        args: [getAddress(owner) as Address, e],
      }),
    balance: (owner) =>
      client.readContract({
        address: t,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(owner) as Address],
      }),
    isV2: () => isEscrowV2(client, e),
  };
}
