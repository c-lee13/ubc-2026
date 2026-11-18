import { createApi, type Transport } from "./api";
import { publicConfig } from "./config";

export { chain } from "./chain";

let userToken: string | null = null;
/** The session provider keeps the Circle userToken here; requests send it as X-User-Token. */
export function setUserToken(t: string | null): void {
  userToken = t;
}

const realTransport: Transport = (u, i) => fetch(u, i);

// The dev-only fixture swaps the transport; in production builds this is constant-false and the
// fixture module is never loaded.
const transportReady: Promise<Transport> =
  publicConfig.walletFixture && typeof window !== "undefined"
    ? import("./wallet/fixture").then((m) => m.createFixtureTransport(realTransport))
    : Promise.resolve(realTransport);

/** The browser's API client (NEXT_PUBLIC_API_URL). */
export const api = createApi(publicConfig.apiUrl, {
  transport: async (u, i) => (await transportReady)(u, i),
  userToken: () => userToken,
});
