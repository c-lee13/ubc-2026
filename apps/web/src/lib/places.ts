import type { PromotionDto } from "./api";
import { seedOf } from "./format";
import { store } from "./hooks";

/**
 * Where a shop is, for the map. The API has no coordinates. Resolution order:
 *   1. a `geo: { lat, lng }` on the shop, if the server sends one (PROPOSED field;
 *      scripts/sample-api.mjs sends it for its Austin shops),
 *   2. CLIENT-SIDE: what this browser's shop picked in Create promo (kept in localStorage),
 *   3. the shop's `location` text (which the API does store, e.g. "South Lamar, Austin") matched
 *      against the Austin neighborhoods below, with a small stable offset per shop so two shops in
 *      one neighborhood don't stack. This is what lets other phones place a new shop's pin.
 * With none of these, the shop stays off the map (it is still in the list).
 */
export interface Place {
  lat: number;
  lng: number;
}

export const AUSTIN: Place = { lat: 30.2672, lng: -97.7431 };

export interface Neighborhood extends Place {
  name: string;
  match: RegExp;
}

/** Austin neighborhoods a shop can pick from (approximate centers). */
export const NEIGHBORHOODS: Neighborhood[] = [
  { name: "South Lamar", lat: 30.2508, lng: -97.7665, match: /s(outh|\.)? lamar/i },
  { name: "South Congress", lat: 30.2486, lng: -97.7499, match: /congress|soco/i },
  { name: "East 6th", lat: 30.2646, lng: -97.7306, match: /e(ast|\.)? 6th/i },
  { name: "Rainey Street", lat: 30.2588, lng: -97.7389, match: /rainey/i },
  { name: "East Cesar Chavez", lat: 30.2567, lng: -97.7262, match: /cesar chavez/i },
  { name: "Guadalupe", lat: 30.2868, lng: -97.7419, match: /guadalupe|west campus|the drag/i },
  { name: "Zilker", lat: 30.2631, lng: -97.7712, match: /zilker|barton springs rd/i },
  { name: "Clarksville", lat: 30.2793, lng: -97.7576, match: /clarksville/i },
  { name: "Hyde Park", lat: 30.3061, lng: -97.7293, match: /hyde park/i },
  { name: "Mueller", lat: 30.2983, lng: -97.7055, match: /mueller/i },
  { name: "Downtown", lat: 30.2672, lng: -97.7431, match: /downtown|congress ave/i },
];

const REG_KEY = "wincentive:shop-places";

/** CLIENT-SIDE: remember where this shop is (Create promo). */
export function rememberShopPlace(merchant: string, place: Place): void {
  const all = store.get<Record<string, Place>>(REG_KEY) ?? {};
  store.set(REG_KEY, { ...all, [merchant.toLowerCase()]: place });
}

function neighborhoodOf(location: string): Neighborhood | null {
  return NEIGHBORHOODS.find((n) => n.match.test(location)) ?? null;
}

/** A small, stable offset (about 150-300 m) so shops in one neighborhood don't overlap. */
function nudge(p: Place, key: string): Place {
  const h = seedOf(key);
  const a = ((h % 360) * Math.PI) / 180;
  const r = 0.0016 + ((h >> 9) % 100) * 0.00001;
  return { lat: p.lat + Math.sin(a) * r, lng: p.lng + Math.cos(a) * r * 1.15 };
}

/** Where a shop in this neighborhood goes on the map (stable per shop). */
export function placeIn(n: Neighborhood, merchant: string): Place {
  return nudge(n, merchant);
}

export function shopPlace(shop: PromotionDto["shop"] & { geo?: Place | null }): Place | null {
  if (shop.geo && Number.isFinite(shop.geo.lat) && Number.isFinite(shop.geo.lng)) return shop.geo;
  const mine = (store.get<Record<string, Place>>(REG_KEY) ?? {})[shop.merchant.toLowerCase()];
  if (mine) return mine;
  const n = shop.location ? neighborhoodOf(shop.location) : null;
  return n ? nudge(n, shop.merchant) : null;
}
