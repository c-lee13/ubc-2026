"use client";

import { useCallback, useEffect, useState } from "react";
import { store } from "./hooks";

/**
 * CLIENT-SIDE ONLY: which side of the app this browser opens on. Chosen on first open ("I'm here
 * to buy" / "I run a shop") and switched later from the profile ("Merchant workspace"). The API
 * has no notion of roles: the same email login works for shops and customers.
 */
export type Role = "customer" | "merchant";
const KEY = "wincentive:role";
const EVENT = "wincentive:role";

export function readRole(): Role | null {
  const r = store.get<Role>(KEY);
  return r === "customer" || r === "merchant" ? r : null;
}

export function writeRole(r: Role): void {
  store.set(KEY, r);
  window.dispatchEvent(new Event(EVENT));
}

/** The stored role; `undefined` until mounted (localStorage), then the role or null. */
export function useRole(): [Role | null | undefined, (r: Role) => void] {
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  useEffect(() => {
    const sync = () => setRole(readRole());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = useCallback((r: Role) => writeRole(r), []);
  return [role, set];
}
