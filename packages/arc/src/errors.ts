import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Contract custom errors in declaration order. Indices 0..22 match the Anchor enum exactly, so
 * `anchorCode = 6000 + index` (docs/interfaces.md §2); 23+ are EVM-only.
 */
export const ESCROW_ERROR_NAMES = [
  "Unauthorized",
  "Paused",
  "InvalidState",
  "WrongMint",
  "WrongTokenAccount",
  "DepositClosed",
  "WrongAmount",
  "PromoNotActive",
  "AlreadyResolved",
  "AlreadyHedged",
  "AlreadyCancelled",
  "AlreadyClaimed",
  "MarketIdTooLong",
  "MathOverflow",
  "InvalidOfferAmount",
  "InvalidDeadline",
  "EmptyMarketId",
  "WrongDecimals",
  "InvalidRelayer",
  "InsufficientVaultFunds",
  "ResolutionTooEarly",
  "TimeoutNotElapsed",
  "InvalidTimeout",
  "PromoAlreadyExists",
  "PurchaseAlreadyExists",
  "AccountNotFound",
  "Reentrancy",
  "TokenTransferFailed",
  // v2 (appended)
  "BatchTooLarge",
  "PermitFailed",
] as const;
export type EscrowErrorName = (typeof ESCROW_ERROR_NAMES)[number];

/** Anchor-compatible numeric code (6000 + index); EVM-only errors continue the sequence. */
export function escrowErrorCode(name: EscrowErrorName): number {
  return 6000 + ESCROW_ERROR_NAMES.indexOf(name);
}

/** Extract the contract's custom error name from a viem error (simulate/write/estimate), if any. */
export function escrowErrorName(err: unknown): EscrowErrorName | null {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const n = revert.data?.errorName;
      if (n && (ESCROW_ERROR_NAMES as readonly string[]).includes(n)) return n as EscrowErrorName;
    }
  }
  return null;
}
