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
  if (r === "merchant") store.set(SHOP_KEY, true);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * CLIENT-SIDE ONLY: whether this browser has set up a shop account (picked "I run a shop" on first
 * open, or "Set up a shop account" in the profile). Gates the Customer / Merchant switch.
 */
const SHOP_KEY = "wincentive:shop-account";
export function hasShopAccount(): boolean {
  return store.get<boolean>(SHOP_KEY) === true || store.get("hedged:shop") !== null;
}

/** Create the shop account: name and neighborhood prefill every new promo. */
export function createShopAccount(shopName: string, neighborhood: string): void {
  const prev = store.get<{ shopName: string; itemName: string }>("hedged:shop");
  store.set("hedged:shop", { shopName, itemName: prev?.itemName ?? "Latte" });
  store.set(HOOD_KEY, neighborhood);
  writeRole("merchant");
}

export const HOOD_KEY = "wincentive:shop-neighborhood";

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
