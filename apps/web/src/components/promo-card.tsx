"use client";

import Link from "next/link";
import type { PromotionDto } from "@/lib/api";
import { couponSupply, type ServerCoupons } from "@/lib/coupons";
import {
  condition,
  oddsPct,
  price,
  sellState,
  shortCountdown,
  stateText,
  whenText,
} from "@/lib/promo-view";
import { HowItWorksButton } from "./how-it-works";
import { IconClock } from "./icons";
import { Meter, Odds, Perforation } from "./kit";
import { Seal } from "./voucher";

export type Promo = PromotionDto & { coupons?: ServerCoupons | null };

/** Coupons left, with the "Selling out" badge once the shop's threshold is reached. */
export function CouponsLeft({
  p,
  sold,
  className = "",
}: {
  p: Promo;
  /** Sales this screen knows about (e.g. the counter feed), when the server sends no count. */
  sold?: number;
  className?: string;
}) {
  const s = couponSupply(p, sold);
  if (!s) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-center gap-2 text-[13.5px] leading-none">
        {s.soldOut ? (
          <span className="font-semibold text-ink-soft">Sold out</span>
        ) : (
          <span className={`font-semibold ${s.sellingOut ? "text-orange" : "text-ink-soft"}`}>
            {s.left} left
          </span>
        )}
        {s.sellingOut ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange px-2 py-[3px] text-[11.5px] font-bold text-black">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-black" aria-hidden />
            Selling out
          </span>
        ) : null}
      </div>
      <Meter value={s.left} max={s.total} hot={s.sellingOut} className="mt-2 w-24" />
    </div>
  );
}

/** "Kickoff Sat 3:30 PM" for games days out; "Sales close 8:45 PM" for today. */
export function closesText(deadline: number, now: number | null): string {
  return now !== null && deadline - now > 12 * 3600
    ? `Kickoff ${whenText(deadline, now)}`
    : `Sales close ${whenText(deadline, now)}`;
}

export function Countdown({ deadline, now }: { deadline: number; now: number | null }) {
  if (now === null) return null;
  const left = deadline - now;
  // Only when it is close; further out, the card says when kickoff is.
  if (left <= 0 || left > 3 * 3600) return null;
  const urgent = left < 3600;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[13.5px] font-semibold tabular-nums ${urgent ? "text-orange" : "text-ink-soft"}`}
      title="Until sales close"
    >
      <IconClock size={15} />
      {shortCountdown(left)}
    </span>
  );
}

export function PromoCard({
  p,
  now,
  variant = "full",
  sub = "shop",
}: {
  p: Promo;
  now: number | null;
  variant?: "full" | "compact";
  /** The line under the item: the shop's name, or when sales close (cards grouped by shop). */
  sub?: "shop" | "kickoff";
}) {
  const cond = condition(p);
  const odds = oddsPct(p.live?.liveAskMicroUsd);
  const st = sellState(p, now);
  const selling = st.kind === "selling";
  const href = `/checkout/${p.id}`;
  const cost = price(p.offerAmount);
  const compact = variant === "compact";

  return (
    <article
      className={`relative overflow-hidden rounded-[24px] bg-paper-raised ring-1 ring-inset ring-rule transition-colors hover:ring-line-strong ${compact ? "w-[276px] shrink-0 snap-start" : ""}`}
    >
      <Link
        href={href}
        className="absolute inset-0 z-0 rounded-[24px]"
        aria-label={`${p.itemName} at ${p.shop.name}, free if ${cond}`}
      />

      <div className="pointer-events-none relative px-4 pb-3.5 pt-4">
        <div className="flex items-start gap-3.5">
          <Seal seed={p.promoPda ?? p.id} size={compact ? 48 : 54} label={cost} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h3
              className={`font-title line-clamp-2 leading-tight ${compact ? "text-[19px]" : "text-[21px]"}`}
            >
              {p.itemName}
            </h3>
            <p className="truncate text-[14px] text-ink-soft">
              {sub === "kickoff" ? closesText(p.depositDeadline, now) : p.shop.name}
            </p>
          </div>
          <Odds pct={odds} size={compact ? 22 : 26} label="chance" className="shrink-0" />
        </div>
        <p
          className={`font-wide mt-3 font-bold leading-snug ${compact ? "text-[16px]" : "text-[18px]"}`}
        >
          {st.kind === "won" ? (
            <span className="text-ribbon">{stateText(st, cond)}</span>
          ) : (
            <>
              Free if {cond}
              {!compact ? (
                <HowItWorksButton
                  item={p.itemName.toLowerCase()}
                  price={cost}
                  cond={cond}
                  className="pointer-events-auto relative z-10 ml-1.5 translate-y-[2px]"
                />
              ) : null}
            </>
          )}
        </p>
      </div>

      <Perforation className="mx-4" />

      <div className="relative flex min-h-[60px] items-center justify-between gap-3 px-4 py-3">
        <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-3">
          {(selling || st.kind === "soldout") && couponSupply(p) ? (
            <CouponsLeft p={p} />
          ) : selling ? (
            <p className="text-[13.5px] font-semibold text-ink-soft">
              {closesText(p.depositDeadline, now)}
            </p>
          ) : st.kind !== "won" ? (
            <p className="text-[14px] font-semibold text-ink-soft">{stateText(st, cond)}</p>
          ) : (
            <p className="text-[14px] text-ink-soft">Paid back right after the game</p>
          )}
        </div>
        {selling ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="pointer-events-none">
              <Countdown deadline={p.depositDeadline} now={now} />
            </span>
            <Link
              href={href}
              className="relative z-10 inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-[15px] font-bold text-black transition-transform active:scale-[0.97]"
            >
              Buy {cost}
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}
