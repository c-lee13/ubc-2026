import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_EXPLORER,
  getPurchaseState,
  listPurchases,
} from "@hedged/arc";
import type { OnChainPurchaseAccount } from "@hedged/shared";
import { createPublicClient, http, type Address, type Hex, type PublicClient } from "viem";
import { publicConfig } from "../config";

/**
 * The thin chain module: everything chain-specific the pages need, behind one small surface.
 * Arc testnet today (chain id 5042002). Money never moves from here: every signature happens in
 * the user's Circle wallet through a challenge the backend creates, so this module only links to
 * the explorer and, when the escrow address is configured, reads escrow state directly.
 */
export interface ChainInfo {
  networkLabel: string;
  networkShort: string;
  chainId: number;
  explorerTx(hash: string): string;
  explorerAddress(address: string): string;
  /** Null when NEXT_PUBLIC_ARC_ESCROW_ADDRESS is not set: callers fall back to the API. */
  reads: {
    escrow: string;
    purchase(purchaseKey: string): Promise<OnChainPurchaseAccount | null>;
    purchasesOf(promoId: string): Promise<OnChainPurchaseAccount[]>;
  } | null;
}

let instance: ChainInfo | null = null;

export function chain(): ChainInfo {
  if (instance) return instance;
  const escrow = publicConfig.arcEscrow as Address | null;
  let client: PublicClient | null = null;
  const pc = () => (client ??= createPublicClient({ transport: http(publicConfig.arcRpcUrl) }));
  instance = {
    networkLabel: "Arc testnet",
    networkShort: "Arc",
    chainId: ARC_TESTNET_CHAIN_ID,
    explorerTx: (hash) => `${ARC_TESTNET_EXPLORER}/tx/${hash}`,
    explorerAddress: (address) => `${ARC_TESTNET_EXPLORER}/address/${address}`,
    reads: escrow
      ? {
          escrow,
          purchase: (key) => getPurchaseState(pc(), escrow, key as Hex),
          purchasesOf: (promoId) => listPurchases(pc(), escrow, promoId as Hex),
        }
      : null,
  };
  return instance;
}
