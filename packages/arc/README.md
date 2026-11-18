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
`https://faucet.circle.com` (Arc Testnet). Contract address (Arc testnet, deployed 2026-11-18): **`0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a`** ([explorer](https://explorer.testnet.arc.io/address/0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a)), relayer `0x118318601ff299f6aAA8839B765d5Ca1bFD2EC83`. Live check: `scripts/arc-live.ts` (13/13 on testnet).

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

Tests: `cd contracts/arc && forge test` (91 tests: unit, fuzz, and invariants for conservation,
no double claim, and payout-matches-outcome).

## SDK

Browser-safe (`@hedged/arc`): `promoIdOf`, `purchaseKeyOf`, `newPurchaseIdHex`, reads
(`getConfig`, `getPromoState`, `getPurchaseState`, `listPurchases`), and unsigned wallet
transactions (`buildInitializePromoTx`, `buildDepositFlow` = approve + deposit,
`buildClaimRefundTx`, `buildClaimMerchantTx`, `buildCancelExpiredDepositTx`). Each returns
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
| `cd contracts/arc && forge test`                                                                                                                      | 91 Solidity tests (unit + fuzz + invariants)                                    |
| `pnpm --filter @hedged/arc test`                                                                                                                      | 11 unit tests (ids, errors, decoding, filter, webhook HMAC, token conservation) |
| `anvil --port 18545 --silent --slots-in-an-epoch 1 --block-time 1 &` then `ANVIL_RPC_URL=http://127.0.0.1:18545 pnpm --filter @hedged/arc test:anvil` | 35 end-to-end checks on a local chain                                           |
| same anvil, then `ANVIL_RPC_URL=http://127.0.0.1:18545 pnpm --filter @hedged/api exec tsx ../../tests/arc/api-workers.e2e.ts`                         | Rachel's real orchestrator + workers driving the Arc escrow (8 checks)          |
