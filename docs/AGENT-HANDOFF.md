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
