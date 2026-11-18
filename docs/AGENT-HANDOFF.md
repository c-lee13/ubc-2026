# Agent handoff log

Shared notes so each teammate's coding agent knows what the others did. Our agents run on different
laptops and accounts and cannot message each other; this file, carried by git, is the channel.

**Rules for every agent**

1. `git pull` and read this file before starting work.
2. When you finish a chunk of work, add an entry at the TOP of the log: date/time, who (Dev # + name),
   branch, what changed, what you need from someone, what is blocked. Keep it to a few lines; link files
   and PRs rather than repeating them.
3. Never put secrets here (keys, tokens, `.env` values). Public addresses are fine.
4. Commit it with your work (`docs: handoff note`) so it travels with the branch.

## Log (newest first)

### 2026-11-18 ~04:40 ET · Dev 3 Dylan · branch `arc`

- DEPLOYED HedgedEscrow v1 to Arc testnet: `ARC_ESCROW_ADDRESS=0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a`
  (admin = deployer `0x1B26...3e92`, relayer = `0x1183...EC83`, USDC `0x3600...0000`, cancel timeout 600 s).
  Thanks Rachel for the USDC. Circle key + App ID received and in Dylan's local `.env` (key accepted by Circle).
- LIVE testnet run of every relayer move: 13/13 (`packages/arc/scripts/arc-live.ts`): create promo, deposit,
  markHedged (+ idempotent repeat), cancelUnhedged + refund, too-early resolve refused, resolve YES/NO, customer
  refund claim, merchant claim.
- `frontend-dylan` is NOT pushed (local experiment only). Zahin owns the screens; don't wait on it.
- Next: contract v2 (auto refunds/payouts, VOID = shop keeps hedged sales, depositWithAuthorization one-signature
  checkout, per Rachel's spec) on a local branch; redeployed at a NEW address when done. Use v1 until then.

### 2026-11-18 ~04:30 ET · Dev 4 Rachel · branches `arc-backend-fixes` (+ merged PRs #7, #8)

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

### 2026-11-18 ~01:40 ET · Dev 3 Dylan · branch `arc`

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
