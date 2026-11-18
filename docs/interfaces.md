# Interfaces (FINAL for architecture; field-level details change only via PR to this file)

Keep this file, `programs/escrow/src/{state,events}`, `packages/shared`, and CLAUDE.md in sync
(CLAUDE.md §12.8). Lifecycle, state machines and race analysis: [workflow.md](workflow.md).

## 1. Escrow architecture

**One token vault per promotion, one Purchase PDA per deposit.** Funds are pooled; liabilities are
tracked per purchase. Token = mock USD SPL mint, **6 decimals** (`5_000_000` = 5 tokens). All
amounts are `u64` base units with checked arithmetic.

| Account    | Seeds (PDA of the escrow program)                     | Notes                                                            |
| ---------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `Config`   | `["config"]`                                          | admin, relayer (one), mint, `paused`, `cancel_timeout_secs`      |
| `Promo`    | `["promo", merchant, promo_nonce: u64 LE]`            | also the **vault authority** (no separate authority account)     |
| Vault      | ATA(owner = Promo PDA, mint), off-curve owner allowed | the single pooled token account; address stored in `Promo.vault` |
| `Purchase` | `["purchase", promo, customer, purchase_id: [u8;16]]` | `purchase_id` = client-generated UUIDv4 bytes                    |

`purchase_id` is unique per deposit, so one customer can make many purchases; including
`customer` in the seeds stops another wallet squatting someone's id. TS constants: `PDA_SEEDS`
(`@hedged/shared`); helpers: `deriveConfigPda`, `derivePromoPda`, `derivePurchasePda`,
`deriveVaultAddress` (`@hedged/solana`, Dev 3).

**`Promo` fields:** merchant, mint, vault, promo_nonce, offer_amount (every deposit must equal it),
deposit_deadline (i64), market_id (≤ 64 bytes, exact Gemini market), state
(`Active | ResolvedYes | ResolvedNo`), resolved_at, `total_deposited`, `total_paid_out`,
`purchase_count`, bump, `cancel_timeout_secs` (snapshot of `Config.cancel_timeout_secs` at
`initialize_promo`). Max YES price and hedge budget are **off-chain** policy (Dev 4).

**`Config` fields:** admin, relayer, mint, paused, bump, `cancel_timeout_secs` (i64, seconds, admin-set,
valid range 1 s … 30 days; Devnet default **600**). `cancel_timeout_secs` was **appended** to the end of
both `Config` and `Promo`; no existing field moved. Time rules (`i64` unix seconds from the cluster
clock): deposits are accepted only while `now < deposit_deadline`; `resolve_promo` only while
`now >= deposit_deadline` (an exact complement: no overlap, no gap); a customer may cancel a `Deposited`
purchase once `now >= purchase.deposited_at + promo.cancel_timeout_secs` (inclusive).

**`Purchase` fields:** promo, customer, purchase_id, amount, state, deposited_at, hedged_at,
cancelled_at, settled_at, bump. `PurchaseState`: `Deposited | Hedged | Cancelled | Refunded |
ClaimedByCustomer | ClaimedByMerchant`.

**Accounting rules (per-purchase liabilities in a shared vault)**

- `deposit`: `amount == promo.offer_amount`; `total_deposited += amount`; transfer customer token account →
  vault (mint, owner and destination checked).
- Every payout (`claim_refund`, `claim_merchant`) pays **exactly `purchase.amount`** from the vault,
  signed by the Promo PDA, only if the purchase is in the matching un-settled state, and moves it to
  a terminal state in the same instruction; `total_paid_out += amount`. A purchase can therefore
  never take more than its own `amount`, and only once (terminal states are one-way).
- Invariants: `total_paid_out ≤ total_deposited`; `vault balance ≥ total_deposited − total_paid_out`
  (equality unless tokens are donated to the vault); Σ amount of non-terminal purchases =
  `total_deposited − total_paid_out`. Admin has **no** withdrawal instruction.
- Purchase accounts are not closed in the MVP (rent reclaim deferred).

## 2. Instructions, authority, and pause (12 instructions)

| Instruction              | Args                                                                                  | Transition                                                                                                          | Signer / authority                                                                                                                      | Pausable?                                     |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `initialize_config`      | `relayer: Pubkey`, `cancel_timeout_secs: i64`                                         | creates Config (mint must have 6 decimals; relayer ≠ all-zero key; timeout in range)                                | **the program's upgrade authority** (deployer) = `Config.admin`, once; extra accounts `program`, `program_data`                         | —                                             |
| `set_paused`             | `paused: bool`                                                                        | toggles `Config.paused`                                                                                             | admin                                                                                                                                   | no                                            |
| `set_relayer`            | `new_relayer: Pubkey`                                                                 | rotates the single relayer key (not all-zero)                                                                       | admin                                                                                                                                   | no                                            |
| `set_cancel_timeout`     | `cancel_timeout_secs: i64`                                                            | sets the timeout for **future** promos (existing promos keep their snapshot)                                        | admin                                                                                                                                   | no                                            |
| `initialize_promo`       | `promo_nonce: u64`, `offer_amount: u64`, `deposit_deadline: i64`, `market_id: String` | creates Promo + vault ATA; snapshots `cancel_timeout_secs`; offer > 0, deadline in the future, market id 1–64 bytes | merchant wallet                                                                                                                         | **blocked**                                   |
| `deposit`                | `purchase_id: [u8;16]`, `amount: u64`                                                 | creates Purchase `Deposited`; `amount == offer_amount`                                                              | customer wallet; promo `Active`; `now < deposit_deadline`                                                                               | **blocked**                                   |
| `mark_hedged`            | —                                                                                     | Purchase `Deposited → Hedged`                                                                                       | relayer; promo `Active`                                                                                                                 | **blocked**                                   |
| `cancel_unhedged`        | —                                                                                     | Purchase `Deposited → Cancelled`                                                                                    | relayer; any promo state                                                                                                                | **allowed**                                   |
| `cancel_expired_deposit` | —                                                                                     | Purchase `Deposited → Cancelled` once `now >= deposited_at + promo.cancel_timeout_secs`; never for `Hedged`         | **`purchase.customer`** only; any promo state                                                                                           | **allowed**                                   |
| `resolve_promo`          | `outcome: Outcome{Yes,No}`                                                            | Promo `Active → ResolvedYes\|ResolvedNo` (once), **only when `now >= deposit_deadline`**                            | relayer                                                                                                                                 | **blocked**                                   |
| `claim_refund`           | —                                                                                     | `Cancelled → Refunded` (any promo state) **or** `Hedged → ClaimedByCustomer` (promo `ResolvedYes`)                  | `purchase.customer`; destination = a token account **owned by the customer**, promo mint (the ATA is the intended choice, not enforced) | cancel path **allowed**, YES path **blocked** |
| `claim_merchant`         | —                                                                                     | `Hedged → ClaimedByMerchant` (promo `ResolvedNo`)                                                                   | `promo.merchant`; destination = a token account **owned by the merchant**, promo mint                                                   | **blocked**                                   |

Accounts, signers and writability of every instruction are listed (generated from the IDL) in
`programs/escrow/docs/INTEGRATION.md`; the committed IDL (`programs/escrow/idl/escrow.json`) is the
source of truth for account order.

Pause rationale: pause stops anything that can open new liabilities or pay merchants/resolve (a
compromised relayer or program bug), while keeping the paths that can only return a purchase's own
funds to its own customer (`cancel_unhedged` / `cancel_expired_deposit` → `claim_refund` cancel path).
The relayer can never redirect funds: cancellation only creates a refund entitlement for
`purchase.customer`, and every payout destination is constrained to the recorded customer/merchant and
the promo's mint. **Hedged purchases are never refunded or cancelled by any timeout**; they wait for
`resolve_promo` (late resolution stays possible).

All privileged instructions are retry-safe: re-sending after the target state holds fails with a
distinct error (`AlreadyHedged`, `AlreadyCancelled`, `AlreadyResolved`, `AlreadyClaimed`) which the
gateway maps to `alreadyApplied` (same outcome) or `INVALID_STATE` (conflicting transition).
`mark_hedged`, `cancel_unhedged` and `cancel_expired_deposit` all require `Deposited`, so exactly one of
them can win a race on one purchase; the loser fails with `InvalidState` (or `AlreadyCancelled` /
`AlreadyHedged` when it is a same-target retry).

**Errors** (Anchor numbering: 6000 + enum order, append-only):

| Code | Name                | Code | Name                                                           |
| ---- | ------------------- | ---- | -------------------------------------------------------------- |
| 6000 | `Unauthorized`      | 6012 | `MarketIdTooLong`                                              |
| 6001 | `Paused`            | 6013 | `MathOverflow`                                                 |
| 6002 | `InvalidState`      | 6014 | `InvalidOfferAmount`                                           |
| 6003 | `WrongMint`         | 6015 | `InvalidDeadline`                                              |
| 6004 | `WrongTokenAccount` | 6016 | `EmptyMarketId`                                                |
| 6005 | `DepositClosed`     | 6017 | `WrongDecimals`                                                |
| 6006 | `WrongAmount`       | 6018 | `InvalidRelayer`                                               |
| 6007 | `PromoNotActive`    | 6019 | `InsufficientVaultFunds`                                       |
| 6008 | `AlreadyResolved`   | 6020 | `ResolutionTooEarly` (retryable once `now ≥ deposit_deadline`) |
| 6009 | `AlreadyHedged`     | 6021 | `TimeoutNotElapsed` (retryable later)                          |
| 6010 | `AlreadyCancelled`  | 6022 | `InvalidTimeout`                                               |
| 6011 | `AlreadyClaimed`    |      |                                                                |

`resolve_promo` checks, in order: relayer authorization (`Unauthorized`) → not paused (`Paused`) →
promo still `Active` (`AlreadyResolved`) → `now ≥ deposit_deadline` (`ResolutionTooEarly`).

## 3. Anchor events

Events are **notifications, not proof of payment**. Dev 3 verifies the finalized transaction
(success, program ID, mint, accounts, amounts) and the resulting account/token state before
delivering anything to Dev 4. Signature, slot, block time and event index are attached
**off-chain** (`ChainPosition`), not stored in payloads. u64 → decimal string in TS; i64 → number.

| Event                    | Emitted by                                        | Fields (Rust types)                                                                                                          |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DepositEvent`           | `deposit`                                         | promo `Pubkey`, purchase `Pubkey`, customer `Pubkey`, purchase_id `[u8;16]`, amount `u64`, deposited_at `i64`                |
| `HedgeMarkedEvent`       | `mark_hedged`                                     | promo, purchase, relayer `Pubkey`, marked_at `i64`                                                                           |
| `PurchaseCancelledEvent` | `cancel_unhedged` **or** `cancel_expired_deposit` | promo, purchase, customer `Pubkey`, amount `u64`, cancelled_at `i64` (same payload for both; only the tx signer differs)     |
| `ResolutionEvent`        | `resolve_promo`                                   | promo `Pubkey`, outcome `Outcome{Yes,No}`, relayer `Pubkey`, resolved_at `i64`                                               |
| `ClaimEvent`             | `claim_refund`, `claim_merchant`                  | promo, purchase, recipient `Pubkey`, amount `u64`, kind `ClaimKind{CancelRefund,YesRefund,MerchantPayout}`, claimed_at `i64` |

Separate `HedgeMarkedEvent` / `PurchaseCancelledEvent` are **kept**: they let the reconciler
and dashboards see relayer actions without diffing accounts. The backend still confirms its own
relayer calls through the gateway receipt, not by waiting for these events.

TS mapping (`@hedged/shared` `events.ts`): each event → interface of the same name
(`extends ChainPosition`), snake_case → camelCase, `Pubkey` → `Base58`, `[u8;16]` →
`PurchaseIdHex` (32 hex chars), `Outcome` → `"YES"|"NO"`, `ClaimKind` → `"CANCEL_REFUND"|…`.
`ProgramEvent` is the discriminated union returned by `verifyTransaction`.

**Dedup id:** `chainEventId = "${signature}:${eventIndex}"` (index among this program's decoded
events in the tx). Backend stores it unique (`depositEventId` is a deprecated alias).

**Finality:** the listener delivers at the configured commitment (MVP: `finalized`, env
`SOLANA_FINALITY`). Nothing is processed from a WebSocket notification alone.

**Missed / duplicated / reordered events**

- Delivery is at-least-once; handlers are idempotent (unique `chainEventId`, state-guarded
  transitions) and **decide from on-chain state** (`getPurchaseState`), never from event order.
- Missed (disconnect/restart): the host persists the last acked slot and resubscribes with
  `fromSlot`; additionally Dev 4 runs a periodic reconciliation with `listPurchases(promo)` /
  `getPromoState` and repairs any purchase whose DB status lags on-chain state.
- Reordered (e.g. `ClaimEvent` before the `DepositEvent` was processed): process by reading the
  account; an event for an unknown purchase triggers a fetch, not a failure.

## 4. `SolanaServerGateway` (`@hedged/shared` `solana-gateway.ts`; implemented by Dev 3)

```ts
interface SolanaServerGateway {
  subscribeToDeposits(
    h: EventHandler<DepositEvent>,
    o?: { fromSlot?: number },
  ): Promise<Unsubscribe>;
  subscribeToResolutions(h: EventHandler<ResolutionEvent>, o?): Promise<Unsubscribe>;
  subscribeToClaims(h: EventHandler<ClaimEvent>, o?): Promise<Unsubscribe>;

  markHedged(purchasePda, opts?: SubmitOptions): Promise<TxReceipt>;
  cancelUnhedged(purchasePda, opts?: SubmitOptions): Promise<TxReceipt>;
  resolvePromotion(promoPda, outcome: "YES" | "NO", opts?: SubmitOptions): Promise<TxReceipt>;

  getConfig(): Promise<OnChainConfig | null>;
  getPromoState(promoPda, commitment?): Promise<OnChainPromoAccount | null>;
  getPurchaseState(purchasePda, commitment?): Promise<OnChainPurchaseAccount | null>;
  listPurchases(promoPda, commitment?): Promise<OnChainPurchaseAccount[]>;
  verifyTransaction(signature, commitment?): Promise<TxVerification>;
}
```

- `TxReceipt { signature: string | null; slot: number | null; commitment; alreadyApplied }`. A
  receipt means the tx reached the commitment **and** the state was re-read and matches. Backend
  marks `HEDGED`/`CANCELLED` only after receiving one.
- `SubmitOptions { commitment?, timeoutMs? }`. The gateway resends only resend-safe failures
  (blockhash expiry, RPC errors) within `timeoutMs`.
- **Errors:** `SolanaGatewayError { code, retryable, signature? }`; codes `RPC_UNAVAILABLE`,
  `TX_TIMEOUT` (outcome unknown: re-read state before retrying), `BLOCKHASH_EXPIRED`,
  `ACCOUNT_NOT_FOUND`, `INVALID_STATE`, `PAUSED`, `NOT_AUTHORIZED`, `VERIFICATION_FAILED`,
  `TX_FAILED`; `GATEWAY_ERROR_RETRYABLE` gives the default retry policy.
- **Idempotency:** same-target-state calls resolve with `alreadyApplied: true`; conflicting
  transitions throw `INVALID_STATE` (e.g. `cancelUnhedged` on a `Hedged` purchase, or
  `resolvePromotion` with a different outcome).
- **Subscriptions:** verified events only, at-least-once, ack by resolving the handler, redelivery
  on throw, `fromSlot` replay; handlers idempotent (see §3).
- **Timing and race errors (see §2):** `resolve_promo` before the deposit deadline fails with
  `ResolutionTooEarly` (6020): not `alreadyApplied` and not `INVALID_STATE`; retryable after the deadline.
  `markHedged` that loses a race to a customer's `cancel_expired_deposit` (or a relayer cancel) fails with
  `InvalidState` (6002) → `INVALID_STATE`: the gateway must **re-read the purchase** and the backend must
  align to chain state (and flag any executed hedge as orphaned exposure, CLAUDE.md §5.1).
- The relayer key is loaded server-side by Dev 3's module (`RELAYER_KEYPAIR_PATH`); Dev 4 only
  calls this interface. Customer/merchant-signed instructions (`deposit`, claims,
  `initialize_promo`) are built by browser-safe helpers in `@hedged/solana` and signed in wallets.
  Dev 4 can only observe claims (`subscribeToClaims`, `verifyTransaction`).

## 5. Browser-safe SDK (`@hedged/solana`, Dev 3 → Dev 1)

`deriveConfigPda`, `derivePromoPda`, `derivePurchasePda`, `deriveVaultAddress`, `getPromoState`,
`getPurchaseState`, `buildInitializePromoTransaction`, `buildDepositTransaction`,
`buildClaimRefundTransaction`, `buildClaimMerchantTransaction`, plus the new
`buildCancelExpiredDepositTransaction` (customer-signed timeout cancel) — stubs at the time of writing
(signatures for PDA helpers/reads are typed). Wallet requirements: customer signs `deposit`,
`cancel_expired_deposit` and `claim_refund` (pays Purchase rent + fees), merchant signs `initialize_promo`
and `claim_merchant`; admin-only instructions (`initialize_config`, `set_paused`, `set_relayer`,
`set_cancel_timeout`) are ops/scripts (`programs/escrow/scripts`), not part of the app SDK;
ATAs must be for the configured mint (6 decimals); the UI generates `purchase_id` (16 random bytes).

## 6. API (apps/api, Dev 4 → Dev 1)

**Chain ids:** the API accepts Solana (base58 public keys / PDAs) or Arc (`0x` 20-byte addresses for
wallets, `0x` bytes32 for promo/purchase ids). `0x` values are stored and compared in lowercase.

Live (read-only Gemini, no credentials needed). `:id` is a Gemini contract `instrumentSymbol`,
e.g. `GEMI-NCAAF-2611212030-ARK-TEX-M-TEX` (= "Texas" contract of Arkansas vs Texas).

- `GET /api/markets?search=&category=&limit=&offset=` → `{ source, totalEvents, markets: MarketSummary[] }`
- `GET /api/markets/:id/quote?refundAmount=5000000&maxYesPriceMicroUsd=500000` →
  `{ quote: MarketQuote, eventTicker, eventTitle, outcomeLabel, marketState, estimate }`.
  `estimate` is a **simulated** hedge (`simulated: true`) when `refundAmount` is given, else null.
  404 unknown market · 409 market not open · 503 empty book / Gemini unavailable.
- `GET /api/markets/windows?asset=SOL&windowMinutes=5&limit=8` → `{ source, asset, windows: MarketWindow[] }`:
  the next short crypto Up/Down windows (live book, strike once captured, `recommendedDepositDeadline`).
- `GET /api/markets/:id/deadline-check?depositDeadline=<unix>` → `{ marketId, marketKind, ok, latest, reason? }`.
  Call before the merchant signs `initialize_promo`. Up/Down: deadline ≤ window open − 300 s; other
  markets: ≤ event start (kickoff) if Gemini gives one, else ≤ expiry; always ≥ now + 60 s.
- `GET /api/markets/:id/outcome` → `{ marketId, outcome: MarketOutcome | null }`. Only official
  Gemini settlement (`status=settled` + `resolutionSide`); `null` until then.

- `GET /api/events/:ticker/lines?team=Texas&refundAmount=5000000&maxCostBps=4000` → every open line
  for a game priced per sale (simulated hedge vs live book) and `suggested`: the most likely line that
  fits the shop's threshold (`maxCostBps` = max hedge cost as a share of the item price).

**Promotions** (create flow: draft → merchant wallet signs `initialize_promo` → confirm):

- `POST /api/promotions` `{ merchant, shopName, location?, itemName, geminiMarketId, outcomeLabel?,
offerAmount, depositDeadline, maxYesPriceMicroUsd, hedgeBudget }` → 201
  `{ promotion (DRAFT), initializePromo: { promoNonce, offerAmount, depositDeadline, marketId } }`.
  422 if the deadline is unsafe (sports: after kickoff).
- `POST /api/promotions/:id/confirm` `{ promoPda }` → reads the promo from chain; ACTIVE only if
  merchant, nonce, price, deadline, market match (409 `mismatches` otherwise; 503 with no gateway).
- `GET /api/promotions` → public directory of ACTIVE promos with shop name and `live`
  (`phase` LIVE | PAUSED | WAITING_FOR_RESULT | RESULT_YES | RESULT_NO, `pauseReason`, `canBuy`,
  `liveAskMicroUsd`, `costPerSale`, `thresholdBps`, `budgetRemaining`). LIVE first.
- `GET /api/promotions/:id` → one promo; checkout calls this and only takes payment if `live.canBuy`.
- `GET /api/merchants/:pubkey/dashboard` → shop profile + all its promos (drafts too) with `stats`
  (purchases, hedged, refunded, contracts, premium, `ifYes` / `ifNo` amounts kept). Simulated.

No login in the MVP: drafts are harmless until the merchant's own wallet signs `initialize_promo`,
and dashboard data is derivable from public chain data and public Gemini prices.

- `GET /api/desk` → exposure desk (simulated): per Gemini event, `exclusive` (full-game moneyline),
  per-contract `liability` / `target` / `position` / `gap`, `certainLiability` (netted, paid from
  premiums), `premiumsCollected`, `deskCost`, `savings`, `pnlIfWins` per side and `covered`.
  See `apps/api/src/desk/README.md`. 503 when the desk is off.
- `POST /webhooks/quicknode` → QuickNode Streams destination (only with `SOLANA_GATEWAY=real` and
  `QUICKNODE_STREAMS_SECURITY_TOKEN`; 503 otherwise). `X-QN-Signature` HMAC over the raw body, stale
  timestamps rejected, gzip accepted; signatures go to the gateway for on-chain verification.
- **Email-login wallets + Arc checkout** (Circle; `X-User-Token` header): `POST /api/wallet/email-login`,
  `POST /api/wallet/init`, `GET /api/wallet`, `GET /api/checkout/:promoId/status`,
  `POST /api/checkout/:promoId/approve`, `POST /api/checkout/:promoId/deposit`, `POST /api/wallet/faucet`.
  Flow and errors: `docs/email-wallets.md`.
- `GET /api/purchases/:purchasePda` → customer receipt / barista screen: off-chain `status` and
  on-chain `onChainState` side by side, `step` (PROCESSING | HEDGED | REFUNDING | REFUND_READY |
  REFUNDED | WAITING_FOR_RESULT | YOU_WON | NOT_THIS_TIME | DONE), `canServe` (hand over the item
  only when true), `message`, promotion summary, the simulated `hedge` with its sha256
  `fingerprint` (recomputable from the hedge fields; proposed to go on-chain with `mark_hedged`),
  and transaction signatures.

Never trust client-submitted `HEDGED`, `REFUNDED`, outcome, or price fields; never return simulated
data as live.

## 7. Shared types (`@hedged/shared`)

`Promotion`, `Purchase`, `Hedge` (always `simulated: true`), `MarketSummary`, `MarketQuote`,
`MarketOutcome`, events (`DepositEvent`, `HedgeMarkedEvent`, `PurchaseCancelledEvent`, `ResolutionEvent`,
`ClaimEvent`, `ProgramEvent`, `ChainPosition`, `chainEventId`), on-chain views (`OnChainConfig`,
`OnChainPromoAccount`, `OnChainPurchaseAccount`), statuses (`OnChainPromoState`,
`OnChainPurchaseState`, `PurchaseStatus`, `HedgeStatus`), `PDA_SEEDS`, `SolanaServerGateway` and
its supporting types. Money: integer base units as decimal strings; prices micro-USD
(`$0.34` = `"340000"`). Gemini contract quantities step by 0.01, so `Hedge.requestedContracts` /
`filledContracts` are decimal strings like `"4.51"`.

## 8. Business rules: decided and still open

**Decided MVP security rules** (record: `programs/escrow/docs/SECURITY.md`, `D2-PROPOSAL.md`):

- **D1** single trusted relayer; no multisig, settlement delay or dispute mechanism; rotation via `set_relayer`.
- **D2 (partial)** customer timeout cancellation for **unhedged** (`Deposited`) purchases only
  (`cancel_expired_deposit`, timeout `Config.cancel_timeout_secs`, Devnet default **600 s**). Hedged
  purchases are **never** refunded or expired by timeout (an on-chain timeout does not prove an off-chain
  hedge was unwound); automatic promo-expiry refunds were **not approved**; late resolution stays possible.
- **D3** existing admin pause unchanged (no auto-expiry/multisig); cancelled-purchase refunds stay allowed.
- **D4** `resolve_promo` only at/after `deposit_deadline`.
- Post-hedge merchandise returns with hedge unwinding: **post-MVP** (CLAUDE.md §14.1), not implemented.

**Still open / accepted limitations:**

1. **Unhedged purchases at resolution.** `resolve_promo` does not touch purchases; a `Deposited` purchase
   can only be cancelled (by the relayer at any time, or by its customer after the timeout) and then
   refunded. It can never be paid to the merchant. (Confirmed default.)
2. **Hedged funds without a resolution.** They stay locked until the relayer calls `resolve_promo`; there is
   no deadline or fallback by decision. Trusted-relayer limitation.
3. **Merchant payout granularity.** `claim_merchant` pays one purchase per call (simple, exact
   accounting); batch claims deferred.
4. Merchant-visible rule "do not fulfill before HEDGED" is enforced off-chain (UI/backend), not by
   the contract.
5. **Off-chain hedge vs. on-chain cancellation race** (CLAUDE.md §6): mitigated only by the pending
   Developer 4 requirements (CLAUDE.md §5.1).
