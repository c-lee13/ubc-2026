import {
  SolanaGatewayError,
  type Base58,
  type ClaimEvent,
  type DepositEvent,
  type OnChainPurchaseAccount,
  type PurchaseStatus,
  type ResolutionEvent,
  type SolanaServerGateway,
  type TxReceipt,
} from "@hedged/shared";
import type { GeminiAdapter } from "../gemini/adapter";
import { GeminiUnavailableError } from "../gemini/client";
import { BASE_UNITS_PER_HUNDREDTH, qtyToHundredths } from "../gemini/decimal";
import { simulateHedge } from "../hedging/simulate";
import {
  BudgetExceededError,
  type PromotionRow,
  type PurchaseRow,
  type Store,
} from "../store/types";
import { withRetry, type RetryPolicy } from "./retry";

/**
 * Drives each purchase through the off-chain state machine (docs/workflow.md, CLAUDE.md §5.1):
 *
 *   verified deposit -> live Gemini quote -> SIMULATED hedge (persisted once, budget reserved)
 *     -> mark_hedged confirmed -> HEDGED
 *   any failure -> no live exposure -> cancel_unhedged confirmed -> CANCELLED -> (customer claims)
 *   deadline passed + OFFICIAL Gemini outcome -> resolve_promo -> RESOLVED + hedge settled
 *
 * Every decision is re-derived from persisted state and on-chain reads, so any step can be
 * re-run after a crash or duplicate event without creating a second hedge.
 */

export interface OrchestratorConfig {
  maxQuoteAgeMs: number;
  feeBps: number;
  /**
   * Fraction of the promo's on-chain cancel timeout during which new hedges may START. After
   * depositedAt + timeout * fraction the purchase is cancelled instead, leaving the remaining
   * window for mark_hedged to land before the customer could self-cancel. 0.7 = stop in the last 30%.
   */
  hedgeWindowFraction: number;
  retry: RetryPolicy;
}

export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * v2 Arc escrow: push payouts instead of waiting for the customer / shop to claim. The contract
 * decides who is paid; the resulting ClaimEvents are recorded by `handleClaim` as usual.
 */
export interface Settler {
  settlePurchase(purchasePda: string): Promise<unknown>;
  settlePromotion(promoPda: string): Promise<{ settled: string[]; skipped: unknown[] }>;
}

export interface OrchestratorDeps {
  store: Store;
  gateway: SolanaServerGateway;
  /** Present only on a v2 Arc escrow (automatic payouts). */
  settler?: Settler | null;
  gemini: Pick<GeminiAdapter, "getQuote" | "getOutcome">;
  config: OrchestratorConfig;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: Logger;
}

const PRE_HEDGE: readonly PurchaseStatus[] = ["DEPOSITED", "PENDING_HEDGE"];
const UNRESOLVED: readonly PurchaseStatus[] = [
  "DEPOSITED",
  "PENDING_HEDGE",
  "HEDGE_SIMULATED",
  "HEDGE_FAILED",
  "CANCEL_PENDING",
];
const LIVE_HEDGE = new Set(["SIMULATED_FILLED", "SIMULATED_PARTIAL"]);
/** Entitled to a payout that has not been paid yet (v2 pays these automatically). */
const UNPAID = new Set<PurchaseStatus>(["CANCELLED", "RESOLVED"]);

const noopLog: Logger = { info() {}, warn() {}, error() {} };

/** A permanent reason not to hedge; the purchase goes to HEDGE_FAILED -> cancel. */
class NoHedge extends Error {}

export function createOrchestrator(deps: OrchestratorDeps) {
  const { store, gateway, gemini, config } = deps;
  const settler = deps.settler ?? null;
  const now = deps.now ?? (() => new Date());
  const nowUnix = () => Math.floor(now().getTime() / 1000);
  const log = deps.log ?? noopLog;
  const retryDeps = {
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    random: deps.random ?? Math.random,
  };
  const retry = <T>(fn: (attempt: number) => Promise<T>, isRetryable: (e: unknown) => boolean) =>
    withRetry(fn, { policy: config.retry, isRetryable, ...retryDeps });

  const gatewayRetryable = (e: unknown) => e instanceof SolanaGatewayError && e.retryable;

  /** Chain read with retries; null means the account does not exist. */
  const readPurchase = (pda: Base58) =>
    retry(() => gateway.getPurchaseState(pda), gatewayRetryable);

  /**
   * Submit a relayer instruction. On every retry, first re-read the purchase: a TX_TIMEOUT means
   * the outcome is unknown, so we never blindly resend if the target state already holds.
   */
  async function submitWithReread(
    pda: Base58,
    target: OnChainPurchaseAccount["state"],
    send: () => Promise<TxReceipt>,
  ): Promise<TxReceipt> {
    return retry(async (attempt) => {
      if (attempt > 1) {
        const chain = await gateway.getPurchaseState(pda);
        if (chain?.state === target) {
          return { signature: null, slot: null, commitment: "finalized", alreadyApplied: true };
        }
        if (chain && chain.state !== "Deposited") {
          throw new SolanaGatewayError("INVALID_STATE", `purchase is ${chain.state}`);
        }
      }
      return send();
    }, gatewayRetryable);
  }

  // ---- deposits ------------------------------------------------------------------------------

  async function handleDeposit(event: DepositEvent): Promise<void> {
    const promo = await store.getPromotionByPda(event.promo);
    if (!promo || BigInt(event.amount) !== promo.offerAmount) {
      // Every promo on this program uses our relayer, so a deposit we cannot hedge (promo not
      // confirmed with the backend yet, or an unexpected amount) is refunded: nothing was hedged,
      // so cancelling carries no exposure. Throwing on failure makes the gateway redeliver.
      log.warn(
        { promo: event.promo, purchase: event.purchase, known: Boolean(promo) },
        "deposit the backend cannot hedge; refunding",
      );
      await submitWithReread(event.purchase, "Cancelled", () =>
        gateway.cancelUnhedged(event.purchase),
      ).catch(async (err: unknown) => {
        const chain = await gateway.getPurchaseState(event.purchase).catch(() => null);
        if (chain && chain.state !== "Deposited") return; // already cancelled/refunded
        throw err;
      });
      return;
    }
    await store.recordDeposit(event, promo.id);
    await processPurchase(event.purchase);
  }

  /** Advance one purchase as far as it can go right now. Safe to call repeatedly. */
  async function processPurchase(pda: Base58): Promise<void> {
    for (let step = 0; step < 8; step++) {
      const p = await store.getPurchaseByPda(pda);
      if (!p || p.needsReconciliation) return;
      let progressed: boolean;
      switch (p.status) {
        case "DEPOSITED":
        case "PENDING_HEDGE":
          progressed = await startHedge(p);
          break;
        case "HEDGE_SIMULATED":
          progressed = await confirmHedge(p);
          break;
        case "HEDGE_FAILED":
        case "CANCEL_PENDING":
          progressed = await cancelPurchase(p);
          break;
        default:
          return;
      }
      if (!progressed) return;
    }
  }

  async function startHedge(p: PurchaseRow): Promise<boolean> {
    if (p.status === "DEPOSITED") {
      // Lease: only one worker moves DEPOSITED -> PENDING_HEDGE.
      return (
        (await store.transitionPurchase(p.purchasePda, ["DEPOSITED"], "PENDING_HEDGE")) !== null
      );
    }

    // Resume after restart: a hedge already exists, so never quote again.
    const existing = await store.getHedgeByPurchase(p.id);
    if (existing) {
      const live = LIVE_HEDGE.has(existing.status);
      return (
        (await store.transitionPurchase(
          p.purchasePda,
          ["PENDING_HEDGE"],
          live ? "HEDGE_SIMULATED" : "HEDGE_FAILED",
          live ? {} : { lastError: existing.failureReason ?? "SIMULATION_FAILED" },
        )) !== null
      );
    }

    const promo = await store.getPromotion(p.promotionId);
    if (!promo) throw new Error(`promotion ${p.promotionId} missing for ${p.purchasePda}`);

    try {
      await checkEligibleOnChain(p, promo);
      const { quote } = await retry(
        () => gemini.getQuote(promo.geminiMarketId),
        (e) => e instanceof GeminiUnavailableError,
      ).catch((err: unknown) => {
        throw new NoHedge(`QUOTE_UNAVAILABLE: ${(err as Error).message}`);
      });
      const quoteId = await store.recordQuote(quote);
      const sim = simulateHedge(
        {
          refundAmount: p.amount,
          quote,
          policy: {
            maxYesPriceMicroUsd: promo.maxYesPriceMicroUsd,
            maxQuoteAgeMs: config.maxQuoteAgeMs,
            remainingBudget: promo.hedgeBudget - promo.reservedPremium,
            feeBps: config.feeBps,
          },
        },
        now(),
      );

      // A partial simulated fill does not cover the refund. The snapshot would not improve on an
      // immediate retry, so it is released at once (no exposure kept) and the purchase cancelled.
      const covered = sim.status === "SIMULATED_FILLED";
      const base = {
        purchaseId: p.id,
        promotionId: promo.id,
        marketId: sim.marketId,
        quoteId,
        requestedContracts: sim.requestedContracts,
        filledContracts: sim.filledContracts,
        avgFillPriceMicroUsd: sim.avgFillPriceMicroUsd,
        premium: sim.premium === null ? null : BigInt(sim.premium),
        modeledFee: BigInt(sim.modeledFee),
        assumptions: sim.assumptions,
        quoteFetchedAt: sim.quoteFetchedAt,
      };
      let hedge;
      try {
        hedge = await store.reserveHedge({
          ...base,
          status: covered ? "SIMULATED_FILLED" : "FAILED",
          failureReason: covered ? null : sim.failureReason,
        });
      } catch (err) {
        if (!(err instanceof BudgetExceededError)) throw err;
        hedge = await store.reserveHedge({
          ...base,
          status: "FAILED",
          failureReason: "BUDGET_EXCEEDED",
        });
      }

      if (LIVE_HEDGE.has(hedge.status)) {
        return (
          (await store.transitionPurchase(p.purchasePda, ["PENDING_HEDGE"], "HEDGE_SIMULATED")) !==
          null
        );
      }
      throw new NoHedge(hedge.failureReason ?? "SIMULATION_FAILED");
    } catch (err) {
      if (err instanceof ChainMoved) return alignFromChain(p, err.chain);
      if (err instanceof NoHedgeQuiet) return false;
      if (!(err instanceof NoHedge)) {
        await store.patchPurchase(p.purchasePda, { lastError: (err as Error).message });
        throw err;
      }
      log.info({ purchase: p.purchasePda, reason: err.message }, "hedge not placed; cancelling");
      return (
        (await store.transitionPurchase(p.purchasePda, PRE_HEDGE, "HEDGE_FAILED", {
          lastError: err.message,
        })) !== null
      );
    }
  }

  /** Re-read chain state right before hedging (CLAUDE.md §5.1 item 4). */
  async function checkEligibleOnChain(p: PurchaseRow, promo: PromotionRow): Promise<void> {
    // A just-delivered deposit can lag behind reads: treat "not found" as retryable here.
    const chain = await retry(async () => {
      const c = await gateway.getPurchaseState(p.purchasePda);
      if (!c) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", p.purchasePda);
      return c;
    }, gatewayRetryable).catch(async (err: unknown) => {
      // Leave it PENDING_HEDGE: the reconciliation sweep retries, and the hedge-window check
      // turns it into a refund if this drags on.
      await store.patchPurchase(p.purchasePda, { lastError: `pre-hedge read: ${String(err)}` });
      throw new NoHedgeQuiet();
    });
    if (chain.state !== "Deposited") throw new ChainMoved(chain);

    const [chainPromo, chainConfig] = await Promise.all([
      retry(() => gateway.getPromoState(pdaOf(promo)), gatewayRetryable),
      retry(() => gateway.getConfig(), gatewayRetryable),
    ]);
    if (!chainPromo || chainPromo.state !== "Active") throw new NoHedge("PROMO_NOT_ACTIVE");
    if (chainConfig?.paused) throw new NoHedge("PROGRAM_PAUSED");

    const hedgeCutoff =
      chain.depositedAt + Math.floor(chainPromo.cancelTimeoutSecs * config.hedgeWindowFraction);
    if (nowUnix() >= hedgeCutoff) throw new NoHedge("HEDGE_WINDOW_CLOSED");
  }

  async function confirmHedge(p: PurchaseRow): Promise<boolean> {
    const hedge = await store.getHedgeByPurchase(p.id);
    if (!hedge || !LIVE_HEDGE.has(hedge.status)) {
      await flag(p, "HEDGE_SIMULATED without a live simulated hedge");
      return false;
    }
    try {
      const receipt = await submitWithReread(p.purchasePda, "Hedged", () =>
        gateway.markHedged(p.purchasePda),
      );
      return (
        (await store.transitionPurchase(p.purchasePda, ["HEDGE_SIMULATED"], "HEDGED", {
          onChainState: "Hedged",
          markHedgedTxSignature: receipt.signature,
        })) !== null
      );
    } catch (err) {
      log.warn({ purchase: p.purchasePda, err: String(err) }, "mark_hedged failed; re-reading");
      const chain = await readPurchase(p.purchasePda).catch(() => null);
      if (!chain) {
        // RPC trouble: keep the hedge and HEDGE_SIMULATED; the sweep retries mark_hedged.
        await store.patchPurchase(p.purchasePda, {
          lastError: `mark_hedged failed, state unreadable: ${String(err)}`,
        });
        return false;
      }
      if (chain.state === "Hedged") return alignFromChain(p, chain);
      // Not hedged on-chain (customer cancelled first, promo resolved, paused, or we gave up).
      // Release the simulated exposure BEFORE any cancellation (CLAUDE.md §5.1 item 5).
      await store.voidHedge(hedge.id, "MARK_HEDGED_FAILED");
      if (chain.state !== "Deposited") return alignFromChain(p, chain);
      return (
        (await store.transitionPurchase(p.purchasePda, ["HEDGE_SIMULATED"], "HEDGE_FAILED", {
          lastError: `mark_hedged not confirmed (${String(err)}); simulated hedge voided`,
        })) !== null
      );
    }
  }

  async function cancelPurchase(p: PurchaseRow): Promise<boolean> {
    // Relayer cancel only with NO live exposure.
    const hedge = await store.getHedgeByPurchase(p.id);
    if (hedge && LIVE_HEDGE.has(hedge.status))
      await store.voidHedge(hedge.id, "MARK_HEDGED_FAILED");

    if (p.status === "HEDGE_FAILED") {
      return (
        (await store.transitionPurchase(p.purchasePda, ["HEDGE_FAILED"], "CANCEL_PENDING", {
          lastError: p.lastError,
        })) !== null
      );
    }
    try {
      const receipt = await submitWithReread(p.purchasePda, "Cancelled", () =>
        gateway.cancelUnhedged(p.purchasePda),
      );
      const moved =
        (await store.transitionPurchase(p.purchasePda, ["CANCEL_PENDING"], "CANCELLED", {
          onChainState: "Cancelled",
          cancelTxSignature: receipt.signature,
          lastError: p.lastError,
        })) !== null;
      if (moved) await autoSettle(p.purchasePda);
      return moved;
    } catch (err) {
      const chain = await readPurchase(p.purchasePda).catch(() => null);
      if (chain && chain.state !== "Deposited") return alignFromChain(p, chain);
      // Still Deposited (e.g. RPC down): stay CANCEL_PENDING; the sweep retries later.
      await store.patchPurchase(p.purchasePda, { lastError: `cancel_unhedged: ${String(err)}` });
      return false;
    }
  }

  /** Make the DB agree with an authoritative on-chain read. Returns true if anything changed. */
  async function alignFromChain(p: PurchaseRow, chain: OnChainPurchaseAccount): Promise<boolean> {
    const hedge = await store.getHedgeByPurchase(p.id);
    const live = hedge !== null && LIVE_HEDGE.has(hedge.status);
    const move = async (from: readonly PurchaseStatus[], to: PurchaseStatus) =>
      (await store.transitionPurchase(p.purchasePda, from, to, {
        onChainState: chain.state,
        lastError: p.lastError,
      })) !== null;

    switch (chain.state) {
      case "Deposited":
        if (p.status === "HEDGED" || p.status === "RESOLVED" || p.status === "CLAIMED") {
          await flag(p, `DB says ${p.status} but chain says Deposited`);
        }
        return false;
      case "Hedged":
        if (p.status === "HEDGED" || p.status === "RESOLVED") return false;
        if (!live) {
          await flag(p, "on-chain Hedged but no live simulated hedge in the ledger");
          return false;
        }
        return move(
          ["PENDING_HEDGE", "HEDGE_SIMULATED", "HEDGE_FAILED", "CANCEL_PENDING"],
          "HEDGED",
        );
      case "Cancelled":
      case "Refunded":
        if (live) {
          // Customer cancelled before mark_hedged confirmed: orphaned simulated exposure.
          log.warn({ purchase: p.purchasePda }, "purchase cancelled on-chain; voiding hedge");
          await store.voidHedge(hedge.id, "MARK_HEDGED_FAILED");
        }
        if (chain.state === "Cancelled") return move(UNRESOLVED, "CANCELLED");
        return move([...UNRESOLVED, "CANCELLED"], "REFUNDED");
      case "ClaimedByCustomer":
      case "ClaimedByMerchant":
        return move(["HEDGED", "RESOLVED"], "CLAIMED");
    }
  }

  async function flag(p: PurchaseRow, reason: string): Promise<void> {
    log.error({ purchase: p.purchasePda, reason }, "needs manual reconciliation");
    await store.patchPurchase(p.purchasePda, { needsReconciliation: true, lastError: reason });
  }

  // ---- resolution ----------------------------------------------------------------------------

  /** For every promo past its deadline: if Gemini has an OFFICIAL outcome, resolve on-chain. */
  async function resolveDuePromotions(): Promise<void> {
    for (const promo of await store.listPromotionsDueForResolution(nowUnix())) {
      try {
        await resolveIfFinal(promo);
      } catch (err) {
        log.error({ promo: promo.promoPda, err: String(err) }, "resolution attempt failed");
      }
    }
  }

  async function resolveIfFinal(promo: PromotionRow): Promise<"RESOLVED" | "PENDING"> {
    if (nowUnix() < promo.depositDeadline) return "PENDING";
    const outcome = await retry(
      () => gemini.getOutcome(promo.geminiMarketId),
      (e) => e instanceof GeminiUnavailableError,
    );
    if (!outcome || outcome.source !== "gemini-official-settlement") return "PENDING";
    await store.saveOutcome(outcome);

    let receipt: TxReceipt;
    try {
      receipt = await retry(
        () => gateway.resolvePromotion(pdaOf(promo), outcome.outcome),
        gatewayRetryable,
      );
    } catch (err) {
      // Possibly resolved already (e.g. TX_TIMEOUT that landed, or another instance).
      const chainPromo = await gateway.getPromoState(pdaOf(promo)).catch(() => null);
      const want = outcome.outcome === "YES" ? "ResolvedYes" : "ResolvedNo";
      if (chainPromo?.state !== want) throw err;
      receipt = { signature: null, slot: null, commitment: "finalized", alreadyApplied: true };
    }
    await applyResolution(promo, outcome.outcome, receipt.signature, outcome.resolvedAt);
    return "RESOLVED";
  }

  async function handleResolution(event: ResolutionEvent): Promise<void> {
    const promo = await store.getPromotionByPda(event.promo);
    if (!promo) return;
    await applyResolution(
      promo,
      event.outcome,
      event.signature,
      new Date(event.resolvedAt * 1000).toISOString(),
    );
  }

  async function applyResolution(
    promo: PromotionRow,
    outcome: "YES" | "NO",
    signature: Base58 | null,
    resolvedAtIso: string,
  ): Promise<void> {
    await store.setPromotionResolved(promo.id, outcome, signature);
    await settleResolvedPurchases(promo.id, outcome, resolvedAtIso);
    await autoSettlePromotion(promo);
  }

  /** v2: pay one purchase now (refund after a cancel). Best effort; the sweep retries. */
  async function autoSettle(purchasePda: Base58): Promise<void> {
    if (!settler) return;
    try {
      await retry(() => settler.settlePurchase(purchasePda), gatewayRetryable);
    } catch (err) {
      log.warn({ purchase: purchasePda, err: String(err) }, "automatic payout failed; will retry");
    }
  }

  /** v2: pay every payable purchase of a resolved promo. Best effort; the sweep retries. */
  async function autoSettlePromotion(promo: PromotionRow): Promise<void> {
    if (!settler || !promo.promoPda) return;
    try {
      const r = await retry(() => settler.settlePromotion(pdaOf(promo)), gatewayRetryable);
      log.info(
        { promo: promo.promoPda, settled: r.settled.length, skipped: r.skipped.length },
        "automatic payouts sent",
      );
    } catch (err) {
      log.warn({ promo: promo.promoPda, err: String(err) }, "automatic payouts failed; will retry");
    }
  }

  /**
   * Idempotent: settle the simulated hedge of every purchase that was hedged (including ones whose
   * claim was recorded first), move HEDGED -> RESOLVED, and push unhedged ones to a refund. One
   * failing purchase never blocks the rest; the reconciliation sweep calls this again.
   */
  async function settleResolvedPurchases(
    promotionId: string,
    outcome: "YES" | "NO",
    resolvedAtIso: string,
  ): Promise<void> {
    for (const p of await store.listPurchases(promotionId)) {
      try {
        if (p.status === "HEDGED" || p.status === "RESOLVED" || p.status === "CLAIMED") {
          const hedge = await store.getHedgeByPurchase(p.id);
          if (hedge && LIVE_HEDGE.has(hedge.status)) {
            const payout =
              outcome === "YES"
                ? qtyToHundredths(hedge.filledContracts) * BASE_UNITS_PER_HUNDREDTH
                : 0n;
            await store.settleHedge(hedge.id, {
              status: outcome === "YES" ? "SETTLED_WIN" : "SETTLED_LOSS",
              virtualPayout: payout,
              settledAt: resolvedAtIso,
            });
          }
          await store.transitionPurchase(p.purchasePda, ["HEDGED"], "RESOLVED");
        } else if (UNRESOLVED.includes(p.status)) {
          // mark_hedged now fails (promo not Active) -> hedge voided -> cancelled -> refund.
          await processPurchase(p.purchasePda);
        }
      } catch (err) {
        log.error({ purchase: p.purchasePda, err: String(err) }, "post-resolution step failed");
      }
    }
  }

  // ---- claims --------------------------------------------------------------------------------

  async function handleClaim(event: ClaimEvent): Promise<void> {
    const p = await store.getPurchaseByPda(event.purchase);
    if (!p) return;
    const chain = await readPurchase(event.purchase);
    if (!chain) return;
    // Decide from on-chain state, not from the event (gateway subscription contract).
    await alignFromChain(p, chain);
    const final = chain.state === "Refunded" ? "REFUNDED" : "CLAIMED";
    await store.transitionPurchase(p.purchasePda, [final], final, {
      claimTxSignature: event.signature,
      onChainState: chain.state,
    });
  }

  // ---- reconciliation ------------------------------------------------------------------------

  /**
   * Compare every on-chain purchase of a promo with the ledger; repair what can be repaired,
   * flag the rest, then resume any purchase left mid-flight (e.g. after a restart).
   */
  async function reconcilePromotion(
    promotionId: string,
  ): Promise<{ repaired: number; flagged: string[] }> {
    const promo = await store.getPromotion(promotionId);
    if (!promo) throw new Error(`promotion ${promotionId} not found`);
    const flagged: string[] = [];
    let repaired = 0;
    const chainPurchases = await retry(() => gateway.listPurchases(pdaOf(promo)), gatewayRetryable);
    for (const chain of chainPurchases) {
      const p = await store.getPurchaseByPda(chain.purchasePda);
      if (!p) {
        flagged.push(`${chain.purchasePda}: on-chain purchase with no recorded deposit event`);
        continue;
      }
      if (await alignFromChain(p, chain)) repaired++;
    }
    if (promo.resolvedOutcome) {
      await settleResolvedPurchases(promo.id, promo.resolvedOutcome, now().toISOString());
      if (settler && (await store.listPurchases(promo.id)).some((p) => UNPAID.has(p.status))) {
        await autoSettlePromotion(promo);
      }
    } else {
      for (const p of await store.listPurchases(promotionId)) {
        if (settler && p.status === "CANCELLED") await autoSettle(p.purchasePda);
      }
      for (const p of await store.listPurchases(promotionId)) {
        if (UNRESOLVED.includes(p.status)) {
          await processPurchase(p.purchasePda).catch((err: unknown) =>
            log.error({ purchase: p.purchasePda, err: String(err) }, "resume failed"),
          );
        }
      }
    }
    for (const p of await store.listPurchases(promotionId)) {
      if (p.needsReconciliation) flagged.push(`${p.purchasePda}: ${p.lastError}`);
    }
    return { repaired, flagged };
  }

  /** Does this promotion still need the reconciliation sweep? */
  async function needsSweep(promo: PromotionRow): Promise<boolean> {
    if (promo.status !== "ACTIVE") return false;
    if (!promo.resolvedOutcome) return true;
    // With automatic payouts, keep sweeping until everything is paid out.
    const pending = new Set<PurchaseStatus>([...UNRESOLVED, "HEDGED", ...(settler ? UNPAID : [])]);
    return (await store.listPurchases(promo.id)).some((p) => pending.has(p.status));
  }

  return {
    needsSweep,
    handleDeposit,
    processPurchase,
    resolveDuePromotions,
    resolveIfFinal,
    handleResolution,
    handleClaim,
    reconcilePromotion,
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;

/** Workers only ever see ACTIVE promotions, which always have a PDA. */
function pdaOf(promo: PromotionRow): Base58 {
  if (!promo.promoPda) throw new Error(`promotion ${promo.id} is not active on-chain yet`);
  return promo.promoPda;
}

/** Thrown when the chain shows the purchase already left Deposited; caller aligns instead. */
class ChainMoved extends Error {
  constructor(readonly chain: OnChainPurchaseAccount) {
    super(`purchase already ${chain.state} on-chain`);
  }
}

/** Stop without cancelling (state already flagged for an operator). */
class NoHedgeQuiet extends Error {}
