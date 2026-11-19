# Wincentive: hedged refund promos

A shop runs a promo like "buy a $5 coffee; if Texas wins, it's free." Each sale is hedged on a
Gemini prediction market, so the promo costs the shop a fixed amount (odds × refund) whichever way
the game goes. The customer logs in with an email code, pays once in USDC, and gets the $5 back
automatically if the outcome happens.

Built on **Arc** (Circle's stablecoin L1) with **Circle** email-login wallets, **Gemini** prediction
market data, **QuickNode** (Arc RPC and WebSocket events) and **Supabase**. Hedges are simulated against Gemini's
live order book; no Gemini order is ever placed.

## Live on Arc testnet

| What                | Value                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Escrow (v2)         | [`0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39`](https://explorer.testnet.arc.io/address/0xc7fe8ca11b1b5b2260aa7faa638c0ae233b44a39) |
| USDC                | `0x3600000000000000000000000000000000000000` (Arc's native USDC, ERC-20 interface)                                                 |
| Chain               | id `5042002`, RPC `https://rpc.testnet.arc.io`                                                                                     |
| Retired escrow (v1) | `0x6032a8339ea429f7655a7dcecbfff50ba5d5c82a`                                                                                       |

## How it works

**Customer**

1. Logs in with an email code (Circle user-controlled wallet; no seed phrase, no extension).
2. Pays with one approval: signs a USDC authorization for exactly the promo price. Our relayer
   submits it to the escrow and pays the gas.
3. The backend prices the hedge from Gemini's live order book. If it fits the shop's limits, the
   relayer marks the purchase hedged on-chain and the shop can serve the item. If not, the payment
   is cancelled and refunded automatically.
4. After the market's official Gemini result, the relayer resolves the promo. YES: the customer's
   money is sent back automatically. NO: the shop is paid automatically.

**Shop:** creates a promo (item, price, Gemini market, maximum cost, hedge budget, deposit
deadline), publishes it on-chain from its own wallet, and sees each sale and its hedge on a counter
feed.

**Backend (`apps/api`):** reads Gemini, simulates and records hedges, runs the purchase state
machine and workers, relays on-chain actions, and stores everything in Supabase. It watches the
escrow through a QuickNode Arc testnet endpoint: QuickNode pushes each escrow event over WebSocket as
it lands, a getLogs sweep every 2 s fills any gap, and every event is re-verified over RPC at
`finalized` before the backend acts on it. QuickNode Streams (webhook) is also supported.

## Economic design

**Mechanism.** A promo refunds the purchase price `R` if a specific Gemini market resolves YES. For
each sale the backend sizes a hedge of `R / $1` YES contracts (rounded up to Gemini's 0.01 step) and
prices it against the live ask side of the order book, so the hedge pays exactly `R` if the refund
is owed. If the average fill price is `p`, the promo costs the merchant `C = p × R` per sale, plus
any modelled fees.

**Result for the merchant** (fully hedged, before cost of goods), per $5 sale at `p = $0.34`:

|                       | Outcome YES | Outcome NO |
| --------------------- | ----------- | ---------- |
| Sale (held in escrow) | +$5.00      | +$5.00     |
| Hedge premium         | −$1.70      | −$1.70     |
| Hedge payout          | +$5.00      | $0         |
| Refund to customer    | −$5.00      | $0         |
| **Merchant keeps**    | **$3.30**   | **$3.30**  |

The hedge fixes the promo's cost at `p × R`; it does not make the promo free. `p` is the
market-implied probability of the refund, so the cost behaves like a discount of `p` that the
customer experiences as a chance at a free item.

**Exposure desk (platform level).** Shops pay the live per-sale price, but the platform does not
hedge each sale separately. It nets exposure across all shops per Gemini event: on a game where some
shops promise "free if Texas wins" and others "free if Arkansas wins", the amount owed whichever team
wins is covered by the premiums collected, and only the remainder is hedged, in batches. The
difference is platform revenue (in the tested example: $487 of premiums, $184 of hedging, covered in
both outcomes). See `apps/api/src/desk/README.md`.

**Merchant controls.** A threshold (maximum YES price, i.e. maximum cost as a share of the price),
a total hedge budget, and a deposit deadline. Each sale is priced at the moment it happens; when the
live price is above the threshold or the budget is used up, the promo shows as paused and checkout
does not take payment. The line picker suggests, for a game, the most likely outcome that fits the
threshold (e.g. "wins by 14+" when "wins" is too expensive).

**What is real and what is simulated.** Real: Gemini prices, order books and official settlement
(read-only, public endpoints); escrow payments and payouts on Arc testnet in testnet USDC (no
real value).
Simulated: buying and settling the Gemini contracts, which are recorded in an off-chain ledger and
labelled `simulated: true` everywhere. No Gemini order is ever placed.

### Risks and how the design handles them

| Risk                                               | Handling                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price moves before or during a sale                | Each sale is quoted live; above the merchant's threshold the hedge fails and the deposit is refunded before the item is handed over.                                 |
| Thin order book / partial fill                     | A partial fill is never treated as covered: the simulated fill is released and the customer refunded.                                                                |
| Payment and hedge are not atomic                   | Purchase is `PENDING` until the relayer's "hedged" mark is confirmed on-chain; the item is served only after that (`canServe`). Failures cancel and refund.          |
| Customer self-cancels while the hedge is in flight | New hedges stop at 70% of the on-chain cancel window; if the cancel still wins, the hedge is voided and its budget released.                                         |
| Buying after the outcome is partly known           | Sports promos stop selling at kickoff; 5-minute crypto windows stop 5 minutes before the reference price is captured.                                                |
| Wrong or premature result                          | Only Gemini's official settlement (`resolutionSide`) of the exact market is used; never prices near 0/1 or live scores. Resolution happens once, after the deadline. |
| Cancelled or voided game                           | No automatic resolution; flagged for an operator. (Escrow v2 has a VOID outcome; the backend does not use it yet.)                                                   |
| Budget overrun                                     | Budget is reserved atomically per hedge in the database; a sale that does not fit is refunded.                                                                       |
| Fees and slippage                                  | Fill price walks the visible book; Gemini fees are a configurable parameter (0 = not modelled).                                                                      |
| Trusted relayer                                    | A single backend relayer can resolve and cancel, but funds can only move to the recorded customer or merchant. A decentralised oracle is out of scope.               |

**Production blockers (not solved here):** real execution on Gemini (account, fees, minimum sizes,
liquidity), custody and settlement of real funds, promotional and gaming regulations by
jurisdiction, KYC/AML, and card/fiat checkout.

## Repository

```text
apps/api              Fastify API: Gemini adapter, hedge simulation, orchestrator + workers,
                      Circle wallet routes, Supabase store
apps/web              Next.js web app (mobile-first)
contracts/arc         HedgedEscrow.sol (Solidity, Foundry tests)
packages/arc          Arc SDK + relayer gateway (viem), QuickNode Streams filter and webhook
packages/shared       Shared TypeScript types and the gateway interface
supabase/migrations   PostgreSQL schema
programs/escrow,      Solana version (Anchor program + SDK), kept as a fallback on `main`
packages/solana
docs/                 architecture, interfaces, workflow, frontend API, setup
```

## Quick start

```bash
pnpm install
cp .env.example .env     # fill in; never commit .env
pnpm dev:api             # http://localhost:4000/health
pnpm dev:web             # http://localhost:3000
```

Key settings for the Arc version (`.env.example` documents the rest):

| Variable                                    | Value                                                  |
| ------------------------------------------- | ------------------------------------------------------ |
| `SOLANA_GATEWAY`                            | `arc` (runs the relayer; needs `ARC_RELAYER_KEY_PATH`) |
| `ARC_ESCROW_ADDRESS`                        | the v2 escrow above                                    |
| `CIRCLE_API_KEY`, `CIRCLE_APP_ID`           | Circle testnet key and app id (email login)            |
| `ARC_RPC_URL`, `ARC_WSS_URL`                | QuickNode Arc testnet endpoint (HTTPS and WSS)         |
| `ARC_EVENT_SOURCE`                          | `websocket` (QuickNode push), `poll`, or `streams`     |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project (in-memory store if unset)            |

At startup the API logs which escrow version it found: v2 with the relayer gives one-tap checkout
and automatic payouts; otherwise it falls back to approve + deposit and manual claims.

| Command                             | What it does                 |
| ----------------------------------- | ---------------------------- |
| `pnpm --filter @hedged/api test`    | API tests (in-memory store)  |
| `pnpm --filter @hedged/api test:db` | Store tests against Supabase |
| `pnpm --filter @hedged/arc test`    | Arc SDK tests                |
| `forge test` (in `contracts/arc`)   | Escrow contract tests        |
| `pnpm typecheck` / `pnpm lint`      | Checks across the repo       |

## Not done

- VOID results (game cancelled): the v2 contract supports them; the backend does not resolve VOID yet.
- Real Gemini execution, real funds, KYC/AML and promo regulations (see production blockers above).
- The relayer is a single trusted backend key. It can only send funds to the recorded customer or shop.

Docs: [frontend API](docs/FRONTEND-API.md) · [email wallets](docs/email-wallets.md) ·
[Arc vs Solana](docs/arc-vs-solana.md) · [architecture](docs/architecture.md) ·
[interfaces](docs/interfaces.md) · [workflow](docs/workflow.md) · [setup](docs/setup.md)
