import { ApiError, ApiUnreachableError, describeApiError } from "./api";
import { WalletUserError } from "./wallet/driver";

export interface Problem {
  title: string;
  detail: string;
}

/** Any error from the wallet, the API client, or elsewhere, as a readable problem. */
export function describe(err: unknown): Problem {
  if (err instanceof WalletUserError) return { title: err.title, detail: err.detail };
  if (err instanceof ApiError || err instanceof ApiUnreachableError) return describeApiError(err);
  return {
    title: "Something went wrong",
    detail: err instanceof Error ? err.message : String(err),
  };
}
