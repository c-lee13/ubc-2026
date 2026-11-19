"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** When the last successful fetch landed (ms since epoch); null before the first one. */
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Fetch now and every `intervalMs` (0 = once). Keeps the last good data when a later poll fails,
 * so a flaky network shows a warning instead of blanking the screen. `key` restarts the loop.
 */
export function usePoll<T>(
  fn: (() => Promise<T>) | null,
  intervalMs: number,
  key: unknown[] = [],
): Polled<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(fn !== null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function run() {
      const f = fnRef.current;
      if (!f) {
        setLoading(false);
        return;
      }
      try {
        const v = await f();
        if (!alive) return;
        setData(v);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!alive) return;
        setError(e);
      } finally {
        if (alive) setLoading(false);
      }
      if (alive && intervalMs > 0) timer = setTimeout(run, intervalMs);
    }
    setLoading(fnRef.current !== null);
    void run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, tick, ...key]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, updatedAt, refresh };
}

/**
 * Counts how many times `value` has changed since mount (0 until the first change). Use it as a
 * React `key` to replay a one-shot animation, e.g. flash the odds when a poll brings a new price.
 */
export function useChangeCount(value: unknown): number {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!Object.is(prev.current, value)) {
      prev.current = value;
      setN((x) => x + 1);
    }
  }, [value]);
  return n;
}

/** Current unix seconds, ticking. Null on the server and first client render (no hydration drift). */
export function useNowSeconds(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * Seconds since this browser first saw each id (kept in localStorage, so a reload keeps the clock).
 * Used for the escrow-v2 fallback: offer a manual claim only once an automatic payout has sat
 * for a few minutes. Ids are opaque, e.g. `${purchaseKey}:${step}`.
 */
export function useSeenFor(ids: string[]): (id: string) => number {
  const now = useNowSeconds(5000);
  const joined = ids.join(",");
  const [since, setSince] = useState<Record<string, number>>({});
  useEffect(() => {
    const t = Math.floor(Date.now() / 1000);
    const out: Record<string, number> = {};
    for (const id of joined ? joined.split(",") : []) {
      const k = `hedged:seen:${id.toLowerCase()}`;
      let at = store.get<number>(k);
      if (typeof at !== "number") {
        at = t;
        store.set(k, at);
      }
      out[id] = at;
    }
    setSince(out);
  }, [joined]);
  return (id) => (now !== null && since[id] !== undefined ? Math.max(0, now - since[id]) : 0);
}

/** Window origin once mounted (for share links), "" before. */
export function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** JSON in localStorage. Values written by this app only (purchase receipts, unfinished drafts). */
export const store = {
  get<T>(key: string): T | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // private mode / quota: receipts still live in the URL
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
