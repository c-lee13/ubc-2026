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
import type { Desk } from "./desk/run";
import { registerStreamsWebhook, type StreamsWebhookDeps } from "./routes/webhooks";
import { registerCircleRoutes, type CircleRouteDeps } from "./circle/routes";

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
  registerPromotionRoutes(app, { gemini, store: deps.store, gateway: deps.gateway });
  registerPurchaseRoutes(app, { store: deps.store });
  await registerStreamsWebhook(app, deps.streams ?? null);
  registerCircleRoutes(app, {
    circle: deps.wallets?.circle ?? null,
    appId: deps.wallets?.appId ?? null,
    arc: deps.wallets?.arc ?? null,
    store: deps.store,
    gemini,
  });
  // Exposure desk: net exposure of all shops per Gemini event and its simulated hedges.
  app.get("/api/desk", async (_req, reply) =>
    deps.desk ? deps.desk.snapshot() : reply.code(503).send({ error: "desk_disabled" }),
  );
  return app;
}
