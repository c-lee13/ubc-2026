# orchestration/ (Dev 4)

`orchestrator.ts` drives each purchase through the state machine in `docs/workflow.md`, using only
`SolanaServerGateway` (no web3.js / Anchor here) and the read-only Gemini adapter.

| Entry point                                      | When to call                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `handleDeposit(event)`                           | verified `DepositEvent` from `subscribeToDeposits`                        |
| `processPurchase(pda)`                           | advance one purchase (idempotent; safe after restart)                     |
| `resolveDuePromotions()`                         | timer: promos past `deposit_deadline` with an **official** Gemini outcome |
| `handleResolution(event)` / `handleClaim(event)` | resolution / claim subscriptions                                          |
| `reconcilePromotion(id)`                         | timer + on boot: align DB with `listPurchases`, resume mid-flight work    |

`workers.ts` hosts the long-lived work: the three subscriptions (each acked to a checkpoint), a
resolution poll every `RESOLVE_POLL_MS` (default 5 s), and a reconciliation sweep every
`RECONCILE_MS` (default 60 s, plus once at boot). `index.ts` starts it based on `SOLANA_GATEWAY`:

- `none` (default): API only, no workers.
- `fake`: workers on `fake-gateway.ts`, an **in-memory fake** chain. Not Solana; local testing only.
- `arc`: workers on `ArcGateway` (Arc testnet, `packages/arc`), from `ARC_*` (escrow address, relayer
  key path). Same orchestrator; with `QUICKNODE_STREAMS_SECURITY_TOKEN`, the same
  `/webhooks/quicknode` route accepts the Arc Stream (logs filtered to our escrow).
- `real`: workers on Dev 3's `RealSolanaGateway` (Solana Devnet), created by
  `createSolanaGatewayFromEnv` from `SOLANA_*` / `QUICKNODE_*` / `RELAYER_*`. The relayer keypair
  must be `Config.relayer` on-chain. With `QUICKNODE_STREAMS_SECURITY_TOKEN` set, QuickNode Streams
  deliveries are accepted at `POST /webhooks/quicknode` (HMAC-checked over the raw body, then
  re-verified on-chain by the gateway before any handler runs).

## CLAUDE.md §5.1 coverage (simulated hedge; `orchestrator.test.ts`, in-memory store)

Tested: duplicate deposit / restart → one hedge, no re-quote · bounded backoff + jitter, retryable vs
permanent errors · `TX_TIMEOUT` → re-read before resend · filled / partial / failed / voided paths ·
stop new hedges after 70% of the promo's `cancelTimeoutSecs` · on-chain re-check before hedging ·
`HEDGED` only after a `mark_hedged` receipt · customer-cancel race → hedge `VOIDED`, budget released,
no relayer cancel · relayer `cancelUnhedged` only after live exposure is voided · reconciliation
repairs or flags mismatches · resolution only after the deadline and only from
`gemini-official-settlement`.

Not yet verified: the SQL constraints/functions in `supabase/migrations` against a real database
(the tests use `MemoryStore`), and anything against the real gateway / Devnet.
