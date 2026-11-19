import type { SolanaServerGateway, Unsubscribe } from "@hedged/shared";
import type { Desk } from "../desk/run";
import type { Store } from "../store/types";
import type { Logger, Orchestrator } from "./orchestrator";

/**
 * Long-lived background work hosted by apps/api:
 * - deposit / resolution / claim subscriptions, each replayed from its persisted checkpoint;
 *   a handler that throws is NOT acked, so the gateway redelivers it;
 * - a fast timer that resolves promos once Gemini posts an official outcome (5-minute crypto
 *   windows settle ~5 s after they end, so this runs every few seconds);
 * - a slower reconciliation sweep (also run once at boot) that resumes interrupted purchases.
 */
export interface WorkerOptions {
  gateway: SolanaServerGateway;
  store: Store;
  orchestrator: Orchestrator;
  log: Logger;
  resolvePollMs: number;
  reconcileMs: number;
  /** Optional exposure desk, rebalanced every `deskMs`. */
  desk?: Desk;
  deskMs?: number;
  /**
   * Prefix for the persisted checkpoint names, one per chain. Checkpoints are block/slot numbers,
   * and Solana slots (~523M) are far above Arc block numbers (~73M): an Arc gateway resuming from a
   * Solana checkpoint would wait for a block that does not exist yet and never sweep. "" = the
   * original names (Solana); "arc:" for Arc.
   */
  checkpointPrefix?: string;
}

export interface RunningWorkers {
  stop(): Promise<void>;
  /** Exposed for tests: run one pass of each timer now. */
  tick(): Promise<void>;
}

export async function startWorkers(opts: WorkerOptions): Promise<RunningWorkers> {
  const { gateway, store, orchestrator, log } = opts;
  const cp = (name: string) => `${opts.checkpointPrefix ?? ""}${name}`;

  const acked =
    <E extends { slot: number }>(name: string, handle: (e: E) => Promise<void>) =>
    async (e: E) => {
      await handle(e);
      await store.setCheckpoint(name, e.slot);
    };

  const subs: Unsubscribe[] = [
    await gateway.subscribeToDeposits(
      acked(cp("deposits"), (e) => orchestrator.handleDeposit(e)),
      { fromSlot: (await store.getCheckpoint(cp("deposits"))) ?? undefined },
    ),
    await gateway.subscribeToResolutions(
      acked(cp("resolutions"), (e) => orchestrator.handleResolution(e)),
      { fromSlot: (await store.getCheckpoint(cp("resolutions"))) ?? undefined },
    ),
    await gateway.subscribeToClaims(
      acked(cp("claims"), (e) => orchestrator.handleClaim(e)),
      { fromSlot: (await store.getCheckpoint(cp("claims"))) ?? undefined },
    ),
  ];

  // Never overlap runs of the same timer.
  const guarded = (name: string, fn: () => Promise<void>) => {
    let running = false;
    return async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        log.error({ worker: name, err: String(err) }, "worker pass failed");
      } finally {
        running = false;
      }
    };
  };

  const resolvePass = guarded("resolve", () => orchestrator.resolveDuePromotions());
  const reconcilePass = guarded("reconcile", async () => {
    // Includes resolved promos that still have refunds or settlements to finish.
    for (const promo of await store.listPromotions({ status: "ACTIVE" })) {
      try {
        if (!(await orchestrator.needsSweep(promo))) continue;
        const report = await orchestrator.reconcilePromotion(promo.id);
        if (report.flagged.length > 0) {
          log.warn({ promo: promo.promoPda, flagged: report.flagged }, "reconciliation flags");
        }
      } catch (err) {
        log.error({ promo: promo.promoPda, err: String(err) }, "reconcile failed for promo");
      }
    }
  });

  const deskPass = guarded("desk", async () => {
    await opts.desk?.rebalance();
  });

  await reconcilePass();
  const timers = [
    setInterval(resolvePass, opts.resolvePollMs),
    setInterval(reconcilePass, opts.reconcileMs),
  ];
  if (opts.desk && opts.deskMs) timers.push(setInterval(deskPass, opts.deskMs));
  log.info({ resolvePollMs: opts.resolvePollMs, reconcileMs: opts.reconcileMs }, "workers started");

  return {
    async stop() {
      timers.forEach(clearInterval);
      await Promise.all(subs.map((s) => s.stop()));
    },
    async tick() {
      await resolvePass();
      await reconcilePass();
      await deskPass();
    },
  };
}
