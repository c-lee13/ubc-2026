import { getAddress, type Address, type Hex, type PublicClient, type TypedDataDomain } from "viem";
import { purchaseKeyOf } from "./ids";

/**
 * One-signature checkout (v2 escrow). Browser-safe: builds the EIP-712 typed data a customer signs.
 *
 * Preferred path, EIP-3009 `ReceiveWithAuthorization` (`depositWithAuthorization`):
 *   1. frontend/backend picks a fresh `purchaseIdHex` and builds `receiveAuthorizationTypedData`;
 *   2. the customer signs it ONCE (Circle: `POST /v1/w3s/user/sign/typedData` with
 *      `toCircleTypedDataJson(...)` as `data`, then `sdk.execute(challengeId)`; browser wallet:
 *      `signTypedData`);
 *   3. the relayer submits `depositWithAuthorization` and pays the USDC gas.
 * The 3009 `nonce` is the purchase key `purchaseKeyOf(promoId, customer, purchaseIdHex)`; the
 * contract recomputes it, so the signature only works for that promo, customer and purchase id,
 * and only the escrow can redeem it (`to` must be the caller).
 *
 * Fallback, EIP-2612 `Permit` (`depositWithPermit`): the customer signs a permit and still sends
 * one transaction themselves (two wallet prompts on most wallets).
 */

/** Arc testnet USDC's EIP-712 domain. Verified on chain 2026-11-18: `name()` "USDC",
 * `version()` "2", and `DOMAIN_SEPARATOR()` 0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0
 * equals the hash of exactly this domain. Prefer `readTokenDomain` at runtime. */
export const ARC_TESTNET_USDC_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: 5042002,
  verifyingContract: "0x3600000000000000000000000000000000000000",
} as const satisfies TypedDataDomain;
export const ARC_TESTNET_USDC_DOMAIN_SEPARATOR =
  "0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0" as const;

export interface TokenDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

const DOMAIN_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "version",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** Read the token's EIP-712 domain from chain (works for Arc USDC and the anvil MockUSDC). */
export async function readTokenDomain(client: PublicClient, token: Address): Promise<TokenDomain> {
  const [name, version, chainId] = await Promise.all([
    client.readContract({ address: token, abi: DOMAIN_ABI, functionName: "name" }),
    client.readContract({ address: token, abi: DOMAIN_ABI, functionName: "version" }),
    client.getChainId(),
  ]);
  return { name, version, chainId, verifyingContract: getAddress(token) };
}

/** EIP-2612 permit nonce of `owner` (needed for `permitTypedData`). */
export function readPermitNonce(client: PublicClient, token: Address, owner: Address) {
  return client.readContract({
    address: token,
    abi: DOMAIN_ABI,
    functionName: "nonces",
    args: [owner],
  });
}

export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * The typed data for `depositWithAuthorization`. `validBefore` should be a few minutes ahead and
 * not after the promo's deposit deadline; `validAfter` 0 (valid immediately).
 */
export function receiveAuthorizationTypedData(a: {
  domain: TokenDomain;
  escrow: Address;
  promoId: Hex;
  customer: Address;
  purchaseIdHex: string;
  amount: bigint;
  validAfter?: bigint;
  validBefore: bigint;
}) {
  const nonce = purchaseKeyOf(a.promoId, a.customer, a.purchaseIdHex);
  return {
    domain: a.domain,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization" as const,
    message: {
      from: getAddress(a.customer),
      to: getAddress(a.escrow),
      value: a.amount,
      validAfter: a.validAfter ?? 0n,
      validBefore: a.validBefore,
      nonce,
    },
  };
}

/** The typed data for `depositWithPermit` (value = the exact offer; spender = the escrow). */
export function permitTypedData(a: {
  domain: TokenDomain;
  owner: Address;
  escrow: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: a.domain,
    types: PERMIT_TYPES,
    primaryType: "Permit" as const,
    message: {
      owner: getAddress(a.owner),
      spender: getAddress(a.escrow),
      value: a.amount,
      nonce: a.nonce,
      deadline: a.deadline,
    },
  };
}

/**
 * The JSON string Circle's `POST /v1/w3s/user/sign/typedData` takes as `data`
 * (eth_signTypedData_v4 shape: includes the `EIP712Domain` type; uint256 values as decimal
 * strings, chainId as a number).
 */
export function toCircleTypedDataJson(td: {
  domain: TokenDomain;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}): string {
  return JSON.stringify(
    {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        ...td.types,
      },
      domain: td.domain,
      primaryType: td.primaryType,
      message: td.message,
    },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
}
