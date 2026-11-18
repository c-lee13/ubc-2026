"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Polled<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
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
  return { data, error, loading, refresh };
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
