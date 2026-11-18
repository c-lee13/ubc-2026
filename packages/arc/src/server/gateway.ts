import {
  SolanaGatewayError,
  type ClaimEvent,
  type Commitment,
  type DepositEvent,
  type EventHandler,
  type OnChainPromoAccount,
  type OnChainPurchaseAccount,
  type OnChainPurchaseState,
  type ResolutionEvent,
  type SolanaServerGateway,
  type SubmitOptions,
  type SubscribeOptions,
  type TxReceipt,
  type TxVerification,
  type Unsubscribe,
} from "@hedged/shared";
import {
  parseAbiItem,
  type Address,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  getConfig,
  getPromoState,
  getPurchaseState,
  listPurchases,
  previewSettlement,
  type ArcConfig,
  type ArcPromoAccount,
  type SettlementPreview,
  type SettleStatus,
} from "../accounts";
import type { ArcOutcome } from "../codec";
import { isBytes32, purchaseKeyOf, toBytes16 } from "../ids";
import { MAX_SETTLE_BATCH, splitSignature } from "../transactions";
import { ArcEventSource } from "./events";
import { type ArcStreamsSignal } from "./streams";
import {
  ProgramFailure,
  RpcFailure,
  SubmitTimeout,
  submitRelayerCall,
  type RelayerFn,
} from "./submit";
import { verifyArcTransaction } from "./verify";

/**
 * Arc implementation of the SAME `SolanaServerGateway` interface (docs/interfaces.md §4), so the
 * backend switches with one line. Mapping: `purchasePda`/`promoPda` = bytes32 ids (0x...),
 * `signature` = tx hash, `slot` = block number, commitment "finalized" = Arc's finalized head.
 * SERVER ONLY: holds the relayer key.
 */
export interface ArcGatewayOptions {
  publicClient: PublicClient;
  walletClient: WalletClient;
  relayer: PrivateKeyAccount;
  escrow: Address;
  token: Address;
  commitment?: Commitment;
  timeoutMs?: number;
  eventSource?: "poll" | "websocket" | "streams";
  wssUrl?: string;
  sweepMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export class GatewayInvalidStateError extends SolanaGatewayError {
  constructor(
    message: string,
    readonly observedState: OnChainPurchaseState | ArcPromoAccount["state"] | null,
    signature?: string,
  ) {
    super("INVALID_STATE", message, signature);
    this.name = "GatewayInvalidStateError";
  }
}

export class ResolutionTooEarlyError extends SolanaGatewayError {
  constructor(readonly retryAfterUnix: number) {
    super("TX_FAILED", `ResolutionTooEarly: retry at/after ${retryAfterUnix}`);
    this.name = "ResolutionTooEarlyError";
    Object.defineProperty(this, "retryable", { value: true });
  }
}

const HEDGE_MARKED = parseAbiItem(
  "event HedgeMarkedEvent(bytes32 indexed promo, bytes32 indexed purchase, address relayer, uint64 markedAt)",
);
const CANCELLED = parseAbiItem(
  "event PurchaseCancelledEvent(bytes32 indexed promo, bytes32 indexed purchase, address indexed customer, uint64 amount, uint64 cancelledAt)",
);
const RESOLVED = parseAbiItem(
  "event ResolutionEvent(bytes32 indexed promo, uint8 outcome, address relayer, uint64 resolvedAt)",
);
const CLAIMED = parseAbiItem(
  "event ClaimEvent(bytes32 indexed promo, bytes32 indexed purchase, address indexed recipient, uint64 amount, uint8 kind, uint64 claimedAt)",
);
const DEPOSITED = parseAbiItem(
  "event DepositEvent(bytes32 indexed promo, bytes32 indexed purchase, address indexed customer, bytes16 purchaseId, uint64 amount, uint64 depositedAt)",
);

/** Arc ResolutionEvent: the shared shape, but the outcome may be "VOID" (v2). */
export type ArcResolutionEvent = Omit<ResolutionEvent, "outcome"> & { outcome: ArcOutcome };

/** The shared promo read shape. At runtime `state` can also be "ResolvedVoid" (v2), which
 * @hedged/shared's OnChainPromoState does not list yet; use `getArcPromoState` for the honest type. */
export type SharedArcPromoAccount = OnChainPromoAccount & { cancelTimeoutSecs: number };

const TERMINAL = ["Refunded", "ClaimedByCustomer", "ClaimedByMerchant"];

export interface SettleBatchResult {
  /** Purchases paid by these calls (state re-read after the receipts). */
  settled: Hex[];
  /** Not paid now, with the reason (NotDue / Paused / AlreadySettled / NotFound, or "Failed"
   * when the token refused the transfer: the purchase stays payable). */
  skipped: { purchasePda: Hex; status: SettleStatus | "Failed" }[];
  receipts: TxReceipt[];
}

export interface AuthorizedDeposit {
  promoId: Hex;
  purchaseIdHex: string;
  customer: Address;
  amount: bigint;
  validAfter: bigint;
  validBefore: bigint;
  /** The customer's 65-byte EIP-712 signature over `receiveAuthorizationTypedData(...)`. */
  signature: Hex;
}

export class ArcGateway implements SolanaServerGateway {
  readonly commitment: Commitment;
  private readonly timeoutMs: number;
  private readonly events: ArcEventSource;

  constructor(private readonly o: ArcGatewayOptions) {
    this.commitment = o.commitment ?? "finalized";
    this.timeoutMs = o.timeoutMs ?? 60_000;
    this.events = new ArcEventSource({
      client: o.publicClient,
      escrow: o.escrow,
      commitment: this.commitment,
      verify: (tx) => this.verifyTransaction(tx),
      mode: o.eventSource ?? "poll",
      wssUrl: o.wssUrl,
      sweepMs: o.sweepMs,
      log: o.log,
    });
  }

  get relayerAddress(): Address {
    return this.o.relayer.address;
  }

  // ------------------------------------------------------------------ subscriptions

  async subscribeToDeposits(
    h: EventHandler<DepositEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(["DepositEvent"], h, opts);
  }
  /**
   * Shared-interface subscription: YES/NO only. VOID resolutions are NOT delivered here, because
   * a handler typed for "YES" | "NO" could treat them as NO (and settle hedges as losses); use
   * `subscribeToArcResolutions` once the backend handles VOID.
   */
  async subscribeToResolutions(
    h: EventHandler<ResolutionEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(
      ["ResolutionEvent"],
      (async (e: ArcResolutionEvent) => {
        if (e.outcome === "VOID") {
          this.o.log?.("VOID resolution not delivered to the YES/NO handler", { promo: e.promo });
          return;
        }
        await h(e as ResolutionEvent);
      }) as EventHandler<never>,
      opts,
    );
  }
  /** Every resolution including VOID (v2). */
  async subscribeToArcResolutions(
    h: EventHandler<ArcResolutionEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(["ResolutionEvent"], h as EventHandler<never>, opts);
  }
  async subscribeToClaims(
    h: EventHandler<ClaimEvent>,
    opts?: SubscribeOptions,
  ): Promise<Unsubscribe> {
    return this.sub(["ClaimEvent"], h, opts);
  }
  private async sub(
    names: ("DepositEvent" | "ResolutionEvent" | "ClaimEvent")[],
    h: EventHandler<never>,
    opts?: SubscribeOptions,
  ) {
    const off = await this.events.subscribe(names, h, opts?.fromSlot);
    return { stop: async () => off() };
  }

  /** QuickNode Streams webhook -> verified pipeline. */
  ingestStreams(signals: ArcStreamsSignal[]): void {
    this.events.ingest(signals.map((s) => s.txHash));
  }

  /** Run one sweep now (tests / after a webhook burst). */
  async sweepNow(): Promise<void> {
    await this.events.tick();
  }

  async stop(): Promise<void> {
    await this.events.stop();
  }

  // ------------------------------------------------------------------ relayer calls

  async markHedged(purchaseKey: string, opts?: SubmitOptions): Promise<TxReceipt> {
    const key = this.key(purchaseKey);
    return this.relayerTransition({
      fn: "markHedged",
      args: [key],
      opts,
      target: async () => {
        const u = await this.mustPurchase(key);
        return ["Hedged", "ClaimedByCustomer", "ClaimedByMerchant"].includes(u.state)
          ? true
          : u.state;
      },
      already: ["AlreadyHedged"],
      invalid: ["InvalidState", "PromoNotActive"],
      originalTx: () => this.findTx(HEDGE_MARKED, { purchase: key }),
    });
  }

  async cancelUnhedged(purchaseKey: string, opts?: SubmitOptions): Promise<TxReceipt> {
    const key = this.key(purchaseKey);
    return this.relayerTransition({
      fn: "cancelUnhedged",
      args: [key],
      opts,
      target: async () => {
        const u = await this.mustPurchase(key);
        return ["Cancelled", "Refunded"].includes(u.state) ? true : u.state;
      },
      already: ["AlreadyCancelled"],
      invalid: ["InvalidState"],
      originalTx: () => this.findTx(CANCELLED, { purchase: key }),
    });
  }

  /** Accepts the shared "YES" | "NO" and, on v2 escrows, "VOID" (event cancelled / market voided:
   * hedged purchases pay the shop, never-hedged ones refund the customer). */
  async resolvePromotion(
    promoId: string,
    outcome: ArcOutcome,
    opts?: SubmitOptions,
  ): Promise<TxReceipt> {
    const key = this.key(promoId);
    const want =
      outcome === "YES" ? "ResolvedYes" : outcome === "NO" ? "ResolvedNo" : "ResolvedVoid";
    const index = outcome === "YES" ? 0 : outcome === "NO" ? 1 : outcome === "VOID" ? 2 : -1;
    if (index < 0) throw new SolanaGatewayError("TX_FAILED", `unknown outcome ${String(outcome)}`);
    try {
      return await this.relayerTransition({
        fn: "resolvePromo",
        args: [key, index],
        opts,
        target: async () => {
          const p = await getPromoState(this.o.publicClient, this.o.escrow, key, "confirmed");
          if (!p) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `promo ${key} not found`);
          return p.state === want ? true : p.state;
        },
        already: ["AlreadyResolved"],
        invalid: [],
        originalTx: () => this.findTx(RESOLVED, { promo: key }),
      });
    } catch (e) {
      if (e instanceof ProgramFailure && e.errorName === "ResolutionTooEarly") {
        const p = await getPromoState(this.o.publicClient, this.o.escrow, key, "confirmed");
        throw new ResolutionTooEarlyError(p?.depositDeadline ?? 0);
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------ v2: automatic settlement

  /**
   * Push one purchase's payout to its entitled party. Idempotent: an already-settled purchase
   * (by an earlier call or the customer's/merchant's own claim) resolves `alreadyApplied`; not
   * yet due (promo Active and not cancelled) throws INVALID_STATE with the observed state.
   */
  async settlePurchase(purchaseKey: string, opts?: SubmitOptions): Promise<TxReceipt> {
    const key = this.key(purchaseKey);
    return this.relayerTransition({
      fn: "settlePurchase",
      args: [key],
      opts,
      target: async () => {
        const u = await this.mustPurchase(key);
        return TERMINAL.includes(u.state) ? true : u.state;
      },
      already: ["AlreadyClaimed"],
      invalid: ["InvalidState"],
      originalTx: () => this.findTx(CLAIMED, { purchase: key }),
    });
  }

  /**
   * Settle many purchases (any promos) with as few transactions as possible: previews each,
   * sends only the payable ones in batches of 50, then re-reads state. Never throws for a
   * single purchase; transport / pause / authorization problems throw like the other calls.
   */
  async settlePurchases(purchaseKeys: string[], opts?: SubmitOptions): Promise<SettleBatchResult> {
    const keys = [...new Set(purchaseKeys.map((k) => this.key(k).toLowerCase() as Hex))];
    const result: SettleBatchResult = { settled: [], skipped: [], receipts: [] };
    const previews = await Promise.all(keys.map((k) => this.previewSettlement(k, "confirmed")));
    const payable = previews.filter((p) => p.status === "Payable").map((p) => p.purchasePda);
    for (const p of previews)
      if (p.status !== "Payable")
        result.skipped.push({ purchasePda: p.purchasePda, status: p.status });
    for (let i = 0; i < payable.length; i += MAX_SETTLE_BATCH) {
      const chunk = payable.slice(i, i + MAX_SETTLE_BATCH);
      result.receipts.push(
        await this.relayerTransition({
          fn: "settlePurchases",
          args: [chunk],
          opts,
          target: async () => true, // per-purchase outcome is re-read below
          already: [],
          invalid: [],
          originalTx: async () => null,
        }),
      );
      for (const k of chunk) {
        const u = await this.mustPurchase(k);
        if (TERMINAL.includes(u.state)) result.settled.push(k);
        else result.skipped.push({ purchasePda: k, status: "Failed" });
      }
    }
    return result;
  }

  /** Settle every payable purchase of a promo (e.g. right after `resolvePromotion`). */
  async settlePromotion(promoId: string, opts?: SubmitOptions): Promise<SettleBatchResult> {
    const all = await this.listPurchases(promoId, "confirmed");
    const open = all.filter((u) => !TERMINAL.includes(u.state)).map((u) => u.purchasePda);
    const r = await this.settlePurchases(open, opts);
    const done = all.filter((u) => TERMINAL.includes(u.state));
    for (const u of done)
      r.skipped.push({ purchasePda: u.purchasePda as Hex, status: "AlreadySettled" });
    return r;
  }

  async previewSettlement(
    purchaseKey: string,
    commitment?: Commitment,
  ): Promise<SettlementPreview> {
    return previewSettlement(
      this.o.publicClient,
      this.o.escrow,
      this.key(purchaseKey),
      commitment ?? this.commitment,
    );
  }

  // ------------------------------------------------------------------ v2: one-signature checkout

  /**
   * Submit a customer's signed EIP-3009 authorization (`depositWithAuthorization`); the relayer
   * pays the gas, the purchase belongs to `customer`. Idempotent: if this exact purchase already
   * exists with the same customer and amount, resolves `alreadyApplied`.
   */
  async submitAuthorizedDeposit(
    d: AuthorizedDeposit,
    opts?: SubmitOptions,
  ): Promise<TxReceipt & { purchasePda: Hex }> {
    const promo = this.key(d.promoId);
    const key = purchaseKeyOf(promo, d.customer, d.purchaseIdHex);
    const { v, r, s } = splitSignature(d.signature);
    const receipt = await this.relayerTransition({
      fn: "depositWithAuthorization",
      args: [
        promo,
        toBytes16(d.purchaseIdHex),
        d.customer,
        d.amount,
        d.validAfter,
        d.validBefore,
        v,
        r,
        s,
      ],
      opts,
      target: async () => {
        const u = await getPurchaseState(this.o.publicClient, this.o.escrow, key, "confirmed");
        if (!u) return "missing";
        return u.customer.toLowerCase() === d.customer.toLowerCase() &&
          u.amount === String(d.amount)
          ? true
          : `exists for another customer/amount`;
      },
      already: ["PurchaseAlreadyExists"],
      invalid: [],
      originalTx: () => this.findTx(DEPOSITED, { purchase: key }),
    });
    return { ...receipt, purchasePda: key };
  }

  /**
   * Shared idempotent flow: simulate+send; an "Already*" or a timeout re-reads state and returns
   * `alreadyApplied` when the target holds; a conflicting state is INVALID_STATE with the observed
   * state; transport problems are RPC_UNAVAILABLE (nothing sent) or TX_TIMEOUT (outcome unknown).
   */
  private async relayerTransition(t: {
    fn: RelayerFn;
    args: readonly unknown[];
    opts?: SubmitOptions;
    target: () => Promise<true | string>;
    already: string[];
    invalid: string[];
    originalTx: () => Promise<{ hash: Hash; block: number } | null>;
  }): Promise<TxReceipt> {
    const commitment = t.opts?.commitment ?? this.commitment;
    try {
      const r = await submitRelayerCall({
        publicClient: this.o.publicClient,
        walletClient: this.o.walletClient,
        account: this.o.relayer,
        escrow: this.o.escrow,
        functionName: t.fn,
        args: t.args,
        commitment,
        timeoutMs: t.opts?.timeoutMs ?? this.timeoutMs,
      });
      const st = await t.target();
      if (st !== true)
        throw new GatewayInvalidStateError(
          `${t.fn} landed but state is ${st}`,
          st as OnChainPurchaseState,
          r.transactionHash,
        );
      return {
        signature: r.transactionHash,
        slot: Number(r.blockNumber),
        commitment,
        alreadyApplied: false,
      };
    } catch (e) {
      if (e instanceof SolanaGatewayError) throw e;
      if (e instanceof ProgramFailure) {
        const n = e.errorName ?? "";
        if (t.already.includes(n)) {
          const st = await t.target();
          if (st === true) {
            const orig = await t.originalTx();
            return {
              signature: orig?.hash ?? null,
              slot: orig?.block ?? null,
              commitment,
              alreadyApplied: true,
            };
          }
          throw new GatewayInvalidStateError(
            `${t.fn}: ${n} but state is ${st}`,
            st as OnChainPurchaseState,
          );
        }
        if (t.invalid.includes(n)) {
          const st = await t.target();
          throw new GatewayInvalidStateError(
            `${t.fn} rejected (${n}); observed ${st === true ? "target" : st}`,
            st === true ? null : (st as OnChainPurchaseState),
          );
        }
        if (n === "Paused")
          throw new SolanaGatewayError("PAUSED", `${t.fn}: program is paused`, e.txHash);
        if (n === "Unauthorized") {
          throw new SolanaGatewayError(
            "NOT_AUTHORIZED",
            `${t.fn}: ${this.o.relayer.address} is not the escrow's relayer`,
            e.txHash,
          );
        }
        if (n === "AccountNotFound")
          throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `${t.fn}: account not found`, e.txHash);
        if (n === "ResolutionTooEarly") throw e;
        throw new SolanaGatewayError("TX_FAILED", e.message, e.txHash);
      }
      if (e instanceof SubmitTimeout) {
        const st = await t.target().catch(() => "unknown");
        if (st === true)
          return { signature: e.txHash, slot: null, commitment, alreadyApplied: false };
        throw new SolanaGatewayError(
          "TX_TIMEOUT",
          `${t.fn} ${e.txHash}: outcome unknown (state ${st}); re-read and retry`,
          e.txHash,
        );
      }
      if (e instanceof RpcFailure) throw new SolanaGatewayError("RPC_UNAVAILABLE", e.message);
      throw new SolanaGatewayError(
        "RPC_UNAVAILABLE",
        (e as Error).message.split("\n")[0] ?? "rpc error",
      );
    }
  }

  // ------------------------------------------------------------------ reads

  async getConfig(): Promise<ArcConfig | null> {
    return getConfig(this.o.publicClient, this.o.escrow, this.commitment);
  }
  /** Shared-interface read. See `SharedArcPromoAccount`: state may be "ResolvedVoid" at runtime. */
  async getPromoState(
    promoId: string,
    commitment?: Commitment,
  ): Promise<SharedArcPromoAccount | null> {
    return (await this.getArcPromoState(promoId, commitment)) as SharedArcPromoAccount | null;
  }
  /** Same read with the honest Arc type (state includes "ResolvedVoid"). */
  async getArcPromoState(
    promoId: string,
    commitment?: Commitment,
  ): Promise<ArcPromoAccount | null> {
    return getPromoState(
      this.o.publicClient,
      this.o.escrow,
      this.key(promoId),
      commitment ?? this.commitment,
    );
  }
  async getPurchaseState(
    purchaseKey: string,
    commitment?: Commitment,
  ): Promise<OnChainPurchaseAccount | null> {
    return getPurchaseState(
      this.o.publicClient,
      this.o.escrow,
      this.key(purchaseKey),
      commitment ?? this.commitment,
    );
  }
  async listPurchases(promoId: string, commitment?: Commitment): Promise<OnChainPurchaseAccount[]> {
    return listPurchases(
      this.o.publicClient,
      this.o.escrow,
      this.key(promoId),
      commitment ?? this.commitment,
    );
  }
  async verifyTransaction(txHash: string, commitment?: Commitment): Promise<TxVerification> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash))
      throw new SolanaGatewayError("VERIFICATION_FAILED", "not a tx hash");
    try {
      return await verifyArcTransaction(
        this.o.publicClient,
        this.o.escrow,
        this.o.token,
        txHash as Hash,
        commitment ?? this.commitment,
      );
    } catch (e) {
      if (e instanceof SolanaGatewayError) throw e;
      throw new SolanaGatewayError(
        "RPC_UNAVAILABLE",
        (e as Error).message.split("\n")[0] ?? "rpc error",
      );
    }
  }

  // ------------------------------------------------------------------ helpers

  private key(v: string): Hex {
    if (!isBytes32(v)) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `not a bytes32 id: ${v}`);
    return v;
  }

  private async mustPurchase(key: Hex): Promise<OnChainPurchaseAccount> {
    const u = await getPurchaseState(this.o.publicClient, this.o.escrow, key, "confirmed");
    if (!u) throw new SolanaGatewayError("ACCOUNT_NOT_FOUND", `purchase ${key} not found`);
    return u;
  }

  /** Locate the original transition tx for an `alreadyApplied` receipt (best effort, recent window). */
  private async findTx(
    event:
      typeof HEDGE_MARKED | typeof CANCELLED | typeof RESOLVED | typeof CLAIMED | typeof DEPOSITED,
    args: Record<string, Hex>,
  ): Promise<{ hash: Hash; block: number } | null> {
    try {
      const head = await this.o.publicClient.getBlockNumber();
      const from = head > 9_000n ? head - 9_000n : 0n;
      const logs = await this.o.publicClient.getLogs({
        address: this.o.escrow,
        event,
        args: args as never,
        fromBlock: from,
        toBlock: head,
      });
      const l = logs[0];
      return l?.transactionHash ? { hash: l.transactionHash, block: Number(l.blockNumber) } : null;
    } catch {
      return null;
    }
  }
}
