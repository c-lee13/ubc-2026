import { createArcGatewayFromEnv, type ArcGateway } from "@hedged/arc/server";
import type { SolanaServerGateway } from "@hedged/shared";
import { createSolanaGatewayFromEnv, type RealSolanaGateway } from "@hedged/solana/server";
import { ARC_USDC_ERC20 } from "@hedged/arc";
import { createArcReads } from "./circle/arc-reads";
import { createCircleClient } from "./circle/client";
import { loadConfig } from "./config";
import { createGeminiAdapter } from "./gemini/adapter";
import { withGeminiCache } from "./gemini/cached";
import { createGeminiClient } from "./gemini/client";
import { FakeSolanaGateway } from "./orchestration/fake-gateway";
import { createOrchestrator } from "./orchestration/orchestrator";
import { arcStreamsHandler, solanaStreamsHandler } from "./routes/webhooks";
import { startWorkers, type RunningWorkers } from "./orchestration/workers";
import { createDesk } from "./desk/run";
import { buildServer } from "./server";
import { MemoryStore } from "./store/memory-store";
import { createSupabaseStore } from "./store/supabase-store";
import type { Store } from "./store/types";

const config = loadConfig();
// Cached so polling screens and workers don't hit Gemini's rate limit (gemini/cached.ts).
const gemini = withGeminiCache(createGeminiAdapter(createGeminiClient(config.gemini)));
const store: Store = config.supabase
  ? createSupabaseStore(config.supabase.url, config.supabase.serviceRoleKey)
  : new MemoryStore();
// Background workers run on one of: nothing ("none"), an in-memory fake chain ("fake"), Dev 3's
// real Devnet gateway ("real", built from the SOLANA_* / QUICKNODE_* / RELAYER_* variables), or the
// Arc testnet escrow ("arc", built from the ARC_* variables; packages/arc/README.md).
let realGateway: RealSolanaGateway | null = null;
let arcGateway: ArcGateway | null = null;
let gateway: SolanaServerGateway | null = null;
if (config.workers.gateway === "fake") {
  gateway = new FakeSolanaGateway(() => Math.floor(Date.now() / 1000));
} else if (config.workers.gateway === "real") {
  try {
    realGateway = await createSolanaGatewayFromEnv(process.env, (msg, extra) =>
      console.log(
        JSON.stringify({ level: 30, time: Date.now(), msg: `[solana] ${msg}`, ...extra }),
      ),
    );
  } catch (err) {
    // Typical causes: RELAYER_KEYPAIR_PATH missing/unreadable, RPC not Devnet, RPC unreachable.
    console.error(`SOLANA_GATEWAY=real could not start: ${(err as Error).message}`);
    process.exit(1);
  }
  gateway = realGateway;
} else if (config.workers.gateway === "arc") {
  try {
    arcGateway = await createArcGatewayFromEnv(process.env, (msg, extra) =>
      console.log(JSON.stringify({ level: 30, time: Date.now(), msg: `[arc] ${msg}`, ...extra })),
    );
  } catch (err) {
    // Typical causes: ARC_ESCROW_ADDRESS unset, ARC_RELAYER_KEY_PATH unreadable, RPC not Arc testnet.
    console.error(`SOLANA_GATEWAY=arc could not start: ${(err as Error).message}`);
    process.exit(1);
  }
  gateway = arcGateway;
}
// QuickNode Streams webhook (POST /webhooks/quicknode) for whichever chain is active.
const token = config.workers.streamsSecurityToken;
const streams =
  token && realGateway
    ? solanaStreamsHandler(token, (s) => realGateway!.ingestStreams(s))
    : token && arcGateway && process.env.ARC_ESCROW_ADDRESS
      ? arcStreamsHandler(token, process.env.ARC_ESCROW_ADDRESS, (s) =>
          arcGateway!.ingestStreams(s),
        )
      : null;
const desk = createDesk({
  store,
  gemini,
  lotContracts: config.desk.lotContracts,
});
// Email-login wallets (Circle) + Arc checkout, when CIRCLE_* and ARC_ESCROW_ADDRESS are set.
const arcReads = config.arcCheckout
  ? createArcReads(config.arcCheckout.rpcUrl, ARC_USDC_ERC20, config.arcCheckout.escrow)
  : null;
// v2 escrow + our relayer: one-tap checkout and automatic payouts. v1: approve + deposit, claims.
const escrowV2 = arcReads ? await arcReads.isV2().catch(() => false) : false;
const v2Relayer = escrowV2 && arcGateway ? arcGateway : null;
const wallets = {
  circle: config.circle ? createCircleClient({ apiKey: config.circle.apiKey }) : null,
  appId: config.circle?.appId ?? null,
  arc: config.arcCheckout
    ? {
        escrow: config.arcCheckout.escrow,
        token: ARC_USDC_ERC20,
        reads: arcReads!,
        blockchain: config.arcCheckout.blockchain,
        accountType: config.arcCheckout.accountType,
        allowanceCap: config.arcCheckout.allowanceCap,
        oneTap: v2Relayer,
      }
    : null,
};
const app = await buildServer(config, {
  gemini,
  store,
  gateway,
  desk,
  streams,
  wallets,
  autoPayout: Boolean(v2Relayer),
});
if (config.arcCheckout) {
  app.log.info(
    { escrow: config.arcCheckout.escrow, v2: escrowV2, oneTap: Boolean(v2Relayer) },
    escrowV2
      ? v2Relayer
        ? "Arc escrow v2: one-tap checkout and automatic payouts on"
        : "Arc escrow v2, but SOLANA_GATEWAY is not arc: no relayer, so approve + deposit and claims"
      : "Arc escrow v1: approve + deposit checkout, customers and shops claim payouts",
  );
}
if (config.supabase) {
  app.log.info({ supabase: new URL(config.supabase.url).host }, "using Supabase store");
} else {
  app.log.warn("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set: IN-MEMORY store, lost on restart");
}

let workers: RunningWorkers | null = null;

try {
  await app.listen({ host: config.host, port: config.port });

  if (gateway) {
    if (config.workers.gateway === "fake") {
      app.log.warn(
        "SOLANA_GATEWAY=fake: workers run against an IN-MEMORY FAKE chain. Not Solana. Local testing only.",
      );
    } else {
      if (config.workers.gateway === "arc") {
        app.log.info(
          {
            streamsWebhook: Boolean(streams),
            eventSource: process.env.ARC_EVENT_SOURCE ?? "poll",
          },
          "SOLANA_GATEWAY=arc: workers run against the Arc escrow (@hedged/arc)",
        );
        if (process.env.ARC_EVENT_SOURCE === "streams" && !streams) {
          app.log.warn("ARC_EVENT_SOURCE=streams but QUICKNODE_STREAMS_SECURITY_TOKEN is not set");
        }
      } else {
        app.log.info(
          {
            streamsWebhook: Boolean(streams),
            eventSource: process.env.SOLANA_EVENT_SOURCE ?? "websocket",
          },
          "SOLANA_GATEWAY=real: workers run on Solana Devnet",
        );
        if (process.env.SOLANA_EVENT_SOURCE === "streams" && !streams) {
          app.log.warn(
            "SOLANA_EVENT_SOURCE=streams but QUICKNODE_STREAMS_SECURITY_TOKEN is not set",
          );
        }
      }
    }
    const orchestrator = createOrchestrator({
      store,
      gateway,
      settler: v2Relayer,
      gemini,
      config: {
        maxQuoteAgeMs: config.hedge.maxQuoteAgeMs,
        feeBps: config.hedge.feeBps,
        hedgeWindowFraction: config.workers.hedgeWindowFraction,
        retry: { maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 4000 },
      },
      log: app.log,
    });
    workers = await startWorkers({
      checkpointPrefix: config.workers.gateway === "arc" ? "arc:" : "",
      gateway,
      store,
      orchestrator,
      log: app.log,
      resolvePollMs: config.workers.resolvePollMs,
      reconcileMs: config.workers.reconcileMs,
      desk,
      deskMs: config.desk.rebalanceMs,
    });
  } else {
    app.log.info("SOLANA_GATEWAY=none: background workers disabled");
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await workers?.stop();
    await realGateway?.stop();
    await arcGateway?.stop();
    await app.close();
    process.exit(0);
  });
}
