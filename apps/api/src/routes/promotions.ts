import { randomBytes } from "node:crypto";
import type { SolanaServerGateway } from "@hedged/shared";
import type { FastifyInstance } from "fastify";
import type { GeminiAdapter } from "../gemini/adapter";
import { checkDepositDeadline } from "../promotions/deadline";
import {
  liveState,
  promoStats,
  publicLiveState,
  soldCoupons,
  type LiveState,
} from "../promotions/live-state";
import { PromotionConflictError, type PromotionRow, type Store } from "../store/types";
import { canonical, isChainId, isWalletAddress, sameChainString } from "../chain-ids";
import { sendGeminiError } from "./markets";

export interface PromotionRouteDeps {
  gemini: Pick<GeminiAdapter, "getMarket" | "getQuote">;
  store: Store;
  /** null when no Solana gateway is configured (SOLANA_GATEWAY=none). */
  gateway: SolanaServerGateway | null;
  now?: () => Date;
  /**
   * Is this request from the shop's own wallet? (Circle login: X-User-Token whose wallet address is
   * the merchant.) Absent = never; the dashboard then shows the public view only.
   */
  isMerchant?: (headers: Record<string, unknown>, merchant: string) => Promise<boolean>;
}

const UINT = /^\d{1,18}$/;
/** $1,000 in base units: a sanity cap for a single item price. */
const MAX_OFFER = 1_000_000_000n;

/**
 * Promotion lifecycle (docs/interfaces.md §6):
 *   1. POST /api/promotions            -> DRAFT + the exact initialize_promo arguments
 *   2. merchant's wallet signs initialize_promo with those arguments (Dev 1 / Dev 3 SDK)
 *   3. POST /api/promotions/:id/confirm -> backend reads the promo from chain; ACTIVE only if
 *      merchant, nonce, price, deadline and market all match. The merchant's on-chain signature is
 *      what proves they own the wallet, so drafts need no separate login.
 * Customers browse GET /api/promotions (ACTIVE only) and check GET /api/promotions/:id before paying.
 */
export function registerPromotionRoutes(app: FastifyInstance, deps: PromotionRouteDeps): void {
  const nowUnix = () => Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);

  app.post<{ Body: Record<string, unknown> }>("/api/promotions", async (req, reply) => {
    const parsed = parseCreate(req.body ?? {});
    if ("error" in parsed) return reply.code(400).send(parsed);
    const input = parsed.value;

    let market;
    try {
      market = await deps.gemini.getMarket(input.geminiMarketId);
    } catch (err) {
      return sendGeminiError(reply, err);
    }
    const deadline = checkDepositDeadline(market, input.depositDeadline, nowUnix());
    if (!deadline.ok) {
      return reply.code(422).send({ error: "invalid_deposit_deadline", ...deadline });
    }

    const promo = await deps.store.createPromotion({
      promoPda: null,
      promoNonce: randomBytes(8).readBigUInt64LE().toString(),
      mint: null,
      merchant: input.merchant,
      itemName: input.itemName,
      shopName: input.shopName,
      location: input.location,
      offerAmount: input.offerAmount,
      depositDeadline: input.depositDeadline,
      geminiMarketId: market.marketId,
      outcomeLabel: input.outcomeLabel ?? `${market.eventTitle}: ${market.outcomeLabel}`,
      maxYesPriceMicroUsd: input.maxYesPriceMicroUsd,
      hedgeBudget: input.hedgeBudget,
      couponTotal: input.coupons,
    });
    return reply.code(201).send({
      promotion: await toDto(promo, null, "owner"),
      // Exactly what the merchant's wallet must sign (initialize_promo args).
      initializePromo: {
        promoNonce: promo.promoNonce,
        offerAmount: promo.offerAmount.toString(),
        depositDeadline: promo.depositDeadline,
        marketId: promo.geminiMarketId,
      },
    });
  });

  app.post<{ Params: { id: string }; Body: { promoPda?: unknown } }>(
    "/api/promotions/:id/confirm",
    async (req, reply) => {
      const rawPda = req.body?.promoPda;
      if (!isChainId(rawPda)) {
        return reply.code(400).send({ error: "invalid_promo_pda" });
      }
      const promoPda = canonical(rawPda);
      const promo = await deps.store.getPromotion(req.params.id);
      if (!promo) return reply.code(404).send({ error: "promotion_not_found" });
      if (promo.status === "ACTIVE" && promo.promoPda === promoPda) {
        return { promotion: await toDto(promo, null, "public") };
      }
      if (!deps.gateway) return reply.code(503).send({ error: "solana_gateway_unavailable" });

      const chain = await deps.gateway.getPromoState(promoPda, "finalized");
      if (!chain) return reply.code(409).send({ error: "promo_not_found_on_chain_yet" });
      const mismatches = [
        !sameChainString(chain.merchant, promo.merchant) && "merchant",
        chain.promoNonce !== promo.promoNonce && "promoNonce",
        chain.offerAmount !== promo.offerAmount.toString() && "offerAmount",
        chain.depositDeadline !== promo.depositDeadline && "depositDeadline",
        chain.marketId !== promo.geminiMarketId && "marketId",
        chain.state !== "Active" && "state",
      ].filter(Boolean);
      if (mismatches.length > 0) {
        return reply.code(409).send({ error: "on_chain_promo_does_not_match", mismatches });
      }
      try {
        const active = await deps.store.activatePromotion(promo.id, {
          promoPda,
          mint: chain.mint,
        });
        // Only now is the profile known to come from the wallet's owner.
        await deps.store.upsertMerchant({
          pubkey: active.merchant,
          shopName: active.shopName,
          location: active.location,
        });
        return { promotion: await toDto(active, null, "public") };
      } catch (err) {
        if (err instanceof PromotionConflictError) {
          return reply.code(409).send({ error: "promotion_conflict", message: err.message });
        }
        throw err;
      }
    },
  );

  // Public directory: every ACTIVE promo with its live status. LIVE ones first.
  app.get("/api/promotions", async () => {
    const promos = await deps.store.listPromotions({ status: "ACTIVE" });
    const asks = await liveAsks(promos);
    const items = await Promise.all(
      promos.map((p) => toDto(p, asks.get(p.geminiMarketId), "public")),
    );
    const order = { LIVE: 0, PAUSED: 1, WAITING_FOR_RESULT: 2, RESULT_YES: 3, RESULT_NO: 4 };
    items.sort((a, b) => order[a.live!.phase] - order[b.live!.phase]);
    return { promotions: items };
  });

  // One promo, with `live.canBuy` for the checkout pre-check.
  app.get<{ Params: { id: string } }>("/api/promotions/:id", async (req, reply) => {
    const promo = await deps.store.getPromotion(req.params.id);
    if (!promo) return reply.code(404).send({ error: "promotion_not_found" });
    const asks = promo.status === "ACTIVE" ? await liveAsks([promo]) : new Map();
    return { promotion: await toDto(promo, asks.get(promo.geminiMarketId), "public") };
  });

  // Merchant dashboard (drafts included). Sales and hedge stats are derivable from public chain data
  // and Gemini prices, so they are always shown; the shop's max cost and budget only to the shop.
  app.get<{ Params: { pubkey: string } }>(
    "/api/merchants/:pubkey/dashboard",
    async (req, reply) => {
      const pubkey = canonical(req.params.pubkey);
      if (!isWalletAddress(req.params.pubkey)) {
        return reply.code(400).send({ error: "invalid_merchant" });
      }
      // Profile is null until the merchant's first promo is confirmed on-chain.
      const merchant = await deps.store.getMerchant(pubkey);
      const promos = await deps.store.listPromotions({ merchant: pubkey });
      if (!merchant && promos.length === 0) {
        return reply.code(404).send({ error: "merchant_not_found" });
      }
      const audience =
        deps.isMerchant && (await deps.isMerchant(req.headers, pubkey).catch(() => false))
          ? "owner"
          : "public";
      const asks = await liveAsks(promos.filter((p) => p.status === "ACTIVE"));
      const promotions = await Promise.all(
        promos.map(async (p) => {
          const purchases = await deps.store.listPurchases(p.id);
          return {
            ...(await toDto(p, asks.get(p.geminiMarketId), audience, purchases)),
            stats: promoStats(purchases, await deps.store.listHedgesByPromotion(p.id)),
          };
        }),
      );
      return { merchant, viewer: audience, simulatedHedges: true, promotions };
    },
  );

  /** Live best ask per market, fetched once per market; null if Gemini has no price. */
  async function liveAsks(promos: PromotionRow[]): Promise<Map<string, bigint | null>> {
    const now = nowUnix();
    const markets = [
      ...new Set(
        promos
          .filter((p) => p.onChainState === "Active" && now < p.depositDeadline)
          .map((p) => p.geminiMarketId),
      ),
    ];
    const entries = await Promise.all(
      markets.map(async (m) => {
        try {
          return [m, BigInt((await deps.gemini.getQuote(m)).quote.yesAskMicroUsd)] as const;
        } catch {
          return [m, null] as const;
        }
      }),
    );
    return new Map(entries);
  }

  /**
   * `audience: "public"` (directory, checkout pre-check) leaves out the shop's max cost and budget;
   * `"owner"` (create/confirm responses, merchant dashboard) includes them.
   */
  async function toDto(
    p: PromotionRow,
    liveAsk: bigint | null | undefined,
    audience: "public" | "owner",
    /** Already-loaded purchases for this promo; read from the store when needed and not given. */
    purchases?: Awaited<ReturnType<Store["listPurchases"]>>,
  ) {
    // Coupon counts are public (the "64 left" on every phone); only read purchases when there is one.
    const sold =
      p.couponTotal === null || p.status !== "ACTIVE"
        ? 0
        : soldCoupons(purchases ?? (await deps.store.listPurchases(p.id)));
    const live: LiveState | null =
      p.status === "ACTIVE" ? liveState(p, liveAsk ?? null, nowUnix(), sold) : null;
    const base = {
      id: p.id,
      status: p.status,
      promoPda: p.promoPda,
      shop: { merchant: p.merchant, name: p.shopName, location: p.location },
      itemName: p.itemName,
      offerAmount: p.offerAmount.toString(),
      outcomeLabel: p.outcomeLabel,
      geminiMarketId: p.geminiMarketId,
      depositDeadline: p.depositDeadline,
      onChainState: p.onChainState,
      coupons: p.couponTotal === null ? null : { total: p.couponTotal, sold },
    };
    if (audience === "public") return { ...base, live: live && publicLiveState(live) };
    return {
      ...base,
      maxYesPriceMicroUsd: p.maxYesPriceMicroUsd.toString(),
      hedgeBudget: p.hedgeBudget.toString(),
      live,
    };
  }
}

interface CreateInput {
  merchant: string;
  shopName: string;
  location: string;
  itemName: string;
  geminiMarketId: string;
  outcomeLabel: string | undefined;
  offerAmount: bigint;
  depositDeadline: number;
  maxYesPriceMicroUsd: bigint;
  hedgeBudget: bigint;
  coupons: number | null;
}

function parseCreate(
  b: Record<string, unknown>,
): { value: CreateInput } | { error: string; field: string } {
  const bad = (field: string) => ({ error: "invalid_field", field });
  const str = (k: string, min: number, max: number) =>
    typeof b[k] === "string" &&
    (b[k] as string).trim().length >= min &&
    (b[k] as string).length <= max
      ? (b[k] as string).trim()
      : null;
  const uint = (k: string) =>
    typeof b[k] === "string" && UINT.test(b[k] as string) ? BigInt(b[k] as string) : null;

  const merchant = isWalletAddress(b.merchant) ? canonical(b.merchant) : null;
  if (!merchant) return bad("merchant");
  const shopName = str("shopName", 1, 80);
  if (!shopName) return bad("shopName");
  const location = b.location === undefined ? "" : str("location", 0, 120);
  if (location === null) return bad("location");
  const itemName = str("itemName", 1, 60);
  if (!itemName) return bad("itemName");
  const geminiMarketId = str("geminiMarketId", 1, 64);
  if (!geminiMarketId) return bad("geminiMarketId");
  const outcomeLabel = b.outcomeLabel === undefined ? undefined : str("outcomeLabel", 1, 120);
  if (outcomeLabel === null) return bad("outcomeLabel");
  const offerAmount = uint("offerAmount");
  if (offerAmount === null || offerAmount === 0n || offerAmount > MAX_OFFER)
    return bad("offerAmount");
  const depositDeadline =
    typeof b.depositDeadline === "number" && Number.isInteger(b.depositDeadline)
      ? b.depositDeadline
      : null;
  if (depositDeadline === null) return bad("depositDeadline");
  const maxYesPriceMicroUsd = uint("maxYesPriceMicroUsd");
  if (
    maxYesPriceMicroUsd === null ||
    maxYesPriceMicroUsd === 0n ||
    maxYesPriceMicroUsd > 1_000_000n
  ) {
    return bad("maxYesPriceMicroUsd");
  }
  const hedgeBudget = uint("hedgeBudget");
  if (hedgeBudget === null) return bad("hedgeBudget");
  // Optional coupon count: a whole number 1-100,000 (a numeric string is accepted too).
  const rawCoupons =
    typeof b.coupons === "string" && /^\d{1,6}$/.test(b.coupons) ? Number(b.coupons) : b.coupons;
  const coupons =
    rawCoupons === undefined || rawCoupons === null
      ? null
      : Number.isInteger(rawCoupons) &&
          (rawCoupons as number) >= 1 &&
          (rawCoupons as number) <= 100_000
        ? (rawCoupons as number)
        : undefined;
  if (coupons === undefined) return bad("coupons");
  return {
    value: {
      merchant,
      shopName,
      location,
      itemName,
      geminiMarketId,
      outcomeLabel,
      offerAmount,
      depositDeadline,
      maxYesPriceMicroUsd,
      hedgeBudget,
      coupons,
    },
  };
}
