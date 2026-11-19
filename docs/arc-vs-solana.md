# Arc vs Solana (branch `arc`)

Status: experimental branch. The Solana version (Anchor program + `@hedged/solana`) is unchanged
and stays the fallback; nothing on `main` changes until the team picks a chain.

## What changed

- `contracts/arc/`: `HedgedEscrow.sol`, a one-to-one Solidity port of `programs/escrow` (same 12
  operations, states, pause matrix, errors, events). 91 Foundry tests (v2 on branch
  `arc-contract-v2`: auto payouts, VOID, one-signature checkout; 120 tests; see packages/arc/README).
- `packages/arc/`: the Arc twin of `packages/solana` (browser-safe SDK + server `ArcGateway`
  implementing the same `SolanaServerGateway`, QuickNode Streams filter + webhook, scripts).
- `apps/api` (Rachel's path, needs her review): `SOLANA_GATEWAY=arc` accepted in `config.ts`, and
  `index.ts` picks `await createArcGatewayFromEnv()`; `@hedged/arc` added to its dependencies.
- `tests/arc/api-workers.e2e.ts`: Rachel's real orchestrator + workers drive the Arc escrow on anvil.
- Not changed: `CLAUDE.md` still says "Solana Devnet only / no EVM code". If the team adopts Arc,
  that section needs a deliberate update.

## What Rachel changes (backend)

Nothing else. Set the env and switch: `SOLANA_GATEWAY=arc`, `ARC_ESCROW_ADDRESS`,
`ARC_RELAYER_KEY_PATH` (and optionally `ARC_EVENT_SOURCE=streams` + `QUICKNODE_STREAMS_SECURITY_TOKEN`
with a `/webhooks/quicknode` route calling `handleArcStreamsWebhook`). Ids are `0x` bytes32 strings
where Solana had base58 PDAs; her code treats them as opaque strings already. Verified: her workers
hedge, cancel + refund, resolve and record claims against the Arc gateway (8/8 checks).

## What Zahin changes (frontend)

- Wallet: an EVM wallet instead of the Solana wallet adapter. viem/wagmi ship Arc testnet as
  `arcTestnet`; use RainbowKit/ConnectKit/Reown or plain injected (MetaMask) on chain 5042002.
- Transactions: `@hedged/arc` builders return `{ to, data, value }`; deposit is two steps
  (`buildDepositFlow`: approve, then deposit). Reads: `getPromoState`, `getPurchaseState`, `listPurchases`.
- Ids: `promoIdOf(merchant, nonce)`, `purchaseKeyOf(promoId, customer, purchaseIdHex)`.
- Amounts: same 6-decimal base units (5 USDC = `5_000_000n`).

## Honest comparison

|                          | Solana                                            | Arc                                                                                                      |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Prize (chain award)      | $1,500 per track                                  | $1,000 per track                                                                                         |
| Competition              | likely more Solana teams                          | likely fewer Arc teams (unknown)                                                                         |
| Money in the demo        | mock SPL token                                    | real testnet USDC (the stablecoin itself)                                                                |
| Fees                     | SOL, about $0.0005/tx on mainnet, free test SOL   | USDC, about $0.0025/tx at today's 25 gwei, free test USDC                                                |
| Judges' Arc criteria     | n/a                                               | "payment apps that use USDC as gas", "fees and balances simple and stable": a USDC escrow fits directly  |
| Judges' Solana criteria  | Anchor, SPL tokens, Solana wallets: fits directly | n/a                                                                                                      |
| QuickNode Streams bounty | supported (`solana-devnet`)                       | supported (`arc-testnet`)                                                                                |
| Risk                     | built, tested, Caedy's contract live on Devnet    | built and tested locally; NOT deployed: needs USDC from the captcha faucet; frontend must switch wallets |

Neither "no gas" claim holds: both chains charge tiny fees and both are free on test networks.
