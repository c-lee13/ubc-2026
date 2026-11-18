# Live demo plan (draft)

**Why not a Texas game live:** past games are settled (no order book → every hedge fails), Saturday's
game may not be settled during judging, and Texas trades at ~92¢. The pitch _story_ stays the Texas
coffee shop; the live mechanism runs on a Gemini **5-minute SOL Up/Down market**.

## How those markets behave (checked live 2026-11-17)

- Question: "SOL price at the end of the window ≥ price captured when the window opens?"
- Listed ~1 hour ahead. Windows that open 10+ minutes out trade at ~50¢ with deep books
  (250–2,600 contracts). The next window to open can be thin or empty, and prices swing once a
  window is open.
- Official result (`resolutionSide`) ~5 seconds after the window ends.
- Backend rule: last deposit = window open − 5 min (`GET /api/markets/windows` →
  `recommendedDepositDeadline`). So purchase → result takes ~10–15 minutes.

## Run-of-show (5-min pitch + 2-min Q&A)

| When                    | What                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| ~12–15 min before stage | **Promo A**: "free coffee if SOL is up" on a window ending around pitch minute 3. Buy one. |
| Minute 0–1              | Texas story: Mattress Mack, the coffee shop, cost fixed at odds × refund.                  |
| Minute 1–2              | **Promo B live**: someone buys; live 50¢ quote → simulated hedge → `Hedged` on Arc.        |
| Minute 2                | **Price cap**: Saturday's Texas game at ~92¢ is refused by a 50¢ cap.                      |
| Minute 3–4              | **Promo A settles**: official Gemini result → resolve on Arc → automatic refund or payout. |
| Q&A                     | Promo B may settle; bonus only.                                                            |
| Backup                  | Recorded video of the full flow.                                                           |

## Before the demo

- Backend on escrow v2 with the relayer (`SOLANA_GATEWAY=arc`, v2 `ARC_ESCROW_ADDRESS`); startup log
  says "one-tap checkout and automatic payouts on".
- Two demo customer wallets logged in and funded with testnet USDC (`POST /api/wallet/faucet`).
- Promo A and Promo B published from the shop wallet on windows picked with `/api/markets/windows`.
- One full purchase → result → payout done earlier the same day, and the backup video recorded.
