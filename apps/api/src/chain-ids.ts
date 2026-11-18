/**
 * Chain identifiers as the API sees them. The backend runs on Solana (base58 public keys / PDAs)
 * or on Arc (EVM `0x` addresses and `0x` bytes32 ids), and treats both as opaque strings.
 *
 * EVM hex is case-insensitive (checksummed vs lowercase), so `0x` values are stored and compared in
 * lowercase; base58 is case-sensitive and kept exactly as given.
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

/** A wallet: Solana public key or EVM address. */
export function isWalletAddress(v: unknown): v is string {
  return typeof v === "string" && (BASE58.test(v) || EVM_ADDRESS.test(v));
}

/** A promo / purchase id: Solana PDA or Arc bytes32 id. */
export function isChainId(v: unknown): v is string {
  return typeof v === "string" && (BASE58.test(v) || BYTES32.test(v));
}

/** Canonical form for storage and lookups. */
export function canonical(v: string): string {
  return v.startsWith("0x") ? v.toLowerCase() : v;
}

export function sameChainString(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return a != null && b != null && canonical(a) === canonical(b);
}
