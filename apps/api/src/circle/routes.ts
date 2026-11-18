import { randomUUID } from "node:crypto";
import { buildApproveTx, buildDepositTx, newPurchaseIdHex, purchaseKeyOf } from "@hedged/arc";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Address, Hex } from "viem";
import { canonical } from "../chain-ids";
import type { GeminiAdapter } from "../gemini/adapter";
import { liveState } from "../promotions/live-state";
import type { Store } from "../store/types";
import type { ArcReads } from "./arc-reads";
import { ALREADY_INITIALIZED, CircleError, type CircleClient } from "./client";

/**
 * Email-login wallets (Circle user-controlled wallets) + checkout on Arc.
 *
 * The browser runs Circle's web SDK: it gets a `deviceId`, asks us to start the email login, shows
 * Circle's code screen, and receives a `userToken`. It sends that token to us as `X-User-Token`;
 * we never see the user's key. Every action that moves money returns a Circle `challengeId` that
 * the SDK shows to the user to approve (`sdk.execute(challengeId)`): nothing is signed here.
 *
 * Checkout on Arc is approve + deposit. The first approval allows up to `allowanceCap` (default
 * $100), so later purchases need a single approval. The escrow can only pull funds when the
 * customer calls `deposit` themselves, for exactly the promo price.
 */
export interface CircleRouteDeps {
  circle: CircleClient | null;
  appId: string | null;
  arc: {
    escrow: string;
    token: string;
    reads: ArcReads;
    blockchain: string;
    accountType: "EOA" | "SCA";
    allowanceCap: bigint;
  } | null;
  store: Store;
  gemini: Pick<GeminiAdapter, "getQuote">;
  now?: () => Date;
}

interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state?: string;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/;

export function registerCircleRoutes(app: FastifyInstance, deps: CircleRouteDeps): void {
  const nowUnix = () => Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);

  // 1. Start email login. Body: { email, deviceId } (deviceId from sdk.getDeviceId()).
  app.post<{ Body: { email?: unknown; deviceId?: unknown } }>(
    "/api/wallet/email-login",
    async (req, reply) => {
      if (!deps.circle || !deps.appId) return disabled(reply);
      const { email, deviceId } = req.body ?? {};
      if (typeof email !== "string" || !EMAIL.test(email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      if (typeof deviceId !== "string" || deviceId.length < 8 || deviceId.length > 256) {
        return reply.code(400).send({ error: "invalid_device_id" });
      }
      try {
        const d = await deps.circle.request<{
          deviceToken: string;
          deviceEncryptionKey: string;
          otpToken: string;
        }>("POST", "/v1/w3s/users/email/token", {
          body: { idempotencyKey: randomUUID(), deviceId, email },
        });
        // Exactly what the SDK needs for updateConfigs({ appSettings, loginConfigs }).
        return { appId: deps.appId, ...d };
      } catch (err) {
        return circleError(reply, err);
      }
    },
  );

  // 2. Create the user's Arc wallet (first login). Returns a challenge, or alreadyInitialized.
  app.post("/api/wallet/init", async (req, reply) => {
    if (!deps.circle || !deps.arc) return disabled(reply);
    const userToken = token(req, reply);
    if (!userToken) return;
    try {
      const d = await deps.circle.request<{ challengeId: string }>(
        "POST",
        "/v1/w3s/user/initialize",
        {
          userToken,
          body: {
            idempotencyKey: randomUUID(),
            accountType: deps.arc.accountType,
            blockchains: [deps.arc.blockchain],
          },
        },
      );
      return { challengeId: d.challengeId };
    } catch (err) {
      if (err instanceof CircleError && err.code === ALREADY_INITIALIZED) {
        return { alreadyInitialized: true };
      }
      return circleError(reply, err);
    }
  });

  // 3. The user's Arc wallets with their USDC balance (base units, 6 decimals).
  app.get("/api/wallet", async (req, reply) => {
    if (!deps.circle || !deps.arc) return disabled(reply);
    const userToken = token(req, reply);
    if (!userToken) return;
    try {
      const wallets = await arcWallets(userToken);
      return {
        wallets: await Promise.all(
          wallets.map(async (w) => ({
            id: w.id,
            address: w.address,
            blockchain: w.blockchain,
            usdcBalance: (await deps.arc!.reads.balance(w.address)).toString(),
          })),
        ),
      };
    } catch (err) {
      return circleError(reply, err);
    }
  });

  // 4. What the checkout button should do for this wallet and promo.
  app.get<{ Params: { promoId: string }; Querystring: { walletId?: string } }>(
    "/api/checkout/:promoId/status",
    async (req, reply) => {
      if (!deps.circle || !deps.arc) return disabled(reply);
      const userToken = token(req, reply);
      if (!userToken) return;
      try {
        const ctx = await checkoutContext(userToken, req.params.promoId, req.query.walletId, reply);
        if (!ctx) return;
        return {
          promoId: ctx.promo.id,
          price: ctx.promo.offerAmount.toString(),
          canBuy: ctx.canBuy,
          pauseReason: ctx.pauseReason,
          usdcBalance: ctx.balance.toString(),
          enoughBalance: ctx.balance >= ctx.promo.offerAmount,
          needsApproval: ctx.allowance < ctx.promo.offerAmount,
        };
      } catch (err) {
        return circleError(reply, err);
      }
    },
  );

  // 5. Approval challenge (only when needsApproval). Body: { walletId }.
  app.post<{ Params: { promoId: string }; Body: { walletId?: unknown } }>(
    "/api/checkout/:promoId/approve",
    async (req, reply) => {
      if (!deps.circle || !deps.arc) return disabled(reply);
      const userToken = token(req, reply);
      if (!userToken) return;
      try {
        const ctx = await checkoutContext(userToken, req.params.promoId, req.body?.walletId, reply);
        if (!ctx) return;
        if (ctx.allowance >= ctx.promo.offerAmount) {
          return reply.code(409).send({ error: "already_approved" });
        }
        const cap =
          deps.arc.allowanceCap > ctx.promo.offerAmount
            ? deps.arc.allowanceCap
            : ctx.promo.offerAmount;
        const tx = buildApproveTx(deps.arc.token as Address, deps.arc.escrow as Address, cap);
        const challengeId = await contractCall(
          userToken,
          ctx.wallet.id,
          tx.to,
          tx.data,
          `approve:${ctx.promo.id}`,
        );
        return { step: "approve", challengeId, allowance: cap.toString() };
      } catch (err) {
        return circleError(reply, err);
      }
    },
  );

  // 6. Payment challenge. Body: { walletId }. Returns the purchase key to poll the receipt with.
  app.post<{ Params: { promoId: string }; Body: { walletId?: unknown } }>(
    "/api/checkout/:promoId/deposit",
    async (req, reply) => {
      if (!deps.circle || !deps.arc) return disabled(reply);
      const userToken = token(req, reply);
      if (!userToken) return;
      try {
        const ctx = await checkoutContext(userToken, req.params.promoId, req.body?.walletId, reply);
        if (!ctx) return;
        if (!ctx.canBuy) {
          return reply.code(409).send({ error: "promo_not_buyable", pauseReason: ctx.pauseReason });
        }
        if (ctx.balance < ctx.promo.offerAmount) {
          return reply.code(409).send({ error: "insufficient_usdc" });
        }
        if (ctx.allowance < ctx.promo.offerAmount) {
          return reply.code(409).send({ error: "approval_needed" });
        }
        const purchaseIdHex = newPurchaseIdHex();
        const promoId = ctx.promo.promoPda as Hex;
        const purchaseKey = canonical(
          purchaseKeyOf(promoId, ctx.wallet.address as Address, purchaseIdHex),
        );
        const tx = buildDepositTx(deps.arc.escrow as Address, {
          promoId,
          purchaseIdHex,
          amount: ctx.promo.offerAmount,
        });
        const challengeId = await contractCall(
          userToken,
          ctx.wallet.id,
          tx.to,
          tx.data,
          purchaseKey,
        );
        return {
          step: "deposit",
          challengeId,
          purchaseIdHex,
          purchaseKey,
          receipt: `/api/purchases/${purchaseKey}`,
        };
      } catch (err) {
        return circleError(reply, err);
      }
    },
  );

  // 7. Testnet USDC for a demo wallet (Circle faucet; Circle may refuse non-upgraded accounts).
  app.post<{ Body: { walletId?: unknown } }>("/api/wallet/faucet", async (req, reply) => {
    if (!deps.circle || !deps.arc) return disabled(reply);
    const userToken = token(req, reply);
    if (!userToken) return;
    try {
      const wallet = await ownWallet(userToken, req.body?.walletId);
      if (!wallet) return reply.code(404).send({ error: "wallet_not_found" });
      try {
        await deps.circle.request("POST", "/v1/faucet/drips", {
          body: { address: wallet.address, blockchain: deps.arc.blockchain, usdc: true },
        });
      } catch (err) {
        if (!(err instanceof CircleError)) throw err;
        // Not a login problem: Circle limits drips (about one per day) and may require an upgraded account.
        return reply.code(502).send({
          error: "faucet_unavailable",
          message: err.message,
          fallback: "https://faucet.circle.com (Arc Testnet)",
        });
      }
      return { ok: true, address: wallet.address, testnet: true };
    } catch (err) {
      return circleError(reply, err);
    }
  });

  // ---- helpers --------------------------------------------------------------------------------

  async function arcWallets(userToken: string): Promise<CircleWallet[]> {
    const d = await deps.circle!.request<{ wallets: CircleWallet[] }>(
      "GET",
      `/v1/w3s/wallets?blockchain=${encodeURIComponent(deps.arc!.blockchain)}`,
      { userToken },
    );
    return (d?.wallets ?? []).filter((w) => w.blockchain === deps.arc!.blockchain);
  }

  /** The wallet must belong to the logged-in user (checked against Circle, not trusted from input). */
  async function ownWallet(userToken: string, walletId: unknown): Promise<CircleWallet | null> {
    if (typeof walletId !== "string" || !UUID.test(walletId)) return null;
    return (await arcWallets(userToken)).find((w) => w.id === walletId) ?? null;
  }

  async function checkoutContext(
    userToken: string,
    promoId: string,
    walletId: unknown,
    reply: FastifyReply,
  ) {
    const promo = await deps.store.getPromotion(promoId);
    if (!promo || promo.status !== "ACTIVE") {
      reply.code(404).send({ error: "promotion_not_found" });
      return null;
    }
    if (!promo.promoPda || !BYTES32.test(promo.promoPda)) {
      reply.code(409).send({ error: "not_an_arc_promotion" });
      return null;
    }
    const wallet = await ownWallet(userToken, walletId);
    if (!wallet) {
      reply.code(404).send({ error: "wallet_not_found" });
      return null;
    }
    const ask = await deps.gemini
      .getQuote(promo.geminiMarketId)
      .then((q) => BigInt(q.quote.yesAskMicroUsd))
      .catch(() => null);
    const live = liveState(promo, ask, nowUnix());
    const [allowance, balance] = await Promise.all([
      deps.arc!.reads.allowance(wallet.address),
      deps.arc!.reads.balance(wallet.address),
    ]);
    return {
      promo,
      wallet,
      canBuy: live.canBuy,
      pauseReason: live.pauseReason,
      allowance,
      balance,
    };
  }

  async function contractCall(
    userToken: string,
    walletId: string,
    contractAddress: string,
    callData: string,
    refId: string,
  ): Promise<string> {
    const d = await deps.circle!.request<{ challengeId: string }>(
      "POST",
      "/v1/w3s/user/transactions/contractExecution",
      {
        userToken,
        body: {
          idempotencyKey: randomUUID(),
          walletId,
          contractAddress,
          callData,
          feeLevel: "MEDIUM",
          refId: refId.slice(0, 100),
        },
      },
    );
    return d.challengeId;
  }
}

function token(req: FastifyRequest, reply: FastifyReply): string | null {
  const t = req.headers["x-user-token"];
  if (typeof t !== "string" || t.length < 20 || t.length > 4096) {
    reply.code(401).send({ error: "login_required" });
    return null;
  }
  return t;
}

function disabled(reply: FastifyReply) {
  return reply.code(503).send({ error: "wallets_disabled" });
}

function circleError(reply: FastifyReply, err: unknown) {
  if (err instanceof CircleError) {
    if (err.status === 401 || err.status === 403) {
      return reply.code(401).send({ error: "circle_session_invalid", message: err.message });
    }
    return reply
      .code(err.status >= 500 ? 503 : 502)
      .send({ error: "circle_error", code: err.code, message: err.message });
  }
  throw err;
}

/**
 * True when the request's Circle login (X-User-Token) owns a wallet whose address is `merchant`.
 * Used to show a shop its own budget and max cost on the dashboard.
 */
export function circleMerchantCheck(circle: CircleClient, blockchain: string) {
  return async (headers: Record<string, unknown>, merchant: string): Promise<boolean> => {
    const t = headers["x-user-token"];
    if (typeof t !== "string" || t.length < 20 || t.length > 4096) return false;
    const d = await circle.request<{ wallets: CircleWallet[] }>(
      "GET",
      `/v1/w3s/wallets?blockchain=${encodeURIComponent(blockchain)}`,
      { userToken: t },
    );
    return (d?.wallets ?? []).some((w) => canonical(w.address) === canonical(merchant));
  };
}
