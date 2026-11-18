import { MOCK_USD_DECIMALS } from "@hedged/shared";

/** Integer base units (6 decimals) -> "$5.00". Never goes through floating point. */
export function usd(
  base: string | bigint | null | undefined,
  opts: { sign?: boolean } = {},
): string {
  if (base === null || base === undefined || base === "") return "–";
  let v = BigInt(base);
  const neg = v < 0n;
  if (neg) v = -v;
  const unit = 10n ** BigInt(MOCK_USD_DECIMALS);
  const cents = (v * 100n + unit / 2n) / unit;
  const dollars = cents / 100n;
  const rest = (cents % 100n).toString().padStart(2, "0");
  const body = `$${dollars.toLocaleString("en-US")}.${rest}`;
  if (neg) return `−${body}`;
  return opts.sign ? `+${body}` : body;
}

/** "5.00" style amount with no dollar sign, for token balances. */
export function tokenAmount(base: string | bigint): string {
  return usd(base).replace("$", "");
}

/** Dollars typed by a person ("5", "5.5") -> base units string, or null if not a valid amount. */
export function dollarsToBase(input: string): string | null {
  const m = /^\s*(\d{1,6})(?:\.(\d{0,6}))?\s*$/.exec(input);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(MOCK_USD_DECIMALS, "0");
  return (BigInt(m[1]!) * 10n ** BigInt(MOCK_USD_DECIMALS) + BigInt(frac || "0")).toString();
}

/** micro-USD per $1 contract -> "50¢" (or "$1.00"). */
export function cents(micro: string | bigint | null | undefined): string {
  if (micro === null || micro === undefined) return "–";
  const v = Number(BigInt(micro)) / 10_000;
  if (v >= 100) return "$1.00";
  return `${Number.isInteger(v) ? v : v.toFixed(1)}¢`;
}

/** micro-USD price -> market-implied chance, "50%". */
export function chance(micro: string | bigint | null | undefined): string {
  if (micro === null || micro === undefined) return "–";
  const v = Number(BigInt(micro)) / 10_000;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function shortAddr(addr: string | null | undefined, n = 4): string {
  if (!addr) return "–";
  return addr.length <= n * 2 + 1 ? addr : `${addr.slice(0, n)}…${addr.slice(-n)}`;
}

/** "3:05 AM" in the viewer's time zone. */
export function clock(unixOrIso: number | string): string {
  const d = typeof unixOrIso === "number" ? new Date(unixOrIso * 1000) : new Date(unixOrIso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Sat, Nov 21, 2:30 PM" in the viewer's time zone. */
export function dateTime(unixOrIso: number | string): string {
  const d = typeof unixOrIso === "number" ? new Date(unixOrIso * 1000) : new Date(unixOrIso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Seconds -> "4:05" under an hour, "2 h 05 m" under a day, else "3 days". */
export function countdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const s = Math.floor(seconds);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 86_400)
    return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} m`;
  const d = Math.floor(s / 86_400);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * What a Gemini market means, in words. Short crypto Up/Down tickers carry their own window:
 * `GEMI-SOL05M2611180805-UP` = SOL, 5-minute window ending 2026-11-18 08:05 UTC.
 */
export interface MarketMeaning {
  kind: "UP_DOWN" | "STANDARD";
  asset?: string;
  windowMinutes?: number;
  /** Unix seconds (UP_DOWN only). */
  opensAt?: number;
  closesAt?: number;
}

const UP_DOWN = /^GEMI-([A-Z]{2,10})(\d{1,3})M(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-UP$/;

export function marketMeaning(marketId: string): MarketMeaning {
  const m = UP_DOWN.exec(marketId);
  if (!m) return { kind: "STANDARD" };
  const [, asset, mins, yy, mo, dd, hh, mi] = m;
  const closesAt =
    Date.UTC(2000 + Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi)) / 1000;
  return {
    kind: "UP_DOWN",
    asset,
    windowMinutes: Number(mins),
    closesAt,
    opensAt: closesAt - Number(mins) * 60,
  };
}

/** The condition clause: "SOL closes up", "Texas wins", or the stored label. */
export function conditionText(outcomeLabel: string, marketId: string): string {
  const m = marketMeaning(marketId);
  if (m.kind === "UP_DOWN" && /up/i.test(outcomeLabel)) return `${m.asset} closes up`;
  return outcomeLabel;
}

/** Fine print that pins the condition to the exact market window. */
export function conditionFinePrint(marketId: string): string | null {
  const m = marketMeaning(marketId);
  if (m.kind !== "UP_DOWN" || m.opensAt === undefined || m.closesAt === undefined) return null;
  return `Up means ${m.asset}'s price at ${clock(m.closesAt)} is at or above its price at ${clock(m.opensAt)}, as officially settled by Gemini.`;
}

/** Stable small integer from a string (for per-promo guilloche patterns). */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Short order number a barista can match by eye: "#3AC3" from a purchase key or address. */
export function orderNumber(purchaseKey: string): string {
  const s = purchaseKey.startsWith("0x") ? purchaseKey.slice(2) : purchaseKey;
  return `#${s.slice(0, 4).toUpperCase()}`;
}
