import cors from "@fastify/cors";
import type { SolanaServerGateway } from "@hedged/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { ApiConfig } from "./config";
import { createGeminiAdapter, type GeminiAdapter } from "./gemini/adapter";
import { createGeminiClient } from "./gemini/client";
import { registerHealthRoute } from "./routes/health";
import { registerMarketRoutes } from "./routes/markets";
import { registerPromotionRoutes } from "./routes/promotions";
import { registerPurchaseRoutes } from "./routes/purchases";
import { registerWriteRateLimit } from "./rate-limit";
import type { Store } from "./store/types";
import { nettingDemo } from "./desk/demo";
import type { Desk } from "./desk/run";
import { sendGeminiError } from "./routes/markets";
import { registerStreamsWebhook, type StreamsWebhookDeps } from "./routes/webhooks";
import { circleMerchantCheck, registerCircleRoutes, type CircleRouteDeps } from "./circle/routes";

export interface ServerDeps {
  /** Circle email-login wallets + Arc checkout; routes answer 503 when absent. */
  wallets?: Omit<CircleRouteDeps, "store" | "gemini">;
  /** QuickNode Streams webhook target; POST /webhooks/quicknode returns 503 when absent. */
  streams?: StreamsWebhookDeps | null;
  /** Exposure desk; GET /api/desk returns 503 when absent. */
  desk?: Desk;
  gemini?: GeminiAdapter;
  store: Store;
  /** null when SOLANA_GATEWAY=none: promos can be drafted but not confirmed. */
  gateway: SolanaServerGateway | null;
}

export async function buildServer(config: ApiConfig, deps: ServerDeps): Promise<FastifyInstance> {
  const gemini = deps.gemini ?? createGeminiAdapter(createGeminiClient(config.gemini));
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: config.corsOrigin });
  registerWriteRateLimit(app, config.writeRateLimit);

  registerHealthRoute(app);
  registerMarketRoutes(app, gemini, config.hedge);
  registerPromotionRoutes(app, {
    gemini,
    store: deps.store,
    gateway: deps.gateway,
    isMerchant: deps.wallets?.circle
      ? circleMerchantCheck(deps.wallets.circle, deps.wallets.arc?.blockchain ?? "ARC-TESTNET")
      : undefined,
  });
  registerPurchaseRoutes(app, { store: deps.store });
  await registerStreamsWebhook(app, deps.streams ?? null);
  registerCircleRoutes(app, {
    circle: deps.wallets?.circle ?? null,
    appId: deps.wallets?.appId ?? null,
    arc: deps.wallets?.arc ?? null,
    store: deps.store,
    gemini,
  });
  // Netting demo: two hypothetical shops on opposite sides of a real game, live prices, nothing stored.
  // ?event=NCAAF-2611212030-ARK-TEX-M&a=60&b=100&price=5000000
  app.get<{ Querystring: { event?: string; a?: string; b?: string; price?: string } }>(
    "/api/desk/demo",
    async (req, reply) => {
      const { event, a = "100", b = "60", price = "5000000" } = req.query;
      const n = (v: string) => (/^\d{1,5}$/.test(v) ? Number(v) : NaN);
      if (!event || !/^[A-Za-z0-9._-]{1,80}$/.test(event)) {
        return reply.code(400).send({ error: "invalid_event" });
      }
      if (Number.isNaN(n(a)) || Number.isNaN(n(b)) || !/^\d{1,10}$/.test(price) || price === "0") {
        return reply.code(400).send({ error: "invalid_params" });
      }
      try {
        const r = await nettingDemo(gemini, {
          eventTicker: event,
          price: BigInt(price),
          sales: [n(a), n(b)],
          lotContracts: config.desk.lotContracts,
        });
        return "error" in r ? reply.code(422).send(r) : r;
      } catch (err) {
        return sendGeminiError(reply, err);
      }
    },
  );
  // Exposure desk: net exposure of all shops per Gemini event and its simulated hedges.
  app.get("/api/desk", async (_req, reply) =>
    deps.desk ? deps.desk.snapshot() : reply.code(503).send({ error: "desk_disabled" }),
  );
  return app;
}
