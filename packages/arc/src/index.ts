/**
 * @hedged/arc: BROWSER-SAFE entry (no keys, no Node APIs). Arc (Circle's EVM L1) version of
 * @hedged/solana: ids, reads, unsigned wallet transactions, event decoding.
 * Server-only pieces (relayer gateway, Streams webhook) live in `@hedged/arc/server`.
 */
export * from "./config";
export * from "./ids";
export * from "./errors";
export * from "./accounts";
export * from "./codec";
export * from "./transactions";
export * from "./checkout";
export { HEDGED_ESCROW_ABI } from "./abi";
