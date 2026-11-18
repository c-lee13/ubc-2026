/**
 * Browser-visible configuration. Only NEXT_PUBLIC_* values are read here, each referenced literally
 * so Next.js can inline it at build time. Nothing secret belongs in this file: the Circle API key
 * stays on the server; the browser only ever holds a user's Circle `userToken`.
 */
export const publicConfig = {
  /** Dev 4's REST API (apps/api). */
  apiUrl: (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, ""),
  /** Circle user-controlled wallets App ID (not secret). Required for email login. */
  circleAppId: process.env.NEXT_PUBLIC_CIRCLE_APP_ID || null,
  /** Deployed HedgedEscrow on Arc testnet; optional, enables direct chain reads in the browser. */
  arcEscrow: process.env.NEXT_PUBLIC_ARC_ESCROW_ADDRESS || null,
  arcRpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.io",
  /**
   * DEV-ONLY fixture: mocks Circle login and the /api/wallet + /api/checkout responses in the
   * browser so the flow can be clicked through without a Circle App ID or a real email code.
   * Off by default, and forced off in production builds (`next build`).
   */
  walletFixture:
    process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_WALLET_FIXTURE === "1",
};
