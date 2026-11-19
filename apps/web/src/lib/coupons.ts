"use client";

import { useEffect, useState } from "react";
import type { PromotionDto } from "./api";
import { store } from "./hooks";

/**
 * Coupon supply ("14 left", "Selling out") and the counter's "Served" marks.
 *
 * The API has no coupon count yet. The shop picks one when it creates a promo; until the backend
 * stores it, it lives in two places:
 *   1. a `coupons` field on the promotion, if the server sends one (scripts/sample-api.mjs does:
 *      the proposed shape `{ total, sold, sellingOutAt }`), and
 *   2. CLIENT-SIDE: this browser's registry, written by Create promo and the Edit sheet.
 * With neither, cards show no count (only "Sold out" when the API pauses for BUDGET_USED).
 */
export interface CouponSupply {
  total: number;
  sold: number;
  left: number;
  sellingOutAt: number;
  sellingOut: boolean;
  soldOut: boolean;
}

export interface ServerCoupons {
  total: number;
  sold: number;
  sellingOutAt?: number;
}

interface Registered {
  total: number;
  sellingOutAt: number;
}

const REG_KEY = "wincentive:coupons";
const EVENT = "wincentive:coupons";
export const DEFAULT_SELLING_OUT_AT = 5;

function registry(): Record<string, Registered> {
  return store.get<Record<string, Registered>>(REG_KEY) ?? {};
}

export function registerCoupons(promotionId: string, total: number, sellingOutAt: number): void {
  store.set(REG_KEY, { ...registry(), [promotionId]: { total, sellingOutAt } });
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
  const budgetUsed = p.live?.pauseReason === "BUDGET_USED";
  const server = p.coupons ?? null;
  const local = typeof window === "undefined" ? null : registeredCoupons(p.id);
  const total = server?.total ?? local?.total ?? null;
  if (total === null) return null;
  const sold = Math.min(total, server?.sold ?? soldCount ?? 0);
  const left = budgetUsed ? 0 : Math.max(0, total - sold);
  const sellingOutAt = local?.sellingOutAt ?? server?.sellingOutAt ?? DEFAULT_SELLING_OUT_AT;
  return {
    total,
    sold,
    left,
    sellingOutAt,
    sellingOut: left > 0 && left <= sellingOutAt,
    soldOut: left === 0,
  };
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
