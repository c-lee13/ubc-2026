# Frontend API reference (Arc + email login)

Everything a frontend needs is served by `apps/api` on branch `arc`. The browser never builds or
signs a transaction itself: every step that moves money returns a Circle `challengeId`, and the
user approves it in Circle's web SDK (`sdk.execute(challengeId)`). Use this API directly; do not
build against `scripts/sample-api.mjs`, which is a hand-written fake and will drift.

- Base URL: `NEXT_PUBLIC_API_URL` (local: `http://localhost:4000`).
- Money: strings of USDC base units, 6 decimals (`"5000000"` = $5.00). Prices: micro-USD strings
  (`"340000"` = $0.34 = 34% implied chance).
- Ids: wallets are `0x` 20-byte addresses; promo ids on chain (`promoPda`) and purchase keys
  (`purchasePda` / `purchaseKey`) are `0x` bytes32. The API returns them in lowercase and accepts
  any case. `promotion.id` (a UUID) is the database id used in URLs like `/api/promotions/:id`.
- Hedges are **simulated** (read-only Gemini prices, no orders placed). Show that wherever hedge
  numbers appear; responses carry `simulated: true`.

## Login and the `X-User-Token` header

Routes marked 🔑 need `X-User-Token: <userToken>` (Circle's per-user session token from the SDK).
The API key stays on the server.

1. `deviceId = await sdk.getDeviceId()` (cache it).
2. `POST /api/wallet/email-login` `{ email, deviceId }` → `{ appId, deviceToken, deviceEncryptionKey, otpToken }`.
3. `sdk.updateConfigs({ appSettings: { appId }, loginConfigs: { deviceToken, deviceEncryptionKey, otpToken, email: { email } } })`,
   then `sdk.verifyOtp()`. Circle shows the code screen; its callback gives `{ userToken, encryptionKey }`.
4. `sdk.setAuthentication({ userToken, encryptionKey })`.
5. 🔑 `POST /api/wallet/init` → `{ challengeId }` (new user: `sdk.execute` creates the wallet) or
   `{ alreadyInitialized: true }`.
6. 🔑 `GET /api/wallet` → `{ wallets: [{ id, address, blockchain: "ARC-TESTNET", usdcBalance }] }`.
   `walletId` below is `wallets[0].id`; `address` is the shop's `merchant` / the customer's address.

The same login works for shops and customers; the role is just which screens they use.
`401 circle_session_invalid` on any 🔑 route means the token expired: log in again.

## Shop flows

### Create and publish a promo

1. Pick a market (all read-only, no login):
   - `GET /api/events/:ticker/lines?team=Texas&refundAmount=5000000&maxCostBps=4000` → every open
     line for a game priced per sale, plus `suggested` (the likeliest line under the shop's max cost).
   - `GET /api/markets?search=&category=&limit=&offset=` → browse; `GET /api/markets/:id/quote?refundAmount=5000000`
     → live quote and a simulated per-sale cost (`estimate`).
   - `GET /api/markets/:id/deadline-check?depositDeadline=<unix>` → `{ ok, latest, reason? }`: the
     sales deadline must be before kickoff.
2. `POST /api/promotions` `{ merchant: <wallet address>, shopName, location?, itemName, geminiMarketId,
outcomeLabel?, offerAmount, depositDeadline, maxYesPriceMicroUsd, hedgeBudget, coupons? }` → `201 { promotion }`
   (status `DRAFT`). `coupons` is optional: how many the shop offers, a whole number 1-100,000; leave
   it out for no limit. `400` names the bad field; `422 invalid_deposit_deadline` with `latest`.
3. 🔑 `POST /api/promotions/:id/initialize` `{ walletId }` → `{ challengeId, promoPda, confirm }`.
   `sdk.execute(challengeId)`.
4. `POST /api/promotions/:id/confirm` `{ promoPda }` → `{ promotion }` (status `ACTIVE`). Retry every
   ~2 s while it returns `409 promo_not_found_on_chain_yet` (the transaction is still landing).

Errors on initialize: `403 not_this_shops_wallet`, `409 already_published`, `409 deadline_passed`.

### Dashboard

`GET /api/merchants/:address/dashboard` (send `X-User-Token` if logged in) →
`{ merchant, viewer: "owner" | "public", simulatedHedges: true, promotions: [promotion + stats] }`.
`stats`: `purchases`, `hedged`, `refundedOrCancelled`, `hedgedSales`, `contracts`, `premium`,
`ifYes`, `ifNo` (what the shop keeps under each result). The shop's own max cost and budget
(`maxYesPriceMicroUsd`, `hedgeBudget`, `live.thresholdBps`, `live.budgetRemaining`) appear only when
`viewer` is `"owner"`.

### Counter screen

`GET /api/promotions/:id/purchases` → `{ promotionId, purchases: [summary] }`, newest first (max 50).
Poll every few seconds. Hand over the item only when `canServe` is true. `orderCode` (4 characters)
is also on the customer's receipt, so staff can match the two.

### Collect payments after a NO result (fallback)

With `autoPayout: true` this happens automatically; this route is the manual fallback (and the
only way on escrow v1).

🔑 `POST /api/purchases/claim-merchant` `{ walletId, purchaseKeys: [...] }` (1–20 keys, from the
counter feed where `onChainState` is `"Hedged"`) → `{ challenges: [{ purchaseKey, challengeId }] }`.
Run `sdk.execute` for each. Every key is checked before any challenge is created:
`403 not_this_shops_purchase`, `404 purchase_not_found`, `409 nothing_to_collect` (not resolved NO
yet, or already collected).

## Customer flows

### Browse

- `GET /api/promotions` → `{ promotions }`: every ACTIVE promo, selling ones first.
- `GET /api/promotions/:id` → `{ promotion }` (link a shop's QR code here).

### Checkout

1. 🔑 `GET /api/checkout/:promoId/status?walletId=…` → `{ promoId, price, canBuy, pauseReason,
usdcBalance, enoughBalance, checkout, needsApproval }`. Enable "Pay" only if
   `canBuy && enoughBalance`. `checkout` says which flow to run.

**`checkout: "one-tap"` (escrow v2, the demo setup): one approval, no gas for the customer.**

2. 🔑 `POST /api/checkout/:promoId/sign` `{ walletId }` → `{ step: "sign", challengeId,
purchaseIdHex, purchaseKey, validBefore, submit }`. Run
   `sdk.execute(challengeId, (err, result) => …)`: Circle shows "Pay $5.00 for Latte" and the
   callback's `result.data.signature` is the signature.
3. 🔑 `POST {submit}` (= `/api/checkout/:promoId/submit`) `{ walletId, purchaseIdHex, validBefore,
signature }` → `{ step: "submitted", purchaseKey, receipt, txHash }`. Our relayer sends the
   payment on-chain and pays the gas; this call returns once it has landed (a few seconds).
   The signature is valid for 5 minutes and only for this promo, customer, purchase id and price.

**`checkout: "approve-deposit"` (escrow v1): kept as the fallback.**

2. If `needsApproval` (first purchase only): 🔑 `POST /api/checkout/:promoId/approve` `{ walletId }` →
   `{ step: "approve", challengeId, allowance }` → `sdk.execute`, then poll `status` until
   `needsApproval` is false. It allows up to $100, so later purchases are one approval.
3. 🔑 `POST /api/checkout/:promoId/deposit` `{ walletId }` → `{ challengeId, purchaseIdHex,
purchaseKey, receipt }` → `sdk.execute`.

**Both:** 4. Poll `GET {receipt}` (= `/api/purchases/:purchaseKey`) until `step` leaves `PROCESSING`.
It can return `404` for a few seconds until the payment is seen; keep polling.

Errors: `409 promo_not_buyable` (+ `pauseReason`; the price can move between sign and submit, in
which case nothing is paid), `409 insufficient_usdc`, `409 signature_expired` (sign again),
`409 deposit_rejected` (chain refused the signature; nothing was taken), `503 relayer_unavailable`
(retry submit with the same body), `409 one_tap_unavailable` (use approve-deposit),
`409 approval_needed`, `409 already_approved`, `404 wallet_not_found`, `409 not_an_arc_promotion`.

### Receipt and "my purchases"

- `GET /api/purchases/:purchaseKey` → `{ purchasePda, orderCode, customer, amount, status,
onChainState, step, canServe, message, promotion, hedge, transactions }`. `hedge` is the simulated
  hedge (`contracts`, `avgFillPriceMicroUsd`, `premium`, `fingerprint`) or null.
- `GET /api/purchases?customer=<address>` → `{ customer, purchases: [summary + promotion] }`, newest
  first (max 50).

### Getting money back

Every receipt and list row has `autoPayout`.

- **`autoPayout: true` (escrow v2):** refunds and YES payouts are sent automatically; shops are paid
  automatically after a NO result. Show the `message` ("Your refund is on its way.") and no claim
  button. Only if a purchase sits at `REFUND_READY` / `YOU_WON` for more than a few minutes, offer the
  claim buttons below as a fallback.
- **`autoPayout: false` (escrow v1):** show the button from the receipt's `step`:

| `step`                   | Button                | Call (🔑, body `{ walletId }`)            |
| ------------------------ | --------------------- | ----------------------------------------- |
| `REFUND_READY`           | Claim refund          | `POST /api/purchases/:key/claim-refund`   |
| `YOU_WON`                | Claim your money back | `POST /api/purchases/:key/claim-refund`   |
| `PROCESSING` for 10+ min | Cancel and get refund | `POST /api/purchases/:key/cancel-expired` |

Each returns `{ challengeId, purchaseKey }` → `sdk.execute`. Errors: `403 not_your_purchase`,
`409 nothing_to_claim` / `409 not_cancellable` (+ `onChainState`). The cancel timeout is 600 s
after payment; before that the contract rejects the cancel.

### Test USDC

🔑 `POST /api/wallet/faucet` `{ walletId }`. On `502 faucet_unavailable`, send the user to
https://faucet.circle.com (Arc Testnet) with their address.

## Shapes

**promotion** (public): `{ id, status: "DRAFT" | "ACTIVE", promoPda, shop: { merchant, name, location },
itemName, offerAmount, outcomeLabel, geminiMarketId, depositDeadline, onChainState, coupons, live }`.
`coupons` is `{ total, sold }` when the shop set a count, else null. `sold` leaves out refunded and
cancelled purchases, so a refund gives a coupon back. Public: every phone can show "64 left".
`live` is null for drafts, else `{ phase, pauseReason, canBuy, liveAskMicroUsd, costPerSale }`.

- `phase`: `LIVE` (selling) · `PAUSED` · `WAITING_FOR_RESULT` (deadline passed) · `RESULT_YES` · `RESULT_NO`.
- `pauseReason`: `PRICE_ABOVE_THRESHOLD` · `PRICE_NEAR_THRESHOLD` (within 2¢ of the shop's max) ·
  `BUDGET_USED` · `SOLD_OUT` (every coupon sold; show it like `BUDGET_USED`) · `NO_LIVE_PRICE` · null.
- `liveAskMicroUsd` is the market's implied chance the item ends up free.

**purchase summary** (lists): `{ purchasePda, orderCode, customer, amount, depositedAt, status,
onChainState, step, canServe, message, autoPayout, receipt }`.

- `step`: `PROCESSING` · `HEDGED` · `REFUNDING` · `REFUND_READY` · `REFUNDED` · `WAITING_FOR_RESULT`
  · `YOU_WON` · `NOT_THIS_TIME` · `DONE`. `message` is ready-to-show customer copy.
- `onChainState`: `Deposited` · `Hedged` · `Cancelled` · `Refunded` · `ClaimedByCustomer` · `ClaimedByMerchant`.

**Common errors:** `401 login_required` · `401 circle_session_invalid` · `429` (write rate limit) ·
`503 wallets_disabled` (server has no Circle config) · `502/503 circle_error`.

## Extras for the pitch

- `GET /api/desk/demo?event=<moneyline ticker>&a=100&b=60&price=5000000` → what the exposure desk would
  do for two shops on opposite sides of a real game, priced live: `hedgingEverySaleCosts`, `deskBuys`,
  `deskCost`, `savings`, `pnlIfWins`. Nothing stored; `simulated: true`.
- `GET /api/desk` → the live desk across all real promos (simulated).
- `GET /health` → `{ status: "ok" }`.

## Environment

Web (`apps/web/.env.local`): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CIRCLE_APP_ID`.
`NEXT_PUBLIC_ARC_ESCROW_ADDRESS` is only needed for explorer links.

API: `SOLANA_GATEWAY=arc`, `ARC_RPC_URL`, `ARC_ESCROW_ADDRESS`, `ARC_RELAYER_KEY_PATH`,
`CIRCLE_API_KEY`, `CIRCLE_APP_ID`, `API_CORS_ORIGIN` (comma-separated, e.g.
`http://localhost:3000,https://<deployed web origin>`). See `.env.example`.

## Escrow v1 vs v2

The API detects the version of `ARC_ESCROW_ADDRESS` at startup and logs it.

- **v2** (`0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39`), with `SOLANA_GATEWAY=arc` (our relayer):
  `checkout: "one-tap"`, `autoPayout: true`.
- **v1** (`0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a`), or v2 without the relayer:
  `checkout: "approve-deposit"`, `autoPayout: false`.

Build both branches off those two fields and the screens work on either contract.

Not handled yet: a VOID result (game cancelled; the contract pays hedged sales to the shop and
refunds the rest). The backend never resolves a promo as VOID today, so the frontend will not see it.
