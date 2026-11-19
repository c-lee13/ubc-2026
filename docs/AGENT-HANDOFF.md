# Agent handoff log

Shared notes so each teammate's coding agent knows what the others did. Our agents run on different
laptops and accounts and cannot message each other; this file, carried by git, is the channel.

**Rules for every agent**

1. `git pull` and read this file before starting work.
2. When you finish a chunk of work, add an entry at the TOP of the log: date and real time (run `date`, Eastern), who (Dev # + name),
   branch, what changed, what you need from someone, what is blocked. Keep it to a few lines; link files
   and PRs rather than repeating them.
3. Never put secrets here (keys, tokens, `.env` values). Public addresses are fine.
4. Commit it with your work (`docs: handoff note`) so it travels with the branch.

## Log (newest first)

### 2026-11-18 20:46 ET · Dev 3 Dylan (Claude) · branch `wincentive-redesign` (from `arc-frontend-test`)

- Frontend redesign per `frontend-feedback-2026-11-18.md`. Look = Dylan's dark prototype
  (`frontend-prototype-unsteered`: purple-black, wide Archivo, pink odds, cream buttons, the price-tag
  voucher and guilloche seal, ribbon receipt header, counter layout), less funky, normal app flow. All
  wiring from `arc-frontend-test` kept (`lib/api.ts`, `lib/wallet/*`, one-tap v2 + approve-deposit v1,
  claim/cancel fallbacks, publish, counter feed, routes). Not pushed.
- Customer: first-open role choice; tabs Coupons (rotating hero line, Ending soon, By shop, Just paid
  out) and My promos; profile (balance, Add money, Merchant workspace switch, sign out). Card: seal +
  price, odds %, "Free if ...", info icon, coupons left + Selling out, countdown, Buy. Checkout: tag,
  odds, clock, sign in, balance, Add money (amount sheet, then a double-tap pay sheet; behind it
  `POST /api/wallet/faucet`), one-tap pay. Receipt: big order code, live 4-step status, upside-only.
- Shop: workspace (stats, Live/History, Edit, Counter, Collect fallback, drafts), New promo (live card
  preview, game picker + underdog line suggestion, max odds 49% default, coupons + selling-out
  threshold, cost to cover one sale computed as you type), counter (QR, odds, clock, orders, Served).
- Client-side only, no API field yet (needs Rachel if we want it cross-device): role; coupon count and
  selling-out threshold (proposed `promotion.coupons: { total, sold, sellingOutAt }`, the sample server
  sends it); counter "Served" marks. Add money's amount is honored by the fixture only; the real faucet
  drips Circle's fixed amount (limit reached -> faucet.circle.com fallback with the address).
- Preview, no backend: `PORT=4030 node scripts/sample-api.mjs` and
  `NEXT_ALLOWED_DEV_ORIGINS=<lan ip> NEXT_PUBLIC_WALLET_FIXTURE=1 NEXT_PUBLIC_API_URL=http://<lan ip>:4030 next dev -H 0.0.0.0 -p 3030`
  (phone on the same wifi opens `http://<lan ip>:3030`). Sample promos are buyable in fixture mode now.
- Verified: typecheck, lint, format:check, web build; every route at 390px with 0 console errors in
  fixture mode (also over the LAN IP); headless flows: role pick, add money, buy, receipt, My promos,
  shop sign-in, create + publish, edit, customer buys it, counter Served.

### 2026-11-18 19:42 ET · Dev 3 Dylan (Claude) · branch `arc-frontend-test`

- Frontend wired to `docs/FRONTEND-API.md` for the first real test purchase. Looks = Zahin's screens (from
  `zahin-arc`); the redesign comes later from Dylan's feedback. Merged `origin/arc` (958ab10). Not pushed.
- Checkout: `status.checkout === "one-tap"` → `POST /sign` → Circle signs (signature from `sdk.execute`'s
  `result.data.signature`) → `POST /submit` (relayer pays gas, retried on 503) → live receipt. `approve-deposit`
  kept as the v1 fallback. Wired: `initialize` (drafts publish from any browser), counter feed (`orderCode`),
  `GET /api/purchases?customer=` (My purchases), `claim-merchant` (one approval per challenge), `claim-refund`,
  `cancel-expired` (still PROCESSING 10+ min). `autoPayout: true` hides claim buttons; they come back only if a
  payout sits 3+ minutes. Order numbers now match the API's `orderCode` (last 4 chars). VOID not handled
  (not in `@hedged/shared`).
- Run it (repo root, two terminals). API: `API_PORT=4020 API_CORS_ORIGIN=http://localhost:3020 pnpm dev:api`
  (reads `.env`; the log must say "Arc escrow v2: one-tap checkout and automatic payouts on"). Web: put
  `NEXT_PUBLIC_API_URL=http://localhost:4020`, `NEXT_PUBLIC_CIRCLE_APP_ID=<the Circle App ID>` and
  `NEXT_PUBLIC_ARC_ESCROW_ADDRESS=0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39` in `apps/web/.env.local`, then
  `pnpm --filter @hedged/web exec next dev -p 3020`. CORS: `API_CORS_ORIGIN` is a comma-separated list of exact
  web origins (no trailing slash), e.g. `http://localhost:3020,https://<deployed web>`; every origin the web is
  opened from must be in it. Test purchase: shop logs in at `/merchant/new`, picks a SOL window, publishes (one
  approval); customer opens `/checkout/<id>`, logs in, adds test USDC, pays (one approval), lands on the receipt.
  Only one backend may run the relayer key at a time.
- No-backend preview: `PORT=4021 node scripts/sample-api.mjs` and
  `NEXT_PUBLIC_WALLET_FIXTURE=1 NEXT_PUBLIC_API_URL=http://localhost:4021 pnpm --filter @hedged/web exec next dev -p 3021`.
  Both act like escrow v2; v1 shapes: `SAMPLE_ESCROW=v1`, and `localStorage["hedged:fixture:escrow"]="v1"`.
- Verified: typecheck, lint, format, web build, api tests (94 pass, 1 skipped). Real API + web: every route
  renders with no console errors (only expected 404s while a made-up receipt polls); email login reaches Circle's
  code screen (SMTP works now). Not done: a real paid purchase (needs a person to type the email code; no v2
  promo is live, the two live promos are old Solana ones). Fixture run: 2 publishes, one-tap pay, v1 pay,
  counter, My purchases, YES (v1 claim + v2 auto refund), NO (shop collect), 0 console errors.

### 2026-11-18 13:45 ET · Dev 4 Rachel · branch `arc-v2-api`

- API now uses escrow v2 when `ARC_ESCROW_ADDRESS` is v2 and `SOLANA_GATEWAY=arc` (detected at startup, logged):
  one-tap checkout `POST /api/checkout/:promoId/sign` -> `sdk.execute` -> `POST /api/checkout/:promoId/submit`
  (relayer submits `depositWithAuthorization`, pays gas); automatic payouts after a relayer cancel and after
  resolution (`settlePurchase` / `settlePromotion`), retried by the sweep until every purchase is paid.
- Frontend reads `status.checkout` ("one-tap" | "approve-deposit") and `autoPayout` on receipts/lists; v1 claim
  routes stay as fallbacks. `docs/FRONTEND-API.md` updated.
- Dylan: switch the demo backend's `ARC_ESCROW_ADDRESS` to v2 `0xc7fe...4a39` after this merges; promos published
  on v1 stay on v1 (create new ones on v2).
- Not done: VOID (needs `@hedged/shared` changes, owners' review); never triggered by the backend today.
  Not yet run end-to-end on testnet: Circle typed-data signing needs a real browser login.

### 2026-11-18 13:18 ET · Dev 4 Rachel · branch `arc-frontend-api`

- Added every route the new frontend needs (all via Circle challenges, contract v1): `POST /api/promotions/:id/initialize`
  (shop publishes a draft), `GET /api/promotions/:id/purchases` (counter feed, with `orderCode`), `GET /api/purchases?customer=`,
  `POST /api/purchases/:key/claim-refund`, `POST /api/purchases/:key/cancel-expired`, `POST /api/purchases/claim-merchant`.
- `API_CORS_ORIGIN` now takes a comma-separated list (add the deployed web origin there).
- New `docs/FRONTEND-API.md`: the one reference for building the frontend (login, shop/counter/customer flows, shapes,
  errors, env). Build against the real API, not `scripts/sample-api.mjs`.
- New optional migration `20261119000000_purchases_by_customer.sql` (index). Tests: api 89 pass, Supabase store contract pass.
- Still open: Circle SMTP for email codes (Rachel); v2 integration once `arc-contract-v2` is pushed (Dylan).

### 2026-11-18 11:52 EST · Dev 3 Dylan (Claude) · branch `zahin-arc`

- Zahin's screens on the prototype's Arc + Circle wiring, for Zahin to review; not merged. Base:
  `frontend-prototype-unsteered`; design from `origin/zahin` (1bf6035). No Solana code left in apps/web.
- Live-wired: home preview (selling promo, else Zahin's sample), `/checkout/[promoId]` (email login, approve +
  deposit), `/purchases/[key]` (live receipt, refund claim), `/merchant` (dashboard), `/merchant/new` (market
  picker, live quote, publish), `/merchant/claims` (settlements, merchant claim). Kept and restyled: `/discover`,
  `/me`, `/counter/[promoId]`. No-backend mode is still `NEXT_PUBLIC_WALLET_FIXTURE=1`.
- Needs from Dev 4 (backend routes missing; the UI calls them and says "not on this server yet" on 404):
  - `POST /api/promotions/:id/initialize` (shop approves creating the promo on Arc)
  - `GET /api/promotions/:id/purchases` (claims page, counter feed; falls back to Arc reads if
    `NEXT_PUBLIC_ARC_ESCROW_ADDRESS` is set)
  - `POST /api/purchases/:id/claim-refund` and `POST /api/purchases/claim-merchant`
  - No promo name/description fields on the API, so the shop name and item stand in for them.
- Checked: web typecheck, repo lint, format, `next build`; every route 200; headless fixture run (publish, pay,
  receipt, NO resolution, merchant claim) with 0 console errors.

### 2026-11-18 04:56 ET · Dev 3 Dylan · branches `frontend-prototype-unsteered`, `arc-contract-v2`

- Frontend PROTOTYPE, built by Dylan's Claude with zero human steering, so treat it as a rough reference, not a
  replacement for Zahin's screens. Branch `frontend-prototype-unsteered` (pushed, will not be merged unless the team
  wants it). Wincentive brand + logo, phone-first, installable to the home screen, Circle email login per
  `docs/email-wallets.md`; shop portal, counter screen, Discover, checkout, receipt, My promos. Take any pieces.
- Found while building it: Circle email-login answers "SMTP server configuration is not found", so email codes need
  SMTP set in Circle's developer console (Rachel). Routes the UI wanted that don't exist yet:
  `POST /api/promotions/:id/initialize`, `GET /api/promotions/:id/purchases`, `POST /api/purchases/:key/claim-refund`,
  `POST /api/purchases/claim-merchant`, `POST /api/purchases/:key/cancel-expired`, `GET /api/purchases?customer=`.
- Contract v2 (auto payouts, VOID = shop keeps hedged sales, one-signature `depositWithAuthorization`) is DEPLOYED on
  Arc testnet at `0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39`, live check 22/22. Code on `arc-contract-v2`, PR coming;
  keep using v1 `0x6032...c82a` until that PR lands, since the v2 calls need its `@hedged/arc` package.

### 2026-11-18 03:50 ET · Dev 3 Dylan · branch `arc`

- DEPLOYED HedgedEscrow v1 to Arc testnet: `ARC_ESCROW_ADDRESS=0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a`
  (admin = deployer `0x1B26...3e92`, relayer = `0x1183...EC83`, USDC `0x3600...0000`, cancel timeout 600 s).
  Thanks Rachel for the USDC. Circle key + App ID received and in Dylan's local `.env` (key accepted by Circle).
- LIVE testnet run of every relayer move: 13/13 (`packages/arc/scripts/arc-live.ts`): create promo, deposit,
  markHedged (+ idempotent repeat), cancelUnhedged + refund, too-early resolve refused, resolve YES/NO, customer
  refund claim, merchant claim.
- `frontend-dylan` is NOT pushed (local experiment only). Zahin owns the screens; don't wait on it.
- Next: contract v2 (auto refunds/payouts, VOID = shop keeps hedged sales, depositWithAuthorization one-signature
  checkout, per Rachel's spec) on a local branch; redeployed at a NEW address when done. Use v1 until then.

### 2026-11-18 03:44 ET · Dev 4 Rachel · branches `arc-backend-fixes` (+ merged PRs #7, #8)

- Merged into `arc`: #7 (REST routes accept Arc `0x` ids, lowercase-stored; `/webhooks/quicknode` serves
  the Arc Stream; arc startup/shutdown cleanup) and #8 (Circle email-login wallets + Arc checkout:
  `/api/wallet/*`, `/api/checkout/:promoId/{status,approve,deposit}`; guide `docs/email-wallets.md`).
- `arc-backend-fixes`: public responses hide each shop's max cost and budget (owner view on the
  dashboard via the shop's Circle login); 2-cent buy buffer (`PRICE_NEAR_THRESHOLD`);
  `GET /api/desk/demo` (two-shop netting on a real game, live prices, nothing stored).
- Done for Dylan: 20 testnet USDC sent to deployer `0x1B26F37e79c16167a8EAc4bc4c2a1bFb93753e92` and
  relayer `0x118318601ff299f6aAA8839B765d5Ca1bFD2EC83`. Circle key + App ID sent to Dylan by DM.
- Needs: Dylan: deploy escrow and post `ARC_ESCROW_ADDRESS` here. Zahin: check `frontend-dylan`
  before building screens. Anyone on the demo backend: `CIRCLE_*` and `ARC_ESCROW_ADDRESS` in `.env`.
- Tests: api 84, supabase 12, solana 23, arc 11; lint, typecheck, builds. Not run here: forge/anvil.

### 2026-11-18 03:32 ET · Dev 3 Dylan · branch `arc`

- Done: Arc escrow contract + `@hedged/arc` gateway (forge 91/91, anvil e2e 35/35, api workers on Arc
  8/8). Merged main into `arc` before Rachel's PRs #7/#8.
- Solana side also verified LIVE on Devnet with Caedy's relayer key: every relayer move 14/14 (markHedged,
  cancelUnhedged, resolve YES/NO, idempotent repeats, refund + merchant claim). Usable as a fallback.
- In progress: Dev 1-style frontend on branch `frontend-dylan` (rebased on `arc`), following
  `docs/email-wallets.md` (Circle email login + Arc checkout). Local only (not pushed).
- Arc deploy: waiting on testnet USDC from faucet.circle.com to deployer
  `0x1B26F37e79c16167a8EAc4bc4c2a1bFb93753e92`. Arc relayer `0x118318601ff299f6aAA8839B765d5Ca1bFD2EC83`
  (key on Dylan's Mac, which runs the demo backend). After deploy: contract address goes here.
- Needs: Circle App ID (`NEXT_PUBLIC_CIRCLE_APP_ID`) and the server Circle key on whichever machine runs
  the demo backend (Rachel has them).
