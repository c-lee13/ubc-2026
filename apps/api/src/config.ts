export interface ApiConfig {
  host: string;
  port: number;
  /** Browser origins allowed to call the API (`API_CORS_ORIGIN`, comma-separated). */
  corsOrigin: string[];
  gemini: { baseUrl: string; timeoutMs: number };
  hedge: { maxQuoteAgeMs: number; feeBps: number };
  /** Server-only. null = in-memory store (not durable). */
  supabase: { url: string; serviceRoleKey: string } | null;
  /** Per-IP limit on POST requests (webhooks exempt). */
  writeRateLimit: { maxPerWindow: number; windowMs: number };
  /** Circle user-controlled wallets (email login). Server-only key; null = wallet routes off. */
  circle: { apiKey: string; appId: string } | null;
  /** Arc checkout for email wallets: escrow + USDC on Arc testnet. null = checkout routes off. */
  arcCheckout: {
    escrow: string;
    rpcUrl: string;
    blockchain: string;
    accountType: "EOA" | "SCA";
    allowanceCap: bigint;
  } | null;
  /** Exposure desk (simulated netting across shops). */
  desk: { lotContracts: number; rebalanceMs: number };
  workers: {
    /**
     * Which SolanaServerGateway backs the workers:
     * - "none": API only, no background workers (default until Dev 3's gateway lands)
     * - "fake": IN-MEMORY fake chain, for local testing only (not Solana)
     * - "real": Dev 3's Devnet gateway (@hedged/solana/server), configured from the SOLANA_*,
     *           QUICKNODE_* and RELAYER_* variables
     * - "arc":  the Arc testnet escrow via @hedged/arc (env ARC_*; packages/arc/README.md)
     */
    gateway: "none" | "fake" | "real" | "arc";
    /** QuickNode Streams HMAC token; enables POST /webhooks/quicknode in "real" mode. */
    streamsSecurityToken: string | null;
    resolvePollMs: number;
    reconcileMs: number;
    hedgeWindowFraction: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid API_PORT: ${env.API_PORT}`);

  if ((env.GEMINI_READ_ONLY ?? "true") !== "true") {
    throw new Error('GEMINI_READ_ONLY must be "true": this MVP never trades on Gemini.');
  }

  return {
    host: env.API_HOST ?? "0.0.0.0",
    port,
    corsOrigin: (env.API_CORS_ORIGIN ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    gemini: {
      baseUrl: env.GEMINI_API_BASE_URL || "https://api.gemini.com",
      timeoutMs: nonNegativeInt(env.GEMINI_TIMEOUT_MS, 5000, "GEMINI_TIMEOUT_MS"),
    },
    supabase:
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
        ? { url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }
        : null,
    writeRateLimit: {
      maxPerWindow: Math.max(
        1,
        nonNegativeInt(env.WRITE_RATE_LIMIT_PER_MIN, 30, "WRITE_RATE_LIMIT_PER_MIN"),
      ),
      windowMs: 60_000,
    },
    circle:
      env.CIRCLE_API_KEY && env.CIRCLE_APP_ID
        ? { apiKey: env.CIRCLE_API_KEY, appId: env.CIRCLE_APP_ID }
        : null,
    arcCheckout: env.ARC_ESCROW_ADDRESS
      ? {
          escrow: env.ARC_ESCROW_ADDRESS,
          rpcUrl: env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
          blockchain: "ARC-TESTNET",
          accountType: env.CIRCLE_ACCOUNT_TYPE === "SCA" ? "SCA" : "EOA",
          // First approval allows up to this much (base units), so later purchases are one tap.
          allowanceCap: BigInt(
            nonNegativeInt(env.CHECKOUT_ALLOWANCE_CAP, 100_000_000, "CHECKOUT_ALLOWANCE_CAP"),
          ),
        }
      : null,
    desk: {
      lotContracts: Math.max(1, nonNegativeInt(env.DESK_LOT_CONTRACTS, 10, "DESK_LOT_CONTRACTS")),
      rebalanceMs: nonNegativeInt(env.DESK_REBALANCE_MS, 15_000, "DESK_REBALANCE_MS"),
    },
    workers: {
      gateway: parseGatewayMode(env.SOLANA_GATEWAY),
      streamsSecurityToken: env.QUICKNODE_STREAMS_SECURITY_TOKEN || null,
      resolvePollMs: nonNegativeInt(env.RESOLVE_POLL_MS, 5000, "RESOLVE_POLL_MS"),
      reconcileMs: nonNegativeInt(env.RECONCILE_MS, 60_000, "RECONCILE_MS"),
      hedgeWindowFraction: 0.7,
    },
    hedge: {
      maxQuoteAgeMs: nonNegativeInt(env.HEDGE_MAX_QUOTE_AGE_MS, 15_000, "HEDGE_MAX_QUOTE_AGE_MS"),
      feeBps: nonNegativeInt(env.HEDGE_FEE_BPS, 0, "HEDGE_FEE_BPS"),
    },
  };
}

function nonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${name}: ${raw}`);
  return n;
}

function parseGatewayMode(raw: string | undefined): "none" | "fake" | "real" | "arc" {
  const mode = raw || "none";
  if (mode === "none" || mode === "fake" || mode === "real" || mode === "arc") return mode;
  throw new Error(`Invalid SOLANA_GATEWAY=${mode}: use none, fake, real or arc`);
}
