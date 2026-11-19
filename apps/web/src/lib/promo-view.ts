import type { PromotionDto } from "./api";
import { conditionText } from "./format";

/** How a promo reads to a customer: odds, the condition, its selling state. Pure. */

export function oddsPct(micro: string | null | undefined): number | null {
  if (micro === null || micro === undefined) return null;
  return Number(BigInt(micro)) / 10_000;
}

/** "Texas wins", "SOL closes up". */
export function condition(p: Pick<PromotionDto, "outcomeLabel" | "geminiMarketId">): string {
  return conditionText(p.outcomeLabel, p.geminiMarketId);
}

/** Past tense for a result line: "Texas wins" -> "Texas won", "SOL closes up" -> "SOL closed up". */
export function happened(cond: string): string {
  return cond
    .replace(/\bwins\b/, "won")
    .replace(/\bwin\b/, "won")
    .replace(/\bcloses\b/, "closed")
    .replace(/\bscores\b/, "scored")
    .replace(/\bbeats\b/, "beat");
}

/** "2h 05m", "14m", "45s", "3d". */
export function shortCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400)
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 86_400)}d`;
}

/** "$5" for whole dollars, "$4.50" otherwise. */
export function price(base: string): string {
  const v = BigInt(base);
  const cents = (v + 5_000n) / 10_000n;
  const d = cents / 100n;
  const c = cents % 100n;
  return c === 0n
    ? `$${d.toLocaleString("en-US")}`
    : `$${d.toLocaleString("en-US")}.${String(c).padStart(2, "0")}`;
}

export type SellState =
  | { kind: "selling" }
  | { kind: "soldout" }
  | { kind: "paused" }
  | { kind: "closed" }
  | { kind: "won" }
  | { kind: "done" }
  | { kind: "draft" };

export function sellState(p: PromotionDto, now: number | null): SellState {
  if (p.status === "DRAFT") return { kind: "draft" };
  const phase = p.live?.phase;
  if (phase === "RESULT_YES") return { kind: "won" };
  if (phase === "RESULT_NO") return { kind: "done" };
  if (phase === "WAITING_FOR_RESULT" || (now !== null && now >= p.depositDeadline))
    return { kind: "closed" };
  if (phase === "PAUSED")
    return p.live?.pauseReason === "BUDGET_USED" ? { kind: "soldout" } : { kind: "paused" };
  if (phase === "LIVE") return { kind: "selling" };
  return { kind: "paused" };
}

/** Customer words for a non-selling state. */
export function stateText(s: SellState, cond: string): string {
  switch (s.kind) {
    case "soldout":
      return "Sold out";
    case "paused":
      return "Back soon";
    case "closed":
      return "Sales closed";
    case "won":
      return `${happened(cond)}. It was free.`;
    case "done":
      return "Promo over";
    case "draft":
      return "Not live yet";
    default:
      return "";
  }
}
