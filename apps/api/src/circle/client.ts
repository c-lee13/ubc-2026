import { randomUUID } from "node:crypto";

/**
 * SERVER-ONLY client for Circle's user-controlled wallets (email login) and the testnet faucet.
 * The API key never leaves the server; the browser only ever holds Circle's per-user session
 * token (`userToken`), which it gets from Circle's web SDK after the email code is verified.
 *
 * Endpoints verified against developers.circle.com (2026-11-18):
 *   POST /v1/w3s/users/email/token                    device token for email OTP login
 *   POST /v1/w3s/user/initialize                      create the user's wallet (challenge)
 *   GET  /v1/w3s/wallets                              the user's wallets (X-User-Token)
 *   GET  /v1/w3s/wallets/{id}/balances                token balances (X-User-Token)
 *   POST /v1/w3s/user/transactions/contractExecution  a contract call the user approves (challenge)
 *   POST /v1/faucet/drips                             testnet tokens (Circle says it may need a mainnet-upgraded account)
 */

export const CIRCLE_BASE_URL = "https://api.circle.com";
/** Circle's code when /user/initialize is called for a user who already has wallets. */
export const ALREADY_INITIALIZED = 155106;

export class CircleError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "CircleError";
  }
}

export interface CircleClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ALLOWED: RegExp[] = [
  /^\/v1\/w3s\/users\/email\/token$/,
  /^\/v1\/w3s\/user\/initialize$/,
  /^\/v1\/w3s\/wallets$/,
  /^\/v1\/w3s\/wallets\/[0-9a-f-]{36}\/balances$/,
  /^\/v1\/w3s\/user\/transactions\/contractExecution$/,
  /^\/v1\/faucet\/drips$/,
];

export interface CircleClient {
  request<T>(
    method: "GET" | "POST",
    path: string,
    opts?: { userToken?: string; body?: Record<string, unknown> },
  ): Promise<T>;
}

export function createCircleClient(cfg: CircleClientConfig): CircleClient {
  const base = cfg.baseUrl ?? CIRCLE_BASE_URL;
  const doFetch = cfg.fetchImpl ?? fetch;
  return {
    async request<T>(
      method: "GET" | "POST",
      path: string,
      opts: { userToken?: string; body?: Record<string, unknown> } = {},
    ): Promise<T> {
      const pathOnly = path.split("?")[0]!;
      if (!ALLOWED.some((re) => re.test(pathOnly))) {
        throw new Error(`Refusing non-allowlisted Circle path: ${pathOnly}`);
      }
      const headers: Record<string, string> = {
        authorization: `Bearer ${cfg.apiKey}`,
        accept: "application/json",
        "x-request-id": randomUUID(),
      };
      if (opts.userToken) headers["x-user-token"] = opts.userToken;
      if (opts.body) headers["content-type"] = "application/json";

      let res: Response;
      try {
        res = await doFetch(new URL(path, base), {
          method,
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
        });
      } catch {
        throw new CircleError(503, null, `Circle unreachable: ${method} ${pathOnly}`);
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let json: { data?: unknown; code?: number; message?: string } = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new CircleError(
          502,
          null,
          `Circle returned non-JSON (${res.status}) for ${pathOnly}`,
        );
      }
      if (!res.ok) {
        throw new CircleError(res.status, json.code ?? null, json.message ?? `HTTP ${res.status}`);
      }
      return json.data as T;
    },
  };
}
