# @hedged/arc: the Arc version (Circle's stablecoin L1)

Same product, same guarantees, on **Arc testnet** instead of Solana Devnet. The Solana code stays
in the repo untouched; which chain runs is a config choice (`SOLANA_GATEWAY=arc` in `apps/api`).

| Piece           | Solana (fallback)                      | Arc (this package)                                                |
| --------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Escrow          | `programs/escrow` (Anchor)             | `contracts/arc/src/HedgedEscrow.sol` (Solidity, Foundry)          |
| SDK             | `@hedged/solana`                       | `@hedged/arc` (viem)                                              |
| Backend gateway | `createSolanaGatewayFromEnv()`         | `createArcGatewayFromEnv()`, same `SolanaServerGateway` interface |
| Money           | mock 6-decimal SPL mint                | **real testnet USDC** (Arc's USDC ERC-20 interface, 6 decimals)   |
| Fees            | SOL                                    | USDC (Arc's gas token): about $0.0025 per relayer tx at 25 gwei   |
| Event feed      | QuickNode Streams `programs_with_logs` | QuickNode Streams `logs` on `arc-testnet`                         |

## How the project uses Arc (for "Best use of Arc")

- **USDC is the product.** Customers pay real (testnet) USDC into the escrow and get USDC back,
  and every fee is paid in USDC too. No second token, no mock mint, no wrapped asset: the escrow
  holds Arc's native USDC through its ERC-20 interface at `0x3600000000000000000000000000000000000000`.
- **Deterministic sub-second finality.** The relayer marks a purchase hedged and the merchant can
  hand over the coffee within about a second; the gateway still waits for the `finalized` block.
- **Predictable dollar fees.** A merchant's cost per promo is a dollar number (hedge premium +
  a fraction of a cent of USDC gas), which is the whole pitch of a budgeted promotion.

Network (verified 2026-11-17 against the live RPC): chain id `5042002`, RPC
`https://rpc.testnet.arc.io`, explorer `https://explorer.testnet.arc.io`, faucet
`https://faucet.circle.com` (Arc Testnet). Contract address (Arc testnet, v2, deployed 2026-11-18): **`0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39`** ([explorer](https://explorer.testnet.arc.io/address/0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39)), relayer `0x118318601ff299f6aAA8839B765d5Ca1bFD2EC83`. Live check: `scripts/arc-live.ts` (22/22 on testnet). Retired v1: `0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a`.

## Contract (`contracts/arc`)

`HedgedEscrow` mirrors the Anchor program one-to-one: the 12 operations (`initialize_config` is the
constructor), the same state machines, authority/pause matrix (docs/interfaces.md §2), the same
errors in the same order (`6000 + index` = the Anchor code; EVM-only errors are appended), and
the same five events. EVM-forced differences:

- **Ids instead of PDAs:** `promoId = keccak256(abi.encode("promo", merchant, nonce))`,
  `purchaseKey = keccak256(abi.encode("purchase", promoId, customer, purchaseId16))`
  (`promoIdOf` / `purchaseKeyOf` in TS and Solidity). They appear where the gateway says `promoPda` / `purchasePda`.
- **Vault model:** one contract holds every promo's USDC; per-promo `totalDeposited` /
  `totalPaidOut` keep the guarantee that a promo can only ever pay out what it took in, and each
  payout equals exactly that purchase's amount. `getPromoState().vaultBalance` is the contract-wide
  balance (always >= the sum of outstanding).
- **Payout destinations** are the recorded customer / merchant addresses themselves.
- Reentrancy guard + checks-effects-interactions; deposits require the exact token balance delta.

Tests: `cd contracts/arc && forge test` (120 tests: unit, fuzz, and invariants for conservation,
no double claim, and payout-matches-outcome).

## Contract v2 (deployed: `0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39`)

v1 at `0x6032...c82a` keeps working with this package (every v1 call and event is unchanged; the
new calls just do not exist there, `isEscrowV2()` tells them apart). Everything below is
append-only on the ABI: existing enum values, errors (`6000 + index`) and events are untouched.

**1. Automatic payouts (no customer or shop tap).** Anyone may call these (normally the relayer):
the contract fixes who is paid and how much, so a caller can only pay what is owed to whom it is owed.

| Function                                | Does                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `settlePurchase(purchaseKey)`           | pays one purchase; reverts `AlreadyClaimed` (done), `InvalidState` (not due), `Paused`                       |
| `settlePurchases(bytes32[] keys)`       | up to 50 keys, any promos; skips done / not due / paused / unknown, never reverts the batch for one purchase |
| `settlePromo(promoId, offset, limit)`   | a page of one promo (limit capped at 50), returns `(settled, nextOffset)`                                    |
| `previewSettlement(purchaseKey)` (view) | `(status, recipient, amount, kind)`, status `Payable` / `NotFound` / `AlreadySettled` / `NotDue` / `Paused`  |

Who gets paid (one rule, `_due`, shared with the self-claims, so whichever runs first wins, once):

| Purchase                 | Promo Active | YES      | NO       | VOID     |
| ------------------------ | ------------ | -------- | -------- | -------- |
| Cancelled                | customer     | customer | customer | customer |
| Deposited (never hedged) | not due      | customer | customer | customer |
| Hedged                   | not due      | customer | **shop** | **shop** |

Cancel refunds and never-hedged refunds also run while the admin pause is on; hedged payouts wait
for unpause (same rule as v1's claims). If the token refuses one transfer in a batch (e.g. a
USDC-blocklisted address), that purchase is rolled back, `SettlementFailed` is emitted and it stays
payable. `claimRefund` / `claimMerchant` still work as a fallback (`claimMerchant` now also for VOID;
`claimRefund` now also for a never-hedged purchase on a resolved promo).

**2. VOID outcome.** `resolvePromo(promoId, 2)` (`Outcome.Void`, gateway `resolvePromotion(id, "VOID")`):
relayer only, at/after the deadline, once, cannot switch to/from YES/NO. Team spec: "nobody wins,
shop keeps sales, flagged for an operator". Promo state becomes `ResolvedVoid` (index 3).

**3. One-signature checkout: `depositWithAuthorization` (EIP-3009).** Arc testnet USDC supports it
(checked on chain 2026-11-18: `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` = `0xd099cc98…13de8`,
`authorizationState()` answers, `receiveWithAuthorization` reverts "caller must be the payee" for a
stranger; the token is Circle FiatToken v2.2 behind a proxy). The customer signs once, the relayer
submits and pays the USDC gas. The contract computes the 3009 nonce itself as the purchase key
`purchaseKeyOf(promoId, customer, purchaseId)`, so a signature cannot be reused for another promo,
purchase id, customer or amount, and only the escrow can redeem it.

Exactly what the customer signs (build it with `receiveAuthorizationTypedData`, send it to Circle
with `toCircleTypedDataJson`):

```jsonc
{
  "types": {
    "EIP712Domain": [
      { "name": "name", "type": "string" },
      { "name": "version", "type": "string" },
      { "name": "chainId", "type": "uint256" },
      { "name": "verifyingContract", "type": "address" },
    ],
    "ReceiveWithAuthorization": [
      { "name": "from", "type": "address" },
      { "name": "to", "type": "address" },
      { "name": "value", "type": "uint256" },
      { "name": "validAfter", "type": "uint256" },
      { "name": "validBefore", "type": "uint256" },
      { "name": "nonce", "type": "bytes32" },
    ],
  },
  "primaryType": "ReceiveWithAuthorization",
  "domain": {
    "name": "USDC",
    "version": "2",
    "chainId": 5042002,
    "verifyingContract": "0x3600000000000000000000000000000000000000",
  },
  "message": {
    "from": "<customer wallet address>",
    "to": "<ARC_ESCROW_ADDRESS (the v2 escrow)>",
    "value": "<promo offer, 6-decimal base units, e.g. 5000000>",
    "validAfter": "0",
    "validBefore": "<unix seconds, a few minutes ahead, not after the promo deadline>",
    "nonce": "<purchaseKeyOf(promoId, customer, purchaseIdHex)>",
  },
}
```

That domain hashes to the token's on-chain `DOMAIN_SEPARATOR()`
`0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0` (unit-tested).
Then the relayer calls `depositWithAuthorization(promoId, purchaseId, customer, value, validAfter,
validBefore, v, r, s)` (gateway: `submitAuthorizedDeposit({...signature})`, idempotent).

`depositWithPermit(promoId, purchaseId, amount, deadline, v, r, s)` (EIP-2612, permit for exactly
`amount`) also exists for browser wallets; the customer still sends that transaction.

**What Rachel's backend needs (apps/api, not changed here):**

- Checkout: replace approve + deposit with: `POST /v1/w3s/user/sign/typedData` `{ walletId, data:
toCircleTypedDataJson(receiveAuthorizationTypedData({...})), memo }` with `X-User-Token` → return
  `challengeId` (plus `purchaseIdHex`, `purchaseKey`, `validBefore`) to the browser; a new route takes
  the signature back and calls `gateway.submitAuthorizedDeposit(...)`. Keep the same `purchaseIdHex`
  between the two steps (it is inside the signed nonce). The relayer now pays deposit gas.
- After `resolvePromotion` (and after `cancelUnhedged`): call `gateway.settlePromotion(promoId)` /
  `settlePurchase(key)`. The existing `subscribeToClaims` handler already records the resulting
  `ClaimEvent`s (they are the same events), so REFUNDED / CLAIMED keep working.
- VOID: map Gemini "cancelled/void" to `resolvePromotion(id, "VOID")`, flag for an operator, settle
  simulated hedges as void (not loss), move HEDGED → CLAIMED (shop) and unhedged → REFUNDED.
- `@hedged/shared` (needs the owners' review, not edited here): add `"ResolvedVoid"` to
  `OnChainPromoState`, `"VOID"` to `ResolutionEvent.outcome` and `resolvePromotion`'s outcome, and
  then the backend can switch from `subscribeToResolutions` (YES/NO only: VOID is withheld so a
  YES/NO handler cannot read it as NO) to `subscribeToArcResolutions`. Until then the gateway's
  shared `getPromoState` can return `"ResolvedVoid"` at runtime; `getArcPromoState` has the honest type.

**What Zahin's frontend needs:** one "Pay" tap: call the backend's sign route, `sdk.execute(challengeId)`
(Circle's callback carries the signature; check `result.data.signature` against Circle's SDK docs),
post it back, then poll the receipt as today. No approve step, no claim buttons (keep "claim" only
as a fallback when a purchase shows as payable for long). Show "game voided: shop keeps the sale"
for VOID. Promo state can be `ResolvedVoid`.

**Not built (team undecided, backend concerns per the spec):** platform fee and per-customer limit.
Nothing blocks them: every deposit passes one internal function (`_recordDeposit`) and every payout
one of two (`_settle` / `_trySettle`), so an on-chain version would be a small change there.

**Limits:** `depositWithAuthorization` takes a 65-byte (v, r, s) EOA signature. Circle **SCA**
wallets sign with ERC-1271, which USDC only accepts through its `bytes signature` overloads: not
wired, so keep `CIRCLE_ACCOUNT_TYPE=EOA` (the current default).

## SDK

Browser-safe (`@hedged/arc`): `promoIdOf`, `purchaseKeyOf`, `newPurchaseIdHex`, reads
(`getConfig`, `getPromoState`, `getPurchaseState`, `listPurchases`), and unsigned wallet
transactions (`buildInitializePromoTx`, `buildDepositFlow` = approve + deposit,
`buildClaimRefundTx`, `buildClaimMerchantTx`, `buildCancelExpiredDepositTx`; v2:
`buildSettlePurchaseTx`, `buildSettlePurchasesTx`, `buildSettlePromoTx`, `buildDepositWithAuthorizationTx`,
`buildDepositWithPermitTx`, plus `receiveAuthorizationTypedData`, `permitTypedData`, `readTokenDomain`,
`toCircleTypedDataJson`, `previewSettlement`, `isEscrowV2`). Each builder returns
`{ to, data, value }` for wagmi/viem `sendTransaction`.

Server (`@hedged/arc/server`): `ArcGateway` implements `SolanaServerGateway` exactly (idempotent
`markHedged` / `cancelUnhedged` / `resolvePromotion` with `alreadyApplied`, `INVALID_STATE` with the
observed state, `ResolutionTooEarlyError` retryable, `TX_TIMEOUT` only after a state re-read),
`verifyTransaction` (receipt success at the commitment + every event cross-checked against USDC
Transfer logs and contract state), and subscriptions (verified only, deduped by
`chainEventId = txHash:eventIndex`, redelivery with backoff, `fromSlot` = from block replay).

```ts
import { createArcGatewayFromEnv } from "@hedged/arc/server";
const gateway = await createArcGatewayFromEnv(); // refuses anything but Arc testnet
```

| Env                                | Meaning                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ARC_ESCROW_ADDRESS`               | deployed HedgedEscrow (browser: `NEXT_PUBLIC_ARC_ESCROW_ADDRESS`)                              |
| `ARC_RELAYER_KEY_PATH`             | relayer key JSON **outside the repo** (`scripts/keygen.ts` writes `~/.config/arc/<name>.json`) |
| `ARC_RPC_URL` / `ARC_WSS_URL`      | default public Arc testnet RPC                                                                 |
| `ARC_FINALITY`                     | `finalized` (default) or `confirmed`                                                           |
| `ARC_EVENT_SOURCE`                 | `poll` (default), `websocket`, or `streams` (QuickNode webhook is the primary feed)            |
| `QUICKNODE_STREAMS_SECURITY_TOKEN` | the Stream's HMAC token (streams mode)                                                         |

## QuickNode Streams (bounty: "Best Use of QuickNode Streams")

- **Network / dataset:** `arc-testnet`, dataset `logs` (shape verified with QuickNode's
  read-only `test_filter`: one entry per block, one array of logs per transaction).
- **Filter** (`streams/filter.js`): keeps only logs emitted by our escrow whose first topic is one
  of the five escrow events, groups them by transaction and returns
  `{ matchedTransactions: [{ txHash, blockNumber, events }] }`, or `null` (no delivery) for blocks
  without escrow activity. Why: the backend needs to react to deposits, resolutions and claims
  within a second, and should not pay for or parse every USDC transfer on the chain.
- **Destination:** webhook (gzip, HMAC-signed with the Stream's security token) to
  `POST /webhooks/quicknode` (`handleArcStreamsWebhook`; standalone: `pnpm --filter @hedged/arc streams:webhook`).
- **Trust model:** a delivery is a notification. Every tx hash is re-fetched over RPC and verified
  before anything reaches the backend; the poll sweep fills gaps if a delivery is missed.
- **Create it** (once the API has a public https URL, e.g. `ngrok http 4000`):
  `set -a; . ~/.config/ubc-hackathon/quicknode.env; set +a; ARC_ESCROW_ADDRESS=0x... STREAMS_WEBHOOK_URL=https://.../webhooks/quicknode pnpm --filter @hedged/arc streams:create`
  (prints the security token once; idempotent by name). Check the filter first with
  `pnpm --filter @hedged/arc streams:test-filter`.

## Deploy (Arc testnet)

1. Keys (already generated on Dylan's Mac, outside the repo): `~/.config/arc/ubc-deployer.json`
   and `~/.config/arc/ubc-relayer.json`. New ones: `pnpm --filter @hedged/arc exec tsx scripts/keygen.ts <name>`.
2. Fund the **deployer** at https://faucet.circle.com (Arc Testnet; the faucet has a captcha, so a
   person does this) and send a little USDC to the **relayer** for its fees.
3. `ARC_DEPLOYER_KEY_PATH=~/.config/arc/ubc-deployer.json ARC_RELAYER_ADDRESS=<relayer> pnpm --filter @hedged/arc deploy`
   (add `--dry-run` first). The deployer becomes admin; rotate the relayer later with `relayer:set`.

## Tests

| Command                                                                                                                                               | What                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `cd contracts/arc && forge test`                                                                                                                      | 120 Solidity tests (unit + fuzz + invariants)                                   |
| `pnpm --filter @hedged/arc test`                                                                                                                      | 17 unit tests (ids, errors, decoding, filter, webhook HMAC, token conservation) |
| `anvil --port 18545 --silent --slots-in-an-epoch 1 --block-time 1 &` then `ANVIL_RPC_URL=http://127.0.0.1:18545 pnpm --filter @hedged/arc test:anvil` | 61 end-to-end checks on a local chain                                           |
| same anvil, then `ANVIL_RPC_URL=http://127.0.0.1:18545 pnpm --filter @hedged/api exec tsx ../../tests/arc/api-workers.e2e.ts`                         | Rachel's real orchestrator + workers driving the Arc escrow (8 checks)          |
