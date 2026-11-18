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
 * Typed client for Dev 4's REST API (apps/api). Response shapes mirror apps/api/src/routes/* and
 * apps/api/src/circle/routes.ts on branch `arc`; they are not in @hedged/shared yet (a gap for
 * Dev 4). Plain fetch through a swappable transport: the dev-only wallet fixture plugs in there.
 */

export type LivePhase = "LIVE" | "PAUSED" | "WAITING_FOR_RESULT" | "RESULT_YES" | "RESULT_NO";
export type PauseReason = "PRICE_ABOVE_THRESHOLD" | "BUDGET_USED" | "NO_LIVE_PRICE";

export interface LiveStateDto {
  phase: LivePhase;
  pauseReason: PauseReason | null;
  canBuy: boolean;
  liveAskMicroUsd: string | null;
  costPerSale: string | null;
  thresholdBps: number;
  budgetRemaining: string;
}

export interface PromotionDto {
  id: string;
  status: "DRAFT" | "ACTIVE";
  promoPda: string | null;
  shop: { merchant: string; name: string; location: string };
  itemName: string;
  offerAmount: string;
  outcomeLabel: string;
  geminiMarketId: string;
  depositDeadline: number;
  maxYesPriceMicroUsd: string;
  hedgeBudget: string;
  onChainState: OnChainPromoState;
  live: LiveStateDto | null;
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
  customer: string;
  amount: string;
  status: PurchaseStatus;
  onChainState: OnChainPurchaseState;
  step: ReceiptStep;
  canServe: boolean;
  message: string;
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
  needsApproval: boolean;
}

export interface ChallengeDto {
  challengeId: string;
}

export interface DepositChallengeDto extends ChallengeDto {
  step: "deposit";
  purchaseIdHex: string;
  purchaseKey: string;
  receipt: string;
}

/**
 * PROPOSED merchant/claim routes (not in apps/api yet; listed for Dev 4). The UI calls them and
 * explains clearly when the server answers 404. The dev fixture implements them.
 */
export interface InitializePromoChallengeDto extends ChallengeDto {
  /** bytes32 promo id = promoIdOf(merchant, promoNonce); pass to POST /confirm. */
  promoId: string;
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
      request<DashboardDto>(`/api/merchants/${id(merchant)}/dashboard`),
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
    faucet: (walletId: string) =>
      request<{ ok: true; address: string; testnet: true }>("/api/wallet/faucet", {
        ...post({ walletId }),
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

    // PROPOSED (gaps for Dev 4): Circle-signed merchant and claim actions, purchase lists.
    initializePromo: (promotionId: string, walletId: string) =>
      request<InitializePromoChallengeDto>(`/api/promotions/${id(promotionId)}/initialize`, {
        ...post({ walletId }),
        auth: true,
      }),
    promotionPurchases: (promotionId: string) =>
      request<{ purchases: PurchaseReceiptDto[] }>(`/api/promotions/${id(promotionId)}/purchases`),
    claimRefund: (purchaseKey: string, walletId: string) =>
      request<ChallengeDto>(`/api/purchases/${id(purchaseKey)}/claim-refund`, {
        ...post({ walletId }),
        auth: true,
      }),
    claimMerchant: (purchaseKeys: string[], walletId: string) =>
      request<ChallengeDto>(`/api/purchases/claim-merchant`, {
        ...post({ walletId, purchaseKeys }),
        auth: true,
      }),
    cancelExpired: (purchaseKey: string, walletId: string) =>
      request<ChallengeDto>(`/api/purchases/${id(purchaseKey)}/cancel-expired`, {
        ...post({ walletId }),
        auth: true,
      }),
  };
}

export type Api = ReturnType<typeof createApi>;

/** Routes the UI needs that apps/api does not have yet: a 404 on these means "not built yet". */
export const PROPOSED_ROUTES = [
  "/initialize",
  "/purchases/claim-merchant",
  "/claim-refund",
  "/cancel-expired",
] as const;

export function isMissingRoute(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 404 &&
    (err.code === "Not Found" || /not found/i.test(String(err.body.message ?? ""))) &&
    PROPOSED_ROUTES.some((r) => err.path.includes(r))
  );
}

const PAUSE_TEXT: Record<PauseReason, string> = {
  PRICE_ABOVE_THRESHOLD: "the market price is above what this shop pays to cover a refund",
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
          title: "Not finalized yet",
          detail: "Devnet hasn't finalized the promo yet. It usually takes under 30 seconds.",
        };
      case "on_chain_promo_does_not_match":
        return {
          title: "Promo mismatch",
          detail: `The on-chain promo differs from the draft (${(b.mismatches as string[] | undefined)?.join(", ") ?? "unknown"}).`,
        };
      case "solana_gateway_unavailable":
        return {
          title: "Backend not on Devnet",
          detail:
            "The promo server is running without a Solana connection, so it can't verify promos.",
        };
      case "promotion_not_found":
        return { title: "Promo not found", detail: "There is no promo at this link." };
      case "purchase_not_found":
        return {
          title: "Receipt not ready",
          detail:
            "The promo server hasn't seen this purchase yet. It appears once Devnet finalizes it.",
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
          title: "Not enough dollars",
          detail: "Your balance is too low for this. Add test dollars, then try again.",
        };
      case "promo_not_buyable":
        return {
          title: "Not selling right now",
          detail: `This promo is paused because ${pauseText(b.pauseReason as PauseReason | null)}. Nothing was charged.`,
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
      case "invalid_email":
        return { title: "Check the email", detail: "That email address doesn't look right." };
      case "invalid_device_id":
        return {
          title: "Browser not recognized",
          detail: "Circle couldn't identify this browser. Reload the page and try again.",
        };
      default:
        if (isMissingRoute(err)) {
          return {
            title: "Not on this server yet",
            detail: `The promo server doesn't have ${err.path.replace(/\?.*$/, "")} yet, so this step can't run from an email wallet.`,
          };
        }
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
