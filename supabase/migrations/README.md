# supabase/migrations (Dev 4)

`20261117000000_init.sql`: `promotions`, `purchases`, `simulated_hedges`, `market_quotes`,
`market_outcomes`, `chain_events`, `checkpoints`, plus atomic RPC functions:

- `transition_purchase(pda, from[], to)`: compare-and-set status (one worker wins a lease).
- `reserve_simulated_hedge(jsonb)`: insert the ONE hedge per purchase (`unique (purchase_id)`) and
  reserve its premium against `promotions.hedge_budget` in the same transaction.
- `void_simulated_hedge(id, reason)`: release a hedge's reservation (purchase cancelled).

Constraints: unique `(deposit_tx_signature, deposit_event_index)`, unique `purchase_pda`,
`simulated = true` enforced by a check, status values per `docs/workflow.md`. RLS is enabled with no
policies, so only the server's service-role key can read or write.

`20261118000000_exposure_desk.sql`: `desk_fills` (simulated exposure-desk trades). Apply after the
init migration.

`20261119000000_purchases_by_customer.sql`: index for the customer's purchase list
(`GET /api/purchases?customer=`). Optional for correctness; apply after the others.

Status of init: applied and smoke-tested on the team project. After applying it, run `supabase/tests/smoke.sql` in the SQL
editor: it exercises every function inside a rolled-back transaction and should print
`smoke test passed`.
