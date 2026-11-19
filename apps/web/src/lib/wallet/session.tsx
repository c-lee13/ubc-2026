"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, type WalletDto } from "../api";
import { api, setUserToken } from "../client";
import { publicConfig } from "../config";
import { describe, type Problem } from "../errors";
import {
  WalletUserError,
  type ChallengeOutcome,
  type CircleSession,
  type WalletDriver,
} from "./driver";

/**
 * The signed-in person: email login through Circle (docs/email-wallets.md), their Arc wallet, and
 * `execute` to approve any challenge the API hands back. The browser keeps only Circle's userToken
 * (plus its encryption key, which the SDK needs), in sessionStorage: gone when the tab closes.
 */
export type Phase = "signed-out" | "sending-code" | "awaiting-code" | "creating-wallet" | "ready";

interface WalletState {
  phase: Phase;
  email: string | null;
  wallet: WalletDto | null;
  problem: Problem | null;
  /** True when this build can log in at all (Circle App ID set, or the dev fixture on). */
  available: boolean;
  fixture: boolean;
  /** Text of the approval in progress, e.g. "Pay $5.00". */
  approving: string | null;
  login(email: string): Promise<void>;
  logout(): void;
  refreshWallet(): Promise<WalletDto | null>;
  /** Approve a challenge in Circle's window; sign challenges resolve with the signature. */
  execute(challengeId: string, what: string): Promise<ChallengeOutcome>;
  clearProblem(): void;
}

const Ctx = createContext<WalletState | null>(null);
const SESSION_KEY = "hedged:circle-session";
const DEVICE_KEY = "hedged:circle-device-id";

interface Stored extends CircleSession {
  email: string;
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("signed-out");
  const [email, setEmail] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const driverRef = useRef<Promise<WalletDriver> | null>(null);
  const fixture = publicConfig.walletFixture;
  const available = fixture || Boolean(publicConfig.circleAppId);

  const driver = useCallback((): Promise<WalletDriver> => {
    if (!driverRef.current) {
      // Inline flag: production builds drop the fixture import (see lib/client.ts).
      driverRef.current =
        process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_WALLET_FIXTURE === "1"
          ? import("./fixture").then((m) => m.createFixtureDriver())
          : publicConfig.circleAppId
            ? import("./circle").then((m) => m.createCircleDriver(publicConfig.circleAppId!))
            : Promise.reject(
                new WalletUserError(
                  "Email login isn't set up",
                  "This site has no Circle App ID (NEXT_PUBLIC_CIRCLE_APP_ID), so it can't log anyone in.",
                ),
              );
      driverRef.current.catch(() => (driverRef.current = null));
    }
    return driverRef.current;
  }, [fixture]);

  const signOut = useCallback((p: Problem | null) => {
    sessionStorage.removeItem(SESSION_KEY);
    setUserToken(null);
    setWallet(null);
    setEmail(null);
    setPhase("signed-out");
    setProblem(p);
  }, []);

  /** Any API/wallet error: an expired Circle session sends the person back to the login. */
  const handle = useCallback(
    (err: unknown): never => {
      if (
        err instanceof ApiError &&
        (err.code === "circle_session_invalid" || err.code === "login_required")
      ) {
        signOut(describe(err));
      }
      throw err;
    },
    [signOut],
  );

  const refreshWallet = useCallback(async (): Promise<WalletDto | null> => {
    try {
      const { wallets } = await api.wallets();
      const w = wallets[0] ?? null;
      setWallet(w);
      return w;
    } catch (err) {
      return handle(err);
    }
  }, [handle]);

  // Restore a session from this tab.
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(SESSION_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    const s = JSON.parse(raw) as Stored;
    setUserToken(s.userToken);
    setEmail(s.email);
    setPhase("creating-wallet");
    void (async () => {
      try {
        (await driver()).setAuthentication(s);
        const w = await refreshWallet();
        setPhase(w ? "ready" : "signed-out");
      } catch (err) {
        if (!(err instanceof ApiError)) signOut(describe(err));
        else if (err.code !== "circle_session_invalid" && err.code !== "login_required") {
          setPhase("ready");
          setProblem(describe(err));
        }
      }
    })();
  }, [driver, refreshWallet, signOut]);

  const login = useCallback(
    async (addr: string) => {
      setProblem(null);
      setPhase("sending-code");
      try {
        const d = await driver();
        // 1. Device id (cached per browser).
        let deviceId = localStorage.getItem(DEVICE_KEY);
        if (!deviceId) {
          deviceId = await d.getDeviceId();
          localStorage.setItem(DEVICE_KEY, deviceId);
        }
        // 2. Our API starts Circle's email login.
        const start = await api.emailLogin(addr.trim(), deviceId);
        // 3. Circle's code screen; the callback gives the user session.
        setPhase("awaiting-code");
        const session = await d.verifyEmail(start, addr.trim());
        // 4. Authenticate the SDK and our API calls.
        d.setAuthentication(session);
        setUserToken(session.userToken);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, email: addr.trim() }));
        setEmail(addr.trim());
        // 5. First visit: create the Arc wallet (a challenge the person approves).
        setPhase("creating-wallet");
        const init = await api.walletInit();
        if ("challengeId" in init) {
          setApproving("Create your dollar wallet");
          try {
            await d.execute(init.challengeId, "Create your dollar wallet");
          } finally {
            setApproving(null);
          }
        }
        // 6. The wallet (Circle may take a moment to list a brand-new one).
        let w: WalletDto | null = null;
        for (let i = 0; i < 10 && !w; i++) {
          w = await refreshWallet();
          if (!w) await new Promise((r) => setTimeout(r, 1500));
        }
        if (!w)
          throw new WalletUserError(
            "Wallet not ready",
            "Circle hasn't finished creating your wallet. Try again in a minute.",
          );
        setPhase("ready");
      } catch (err) {
        const p = describe(err);
        sessionStorage.removeItem(SESSION_KEY);
        setUserToken(null);
        setPhase("signed-out");
        setProblem(p);
      }
    },
    [driver, refreshWallet],
  );

  const execute = useCallback(
    async (challengeId: string, what: string) => {
      setApproving(what);
      try {
        return await (await driver()).execute(challengeId, what);
      } finally {
        setApproving(null);
      }
    },
    [driver],
  );

  const value = useMemo<WalletState>(
    () => ({
      phase,
      email,
      wallet,
      problem,
      available,
      fixture,
      approving,
      login,
      logout: () => signOut(null),
      refreshWallet,
      execute,
      clearProblem: () => setProblem(null),
    }),
    [
      phase,
      email,
      wallet,
      problem,
      available,
      fixture,
      approving,
      login,
      signOut,
      refreshWallet,
      execute,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet needs <WalletSessionProvider>");
  return v;
}
