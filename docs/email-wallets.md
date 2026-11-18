# Email-login wallets + Arc checkout (frontend guide)

Customers and shops log in with an email code; Circle creates an Arc wallet behind the scenes. The
backend holds the Circle API key; the browser only holds Circle's per-user `userToken`, sent to our
API as the `X-User-Token` header. Every money-moving step returns a Circle `challengeId` that the
user approves in Circle's SDK UI (`sdk.execute`). Nothing is signed by our server.

Web SDK: Circle's user-controlled wallets web SDK (`W3SSdk`). App ID: `NEXT_PUBLIC_CIRCLE_APP_ID`.

## Login (first visit)

1. `deviceId = await sdk.getDeviceId()` (cache it in localStorage).
2. `POST /api/wallet/email-login` `{ email, deviceId }` → `{ appId, deviceToken, deviceEncryptionKey, otpToken }`.
3. `sdk.updateConfigs({ appSettings: { appId }, loginConfigs: { deviceToken, deviceEncryptionKey, otpToken, email: { email } } })`, then `sdk.verifyOtp()`.
   Circle shows the code screen; on success the login callback gives `{ userToken, encryptionKey }`.
4. `sdk.setAuthentication({ userToken, encryptionKey })`.
5. `POST /api/wallet/init` → `{ challengeId }` → `sdk.execute(challengeId)` (creates the Arc wallet),
   or `{ alreadyInitialized: true }` for returning users.
6. `GET /api/wallet` → `{ wallets: [{ id, address, blockchain, usdcBalance }] }` (6-decimal base units).

## Checkout (customer at the counter)

1. `GET /api/checkout/:promoId/status?walletId=…` → `{ canBuy, pauseReason, price, usdcBalance, enoughBalance, needsApproval }`.
   Disable the pay button unless `canBuy && enoughBalance`.
2. If `needsApproval` (first purchase only): `POST /api/checkout/:promoId/approve` `{ walletId }` →
   `sdk.execute(challengeId)`, then poll `status` until `needsApproval` is false (a few seconds).
   The approval covers up to $100, so later purchases skip this step.
3. `POST /api/checkout/:promoId/deposit` `{ walletId }` → `{ challengeId, purchaseKey, receipt }` →
   `sdk.execute(challengeId)`.
4. Poll `GET /api/purchases/<purchaseKey>` until `step` is `HEDGED` (`canServe: true`), or
   `REFUNDING` / `REFUND_READY` if the hedge failed. The counter screen shows the same order.

## Test USDC

`POST /api/wallet/faucet` `{ walletId }` asks Circle's faucet for testnet USDC. Circle limits this
(about once a day per wallet) and may refuse accounts that are not upgraded: on
`502 faucet_unavailable`, use https://faucet.circle.com (Arc Testnet) with the wallet address.

## Errors

`401 login_required` (no token) · `401 circle_session_invalid` (log in again) · `409 approval_needed` /
`insufficient_usdc` / `promo_not_buyable` (+ `pauseReason`) / `not_an_arc_promotion` · `404
wallet_not_found` (the wallet isn't this user's) · `503 wallets_disabled` (server not configured).
