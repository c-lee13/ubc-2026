"use client";

import { useEffect, useState } from "react";
import { isSoldOut, type PromotionDto } from "./api";
import { store } from "./hooks";

/**
 * Coupon supply ("64 left" and its bar) and the counter's "Served" marks.
 *
 * The API has no coupon count yet. The shop picks one when it creates a promo; until the backend
 * stores it, it lives in two places:
 *   1. a `coupons` field on the promotion, if the server sends one (scripts/sample-api.mjs does:
 *      the proposed shape `{ total, sold }`), and
 *   2. CLIENT-SIDE: this browser's registry, written by Create promo and the Edit sheet.
 * With neither, cards show no count (only "Sold out" when the API pauses for SOLD_OUT or BUDGET_USED).
 */
export interface CouponSupply {
  total: number;
  sold: number;
  left: number;
  soldOut: boolean;
}

export interface ServerCoupons {
  total: number;
  sold: number;
}

interface Registered {
  total: number;
}

const REG_KEY = "wincentive:coupons";
const EVENT = "wincentive:coupons";
/** New promos start at this many coupons (a real marketing moment, still a small risk budget). */
export const DEFAULT_COUPONS = 100;

function registry(): Record<string, Registered> {
  return store.get<Record<string, Registered>>(REG_KEY) ?? {};
}

export function registerCoupons(promotionId: string, total: number): void {
  store.set(REG_KEY, { ...registry(), [promotionId]: { total } });
  window.dispatchEvent(new Event(EVENT));
}

export function registeredCoupons(promotionId: string): Registered | null {
  return registry()[promotionId] ?? null;
}

/** Re-render when this browser's coupon registry changes. */
export function useCouponRegistry(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    bump();
    window.addEventListener(EVENT, bump);
    return () => window.removeEventListener(EVENT, bump);
  }, []);
  return v;
}

/**
 * The supply for a promo. `soldCount` is what this browser knows was sold (the counter feed);
 * the server's own `sold` wins when it sends one.
 */
export function couponSupply(
  p: PromotionDto & { coupons?: ServerCoupons | null },
  soldCount?: number,
): CouponSupply | null {
  const budgetUsed = isSoldOut(p.live?.pauseReason);
  const server = p.coupons ?? null;
  const local = typeof window === "undefined" ? null : registeredCoupons(p.id);
  const total = server?.total ?? local?.total ?? null;
  if (total === null) return null;
  const sold = Math.min(total, server?.sold ?? soldCount ?? 0);
  const left = budgetUsed ? 0 : Math.max(0, total - sold);
  return { total, sold, left, soldOut: left === 0 };
}

/* ---------- counter: orders marked served (this device) ---------- */

const servedKey = (promotionId: string) => `wincentive:served:${promotionId}`;

export function servedCodes(promotionId: string): Record<string, number> {
  return store.get<Record<string, number>>(servedKey(promotionId)) ?? {};
}

export function setServed(promotionId: string, purchaseKey: string, served: boolean): void {
  const all = servedCodes(promotionId);
  if (served) all[purchaseKey.toLowerCase()] = Date.now();
  else delete all[purchaseKey.toLowerCase()];
  store.set(servedKey(promotionId), all);
}
