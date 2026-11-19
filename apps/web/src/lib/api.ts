import type {
  MarketOutcome,
  MarketQuote,
  MarketSummary,
  MarketWindow,
  OnChainPromoState,
  OnChainPurchaseState,
  PurchaseStatus,
  HedgeStatus,
  HedgeFailureReason,
} from "@hedged/shared";

/**
 * Typed client for Dev 4's REST API (apps/api), per docs/FRONTEND-API.md (the one guide for the
 * frontend). Response shapes mirror apps/api/src/routes/* and apps/api/src/circle/routes.ts on
 * branch `arc`; they are not in @hedged/shared yet. Plain fetch through a swappable transport: the
 * dev-only wallet fixture plugs in there.
 */

export type LivePhase = "LIVE" | "PAUSED" | "WAITING_FOR_RESULT" | "RESULT_YES" | "RESULT_NO";
export type PauseReason =
  "PRICE_ABOVE_THRESHOLD" | "PRICE_NEAR_THRESHOLD" | "BUDGET_USED" | "NO_LIVE_PRICE";

export interface LiveStateDto {
  phase: LivePhase;
  pauseReason: PauseReason | null;
  canBuy: boolean;
  liveAskMicroUsd: string | null;
  costPerSale: string | null;
  /** Owner view only (the shop's own dashboard); public responses omit it. */
  thresholdBps?: number;
  /** Owner view only. */
  budgetRemaining?: string;
}

export interface PromotionDto {
  id: string;
  status: "DRAFT" | "ACTIVE";
  promoPda: string | null;
  /** `geo` is PROPOSED, not in apps/api yet (scripts/sample-api.mjs sends it); see lib/places.ts. */
  shop: {
    merchant: string;
    name: string;
    location: string;
    geo?: { lat: number; lng: number } | null;
  };
  itemName: string;
  offerAmount: string;
  outcomeLabel: string;
  geminiMarketId: string;
  depositDeadline: number;
  /** Owner view only: public responses hide the shop's max cost. */
  maxYesPriceMicroUsd?: string;
  /** Owner view only. */
  hedgeBudget?: string;
  onChainState: OnChainPromoState;
  live: LiveStateDto | null;
  /**
   * PROPOSED, not in apps/api yet: the shop's coupon count. scripts/sample-api.mjs sends it; the
   * real API doesn't, so lib/coupons.ts falls back to this browser's registry.
   */
  coupons?: { total: number; sold: number } | null;
}

/** SIMULATED: assumes the simulated fills were real. */
export interface PromoStatsDto {
  purchases: number;
  hedged: number;
  refundedOrCancelled: number;
  hedgedSales: string;
  contracts: string;
  premium: string;
  ifYes: string;
  ifNo: string;
}

export interface DashboardDto {
  merchant: { pubkey: string; shopName: string; location: string; createdAt: string } | null;
  /** "owner" when X-User-Token is the shop's own Circle login (budget and max cost included). */
  viewer?: "owner" | "public";
  simulatedHedges: true;
  promotions: (PromotionDto & { stats: PromoStatsDto })[];
}

export type ReceiptStep =
  | "PROCESSING"
  | "HEDGED"
  | "REFUNDING"
  | "REFUND_READY"
  | "REFUNDED"
  | "WAITING_FOR_RESULT"
  | "YOU_WON"
  | "NOT_THIS_TIME"
  | "DONE";

export interface PurchaseReceiptDto {
  purchasePda: string;
  /** 4 characters, also on the counter feed, so staff can match the two. */
  orderCode: string;
  customer: string;
  amount: string;
  status: PurchaseStatus;
  onChainState: OnChainPurchaseState;
  step: ReceiptStep;
  canServe: boolean;
  message: string;
  /** true (escrow v2): refunds and payouts are sent automatically, so show no claim button. */
  autoPayout: boolean;
  promotion: {
    id: string;
    shopName: string;
    itemName: string;
    outcomeLabel: string;
    geminiMarketId: string;
    resolvedOutcome: "YES" | "NO" | null;
  };
  /** Always simulated: no Gemini order is ever placed. */
  hedge: {
    simulated: true;
    status: HedgeStatus;
    failureReason: HedgeFailureReason | null;
    contracts: string;
    avgFillPriceMicroUsd: string | null;
    premium: string | null;
    virtualPayout: string | null;
    quoteFetchedAt: string | null;
    fingerprint: string;
  } | null;
  transactions: {
    deposit: string | null;
    markHedged: string | null;
    cancel: string | null;
    claim: string | null;
  };
}

/** One row of a purchase list (counter feed, a customer's purchases): no hedge detail. */
export interface PurchaseSummaryDto {
  purchasePda: string;
  orderCode: string;
  customer: string;
  amount: string;
  /** Unix seconds (on-chain deposit time). */
  depositedAt: number;
  status: PurchaseStatus;
  onChainState: OnChainPurchaseState;
  step: ReceiptStep;
  canServe: boolean;
  message: string;
  autoPayout: boolean;
  /** Path of the full receipt (GET /api/purchases/:purchaseKey). */
  receipt: string;
}

/** GET /api/purchases?customer=: a summary plus which promo it was. */
export interface CustomerPurchaseDto extends PurchaseSummaryDto {
  promotion: {
    id: string;
    shopName: string;
    itemName: string;
    outcomeLabel: string;
    resolvedOutcome: "YES" | "NO" | null;
  };
}

export interface SimulatedEstimate {
  simulated: true;
  marketId: string;
  status: "SIMULATED_FILLED" | "SIMULATED_PARTIAL" | "FAILED";
  failureReason: HedgeFailureReason | null;
  requestedContracts: string;
  filledContracts: string;
  avgFillPriceMicroUsd: string | null;
  premium: string | null;
  modeledFee: string;
  quoteFetchedAt: string;
  assumptions: string[];
}

export interface QuoteDto {
  quote: MarketQuote;
  eventTicker: string;
  eventTitle: string;
  outcomeLabel: string;
  marketState: string | undefined;
  estimate: SimulatedEstimate | null;
}

export interface DeadlineCheckDto {
  marketId: string;
  marketKind: "UP_DOWN" | "STANDARD";
  ok: boolean;
  latest: number | null;
  reason?:
    | "MARKET_NOT_OPEN"
    | "MARKET_TIMING_UNKNOWN"
    | "DEADLINE_TOO_SOON"
    | "DEADLINE_AFTER_LAST_HEDGEABLE_TIME";
}

export interface CreatePromotionInput {
  merchant: string;
  shopName: string;
  location?: string;
  itemName: string;
  geminiMarketId: string;
  outcomeLabel?: string;
  offerAmount: string;
  depositDeadline: number;
  maxYesPriceMicroUsd: string;
  hedgeBudget: string;
}

export interface CreatePromotionDto {
  promotion: PromotionDto;
  initializePromo: {
    promoNonce: string;
    offerAmount: string;
    depositDeadline: number;
    marketId: string;
  };
}

/* ---------- Circle email-login wallets + Arc checkout (docs/email-wallets.md) ---------- */

export interface EmailLoginDto {
  appId: string;
  deviceToken: string;
  deviceEncryptionKey: string;
  otpToken: string;
}

export interface WalletDto {
  id: string;
  address: string;
  blockchain: string;
  /** USDC, 6-decimal base units. */
  usdcBalance: string;
}

export interface CheckoutStatusDto {
  promoId: string;
  price: string;
  canBuy: boolean;
  pauseReason: PauseReason | null;
  usdcBalance: string;
  enoughBalance: boolean;
  /**
   * Which flow to run. "one-tap" (escrow v2 + our relayer): /sign, Circle signature, /submit.
   * "approve-deposit" (escrow v1, the fallback): /approve if needsApproval, then /deposit.
   */
  checkout: "one-tap" | "approve-deposit";
  /** Only ever true on "approve-deposit". */
  needsApproval: boolean;
}

export interface ChallengeDto {
  challengeId: string;
}

/** v1 fallback: the deposit challenge. */
export interface DepositChallengeDto extends ChallengeDto {
  step: "deposit";
  purchaseIdHex: string;
  purchaseKey: string;
  receipt: string;
}

/** v2 one-tap, step 1: a typed-data signature challenge for exactly the promo price. */
export interface SignChallengeDto extends ChallengeDto {
  step: "sign";
  purchaseIdHex: string;
  purchaseKey: string;
  /** Unix seconds; the signature is valid until then (5 minutes, capped at the deadline). */
  validBefore: number;
  /** Path to POST the signature to (= /api/checkout/:promoId/submit). */
  submit: string;
}

/** v2 one-tap, step 2: our relayer sent the payment on Arc and it landed. */
export interface SubmitDto {
  step: "submitted";
  purchaseKey: string;
  receipt: string;
  txHash: string | null;
  alreadyApplied?: boolean;
}

/** POST /api/promotions/:id/initialize: the shop approves creating its draft on Arc. */
export interface InitializePromoChallengeDto extends ChallengeDto {
  /** bytes32 promo id = promoIdOf(merchant, promoNonce); pass to POST /confirm. */
  promoPda: string;
  /** Path of the confirm call. */
  confirm: string;
}

/** Customer refund claim or timeout cancel. */
export interface PurchaseChallengeDto extends ChallengeDto {
  purchaseKey: string;
}

/** One priced line of a game (GET /api/events/:ticker/lines); costs are a simulated hedge. */
export interface PricedLineDto {
  marketId: string;
  eventTitle: string;
  label: string;
  bestAskMicroUsd: string | null;
  costPerSale: string | null;
  fits: boolean;
  reason: string | null;
}

/** fetch-compatible transport; the fixture replaces it in dev. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** The API answered with an error status. `code` is the API's `error` field. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
    readonly path = "",
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

/** The API did not answer at all (server down, wrong URL, CORS). */
export class ApiUnreachableError extends Error {
  constructor(readonly baseUrl: string) {
    super(`Can't reach the promo server at ${baseUrl}`);
    this.name = "ApiUnreachableError";
  }
}

export function createApi(
  baseUrl: string,
  opts: { transport?: Transport; userToken?: () => string | null } = {},
) {
  const transport: Transport = opts.transport ?? ((u, i) => fetch(u, i));

  async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
    const headers: Record<string, string> = {};
    if (init?.body) headers["content-type"] = "application/json";
    if (init?.auth) {
      const t = opts.userToken?.();
      if (t) headers["x-user-token"] = t;
    }
    let res: Response;
    try {
      res = await transport(`${baseUrl}${path}`, { ...init, headers, cache: "no-store" });
    } catch {
      throw new ApiUnreachableError(baseUrl);
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: "bad_json" };
    }
    if (!res.ok) throw new ApiError(res.status, String(body.error ?? res.statusText), body, path);
    return body as T;
  }
  const q = (params: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) s.set(k, String(v));
    const str = s.toString();
    return str ? `?${str}` : "";
  };
  const id = encodeURIComponent;
  const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

  return {
    baseUrl,
    health: () => request<{ status: string; time: string }>("/health"),
    windows: (asset = "SOL", windowMinutes = 5, limit = 12) =>
      request<{ source: string; asset: string; windows: MarketWindow[] }>(
        `/api/markets/windows${q({ asset, windowMinutes, limit })}`,
      ),
    markets: (search: string, limit = 20) =>
      request<{ source: string; totalEvents: number; markets: MarketSummary[] }>(
        `/api/markets${q({ search: search || undefined, limit })}`,
      ),
    quote: (marketId: string, refundAmount?: string, maxYesPriceMicroUsd?: string) =>
      request<QuoteDto>(
        `/api/markets/${id(marketId)}/quote${q({ refundAmount, maxYesPriceMicroUsd })}`,
      ),
    deadlineCheck: (marketId: string, depositDeadline: number) =>
      request<DeadlineCheckDto>(
        `/api/markets/${id(marketId)}/deadline-check${q({ depositDeadline })}`,
      ),
    outcome: (marketId: string) =>
      request<{ marketId: string; outcome: MarketOutcome | null }>(
        `/api/markets/${id(marketId)}/outcome`,
      ),
    lines: (eventTicker: string, team: string, refundAmount: string, maxCostBps: number) =>
      request<{ lines: PricedLineDto[]; suggested: PricedLineDto | null; simulated: true }>(
        `/api/events/${id(eventTicker)}/lines${q({ team, refundAmount, maxCostBps })}`,
      ),
    promotions: () => request<{ promotions: PromotionDto[] }>("/api/promotions"),
    promotion: (promotionId: string) =>
      request<{ promotion: PromotionDto }>(`/api/promotions/${id(promotionId)}`),
    createPromotion: (input: CreatePromotionInput) =>
      request<CreatePromotionDto>("/api/promotions", post(input)),
    confirmPromotion: (promotionId: string, promoPda: string) =>
      request<{ promotion: PromotionDto }>(
        `/api/promotions/${id(promotionId)}/confirm`,
        post({ promoPda }),
      ),
    dashboard: (merchant: string) =>
      request<DashboardDto>(`/api/merchants/${id(merchant)}/dashboard`, { auth: true }),
    purchase: (purchaseKey: string) =>
      request<PurchaseReceiptDto>(`/api/purchases/${id(purchaseKey)}`),

    // Email-login wallets (X-User-Token).
    emailLogin: (email: string, deviceId: string) =>
      request<EmailLoginDto>("/api/wallet/email-login", post({ email, deviceId })),
    walletInit: () =>
      request<ChallengeDto | { alreadyInitialized: true }>("/api/wallet/init", {
        ...post({}),
        auth: true,
      }),
    wallets: () => request<{ wallets: WalletDto[] }>("/api/wallet", { auth: true }),
    /**
     * Add money (testnet: Circle's faucet). `amount` is what the person picked; the real API
     * ignores it (Circle drips a fixed amount), the dev fixture adds exactly that.
     */
    faucet: (walletId: string, amount?: string) =>
      request<{ ok: true; address: string; testnet: true }>("/api/wallet/faucet", {
        ...post(amount ? { walletId, amount } : { walletId }),
        auth: true,
      }),

    // Arc checkout.
    checkoutStatus: (promotionId: string, walletId: string) =>
      request<CheckoutStatusDto>(`/api/checkout/${id(promotionId)}/status${q({ walletId })}`, {
        auth: true,
      }),
    checkoutApprove: (promotionId: string, walletId: string) =>
      request<ChallengeDto & { step: "approve"; allowance: string }>(
        `/api/checkout/${id(promotionId)}/approve`,
        { ...post({ walletId }), auth: true },
      ),
    checkoutDeposit: (promotionId: string, walletId: string) =>
      request<DepositChallengeDto>(`/api/checkout/${id(promotionId)}/deposit`, {
        ...post({ walletId }),
        auth: true,
      }),
    // v2 one-tap: sign once (Circle), then our relayer submits and pays the gas.
    checkoutSign: (promotionId: string, walletId: string) =>
      request<SignChallengeDto>(`/api/checkout/${id(promotionId)}/sign`, {
        ...post({ walletId }),
        auth: true,
      }),
    checkoutSubmit: (
      promotionId: string,
      submitPath: string | undefined,
      body: { walletId: string; purchaseIdHex: string; validBefore: number; signature: string },
    ) =>
      request<SubmitDto>(
        // The server names the path; only a checkout path on this same server is accepted.
        submitPath && /^\/api\/checkout\/[^/?#]+\/submit$/.test(submitPath)
          ? submitPath
          : `/api/checkout/${id(promotionId)}/submit`,
        { ...post(body), auth: true },
      ),

    // Shop: publish a draft from the email wallet; counter feed; collect after NO (fallback).
    initializePromo: (promotionId: string, walletId: string) =>
      request<InitializePromoChallengeDto>(`/api/promotions/${id(promotionId)}/initialize`, {
        ...post({ walletId }),
        auth: true,
      }),
    promotionPurchases: (promotionId: string) =>
      request<{ promotionId: string; purchases: PurchaseSummaryDto[] }>(
        `/api/promotions/${id(promotionId)}/purchases`,
      ),
    claimMerchant: (purchaseKeys: string[], walletId: string) =>
      request<{ challenges: { purchaseKey: string; challengeId: string }[] }>(
        `/api/purchases/claim-merchant`,
        { ...post({ walletId, purchaseKeys }), auth: true },
      ),

    // Customer: own purchases; refund claim and timeout cancel (fallbacks on escrow v2).
    customerPurchases: (customer: string) =>
      request<{ customer: string; purchases: CustomerPurchaseDto[] }>(
        `/api/purchases${q({ customer })}`,
      ),
    claimRefund: (purchaseKey: string, walletId: string) =>
      request<PurchaseChallengeDto>(`/api/purchases/${id(purchaseKey)}/claim-refund`, {
        ...post({ walletId }),
        auth: true,
      }),
    cancelExpired: (purchaseKey: string, walletId: string) =>
      request<PurchaseChallengeDto>(`/api/purchases/${id(purchaseKey)}/cancel-expired`, {
        ...post({ walletId }),
        auth: true,
      }),
  };
}

export type Api = ReturnType<typeof createApi>;

const PAUSE_TEXT: Record<PauseReason, string> = {
  PRICE_ABOVE_THRESHOLD: "the market price is above what this shop pays to cover a refund",
  PRICE_NEAR_THRESHOLD: "the market price is right at the shop's limit",
  BUDGET_USED: "the shop has used its budget for covering refunds",
  NO_LIVE_PRICE: "no one is selling this outcome on Gemini right now",
};

export function pauseText(reason: PauseReason | null | undefined): string {
  return reason ? PAUSE_TEXT[reason] : "it isn't selling right now";
}

const DEADLINE_REASONS: Record<NonNullable<DeadlineCheckDto["reason"]>, string> = {
  MARKET_NOT_OPEN: "This market is no longer open on Gemini.",
  MARKET_TIMING_UNKNOWN:
    "Gemini doesn't say when this market closes, so a safe deadline can't be set.",
  DEADLINE_TOO_SOON: "Sales would close in under a minute. Pick a later market or deadline.",
  DEADLINE_AFTER_LAST_HEDGEABLE_TIME:
    "Sales would run past the last moment the shop can still cover its refunds.",
};

export function describeDeadlineReason(reason: DeadlineCheckDto["reason"]): string {
  return reason ? DEADLINE_REASONS[reason] : "The deadline is not allowed for this market.";
}

/** One readable sentence for any API failure. */
export function describeApiError(err: unknown): { title: string; detail: string } {
  if (err instanceof ApiUnreachableError) {
    return {
      title: "Promo server offline",
      detail: `Can't reach the promo server at ${err.baseUrl}. On-chain data still loads; live prices and hedge status will come back when it does.`,
    };
  }
  if (err instanceof ApiError) {
    const b = err.body;
    switch (err.code) {
      case "market_not_found":
        return { title: "Market not found", detail: "Gemini has no market with that id." };
      case "market_not_open":
        return { title: "Market closed", detail: "This Gemini market is not open for trading." };
      case "quote_unavailable":
        return {
          title: "No live price",
          detail:
            "No one is selling this outcome on Gemini right now, so the refund can't be covered.",
        };
      case "gemini_unavailable":
        return {
          title: "Gemini unavailable",
          detail: "Gemini's market data did not answer. Try again.",
        };
      case "invalid_deposit_deadline":
        return {
          title: "Deadline not allowed",
          detail: describeDeadlineReason(b.reason as DeadlineCheckDto["reason"]),
        };
      case "invalid_field":
        return { title: "Check the form", detail: `The ${String(b.field)} field is not valid.` };
      case "rate_limited":
        return {
          title: "Too many requests",
          detail: `Wait ${String(b.retryAfterSeconds ?? 30)} seconds and try again.`,
        };
      case "promo_not_found_on_chain_yet":
        return {
          title: "Not confirmed yet",
          detail: "Arc hasn't confirmed the promo yet. It usually takes a few seconds.",
        };
      case "on_chain_promo_does_not_match":
        return {
          title: "Promo mismatch",
          detail: `The on-chain promo differs from the draft (${(b.mismatches as string[] | undefined)?.join(", ") ?? "unknown"}).`,
        };
      case "solana_gateway_unavailable":
        return {
          title: "Promo server not on chain",
          detail:
            "The promo server is running without a chain connection (SOLANA_GATEWAY), so it can't verify promos.",
        };
      case "promotion_not_found":
        return { title: "Promo not found", detail: "There is no promo at this link." };
      case "purchase_not_found":
        return {
          title: "Receipt not ready",
          detail:
            "The promo server hasn't seen this purchase yet. It appears once Arc confirms it.",
        };
      case "merchant_not_found":
        return { title: "No promos yet", detail: "This wallet hasn't created a promo." };
      // Email-login wallets + Arc checkout (docs/email-wallets.md).
      case "login_required":
        return { title: "Log in first", detail: "Log in with your email to continue." };
      case "circle_session_invalid":
        return {
          title: "Sign-in expired",
          detail: "Your email sign-in has expired. Log in again with a new code.",
        };
      case "approval_needed":
        return {
          title: "One-time approval needed",
          detail: "Approve payments from your wallet once, then pay.",
        };
      case "already_approved":
        return { title: "Already approved", detail: "Your wallet can already pay this shop." };
      case "insufficient_usdc":
        return {
          title: "Not enough in your balance",
          detail: "Add money, then pay again. Nothing was charged.",
        };
      case "promo_not_buyable":
        return {
          title: b.pauseReason === "BUDGET_USED" ? "Sold out" : "Back in a moment",
          detail:
            b.pauseReason === "BUDGET_USED"
              ? "Every coupon for this promo is taken. Nothing was charged."
              : "Sales paused for a moment. Nothing was charged; try again shortly.",
        };
      case "not_an_arc_promotion":
        return {
          title: "Not an Arc promo",
          detail:
            "This promo was made on the earlier Solana version and can't take email-wallet payments.",
        };
      case "wallet_not_found":
        return {
          title: "Wallet not found",
          detail: "That wallet doesn't belong to this sign-in. Log out and log in again.",
        };
      case "wallets_disabled":
        return {
          title: "Email login is off on this server",
          detail: "The promo server isn't connected to Circle and Arc yet.",
        };
      case "faucet_unavailable":
        return {
          title: "Circle's faucet said no",
          detail:
            "Circle limits test USDC to about once a day per wallet. Use faucet.circle.com (Arc Testnet) with your wallet address instead.",
        };
      case "circle_error": {
        const msg = String(b.message ?? b.code ?? "unknown error").replace(/\.+$/, "");
        if (/smtp/i.test(msg)) {
          return {
            title: "Email codes aren't switched on yet",
            detail:
              "Circle can't send login codes because the app's email (SMTP) settings are missing in Circle's developer console. Nothing was sent; ask the team to finish that setting.",
          };
        }
        return {
          title: "Circle didn't accept that",
          detail: `Circle answered: ${msg}. Try again in a moment.`,
        };
      }
      // One-tap checkout (escrow v2).
      case "signature_expired":
        return {
          title: "Approval expired",
          detail:
            "The payment approval is only valid for 5 minutes. Nothing was charged. Pay again.",
        };
      case "deposit_rejected":
        return {
          title: "Payment refused on Arc",
          detail: "Arc didn't accept the signed payment, so nothing was taken. Try again.",
        };
      case "relayer_unavailable":
        return {
          title: "Payment not sent yet",
          detail:
            "The promo server couldn't reach Arc to send your payment. Nothing was taken; try again in a moment.",
        };
      case "one_tap_unavailable":
        return {
          title: "One-tap checkout is off",
          detail: "This server uses the two-step checkout. Reload the page and pay again.",
        };
      case "invalid_signature":
        return { title: "No signature", detail: "Circle didn't return a signature. Pay again." };
      // Shop publish and collect.
      case "not_this_shops_wallet":
        return {
          title: "Wrong shop wallet",
          detail: "This promo belongs to another shop's email wallet. Log in with that email.",
        };
      case "already_published":
        return { title: "Already published", detail: "This promo is already live." };
      case "deadline_passed":
        return {
          title: "Deadline passed",
          detail: "Sales would already be closed, so this draft can't be published.",
        };
      case "not_this_shops_purchase":
        return {
          title: "Not your sale",
          detail: "One of these purchases belongs to another shop.",
        };
      case "nothing_to_collect":
        return {
          title: "Nothing to collect",
          detail: 'Not resolved "no" yet, or already paid to the shop.',
        };
      case "invalid_purchase_keys":
        return { title: "Nothing selected", detail: "Pick 1 to 20 purchases to collect." };
      // Customer refund claim and timeout cancel.
      case "not_your_purchase":
        return {
          title: "Not your purchase",
          detail: "Only the email wallet that paid can do this. Log in with that email.",
        };
      case "nothing_to_claim":
        return {
          title: "Nothing to claim",
          detail: "This purchase isn't refundable right now, or the money is already back.",
        };
      case "not_cancellable":
        return {
          title: "Can't cancel",
          detail: "Only a payment that is still waiting to be covered can be cancelled.",
        };
      case "invalid_customer":
        return { title: "Wallet address not valid", detail: "Log out and log in again." };
      case "invalid_email":
        return { title: "Check the email", detail: "That email address doesn't look right." };
      case "invalid_device_id":
        return {
          title: "Browser not recognized",
          detail: "Circle couldn't identify this browser. Reload the page and try again.",
        };
      default:
        return {
          title: "Request failed",
          detail: `The promo server answered ${err.status} (${err.code}).`,
        };
    }
  }
  return {
    title: "Something went wrong",
    detail: err instanceof Error ? err.message : String(err),
  };
}
