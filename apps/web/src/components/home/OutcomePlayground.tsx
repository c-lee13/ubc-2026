"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BRAND_HAIRLINE, DISPLAY, FOCUS } from "@/components/layout/styles";

// Outcome Playground: the homepage's interactive promotion preview.
//
// Local UI state only. It writes nothing and changes no purchase data. The offer it shows is either
// a promo selling right now (read by its parent from the API) or a labeled sample; either way both
// scenarios are hypothetical: neither is a market outcome, a deposit, a hedge fill or a claim.
//
// Motion explains behavior: the amount token travels from "Purchase" along the stem and out the
// branch of the party that could claim. Reduced-motion users get the final state with no travel.

type Outcome = "happens" | "doesnt";

type Props = {
  merchantName: string;
  name: string;
  description: string;
  /** Formatted display amount, e.g. "$5.00". */
  price: string;
  /** The merchant's own refund-condition label. Not a verified market outcome. */
  refundCondition: string;
  /** True when the offer is a real promo selling now; false for the labeled sample. */
  live: boolean;
  /** The Gemini market id behind a live offer (null for the sample). */
  marketId: string | null;
  /** Where "Open the checkout" goes: the live promo's checkout, or the list of offers. */
  checkoutHref: string;
};

// Track geometry (px, within a 112px-tall track). The SVG viewBox matches these y values.
const TRACK_H = 112;
const LANE_Y = { happens: 24, doesnt: 88 } as const;
const STEM_Y = 56;
const CHIP_W = 58;
const CHIP_H = 28;
const FORK_X = 38; // percent of the lane area where the stem splits

const OPTIONS: ReadonlyArray<{ key: Outcome; label: string }> = [
  { key: "happens", label: "Outcome happens" },
  { key: "doesnt", label: "Outcome doesn’t" },
];

function chipPos(o: Outcome) {
  return { left: `calc(100% - ${CHIP_W}px)`, top: `${LANE_Y[o] - CHIP_H / 2}px` };
}

export function OutcomePlayground({
  merchantName,
  name,
  description,
  price,
  refundCondition,
  live,
  marketId,
  checkoutHref,
}: Props) {
  const [outcome, setOutcome] = useState<Outcome>("happens");
  const prev = useRef<Outcome>("happens");
  const chip = useRef<HTMLSpanElement>(null);
  const radios = useRef<Record<Outcome, HTMLButtonElement | null>>({
    happens: null,
    doesnt: null,
  });

  // Travel animation: end of the old branch -> back to the fork -> end of the new branch.
  useEffect(() => {
    if (prev.current === outcome) return;
    const from = chipPos(prev.current);
    const to = chipPos(outcome);
    prev.current = outcome;
    const el = chip.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { left: from.left, top: from.top },
        {
          left: `calc(${FORK_X}% - ${CHIP_W / 2}px)`,
          top: `${STEM_Y - CHIP_H / 2}px`,
          offset: 0.42,
        },
        { left: to.left, top: to.top },
      ],
      { duration: 720, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
  }, [outcome]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const other: Outcome = outcome === "happens" ? "doesnt" : "happens";
    let next: Outcome | null = null;
    if (
      e.key === "ArrowRight" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowUp"
    )
      next = other;
    else if (e.key === "Home") next = "happens";
    else if (e.key === "End") next = "doesnt";
    if (next) {
      e.preventDefault();
      setOutcome(next);
      radios.current[next]?.focus();
    }
  }

  const happens = outcome === "happens";
  const pos = chipPos(outcome);

  return (
    <article
      aria-label={live ? "Promotion selling now" : "Illustrative promotion preview"}
      className="relative overflow-hidden rounded-[22px] border border-[#E6E1D8] bg-white shadow-[0_1px_0_rgba(33,29,40,0.04),0_32px_64px_-32px_rgba(33,29,40,0.35)]"
    >
      <div aria-hidden className={`h-[3px] ${BRAND_HAIRLINE}`} />
      <div className="p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-[#5A5463]">{merchantName}</p>
          {live ? (
            <span className="shrink-0 rounded-full bg-[#6133A7] px-3 py-1 text-xs font-bold text-white">
              Selling now
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
              Illustrative preview
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p
              className={`${DISPLAY} text-[1.75rem] font-semibold leading-tight tracking-[-0.025em]`}
            >
              {name}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[#5A5463]">{description}</p>
          </div>
          <div className="shrink-0 sm:text-right">
            <p
              className={`${DISPLAY} text-5xl font-semibold leading-none tracking-[-0.04em] tabular-nums`}
            >
              {price}
            </p>
            <p className="mt-1 text-xs text-[#5A5463]">
              {live ? "test USDC" : "test USDC, example amount"}
            </p>
          </div>
        </div>

        {/* Perforation: the ticket detail */}
        <div className="relative mt-7 border-t border-dashed border-[#CFC8BC] pt-5">
          <span
            aria-hidden
            className="absolute -left-[32px] -top-3 h-6 w-6 rounded-full border border-[#E6E1D8] bg-[#FAF9F6] sm:-left-[44px]"
          />
          <span
            aria-hidden
            className="absolute -right-[32px] -top-3 h-6 w-6 rounded-full border border-[#E6E1D8] bg-[#FAF9F6] sm:-right-[44px]"
          />

          <p id="playground-legend" className="text-sm font-semibold">
            Try both scenarios
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#5A5463]">
            Refund condition, in the merchant&apos;s words: if {refundCondition}.
          </p>

          {/* Two-option selector (radio group) */}
          <div
            role="radiogroup"
            aria-labelledby="playground-legend"
            className="relative mt-3 grid grid-cols-2 rounded-full bg-[#F1ECE2] p-1"
          >
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-[0_1px_2px_rgba(33,29,40,0.18)] transition-transform duration-300 ease-out motion-reduce:transition-none"
              style={{ transform: `translateX(${happens ? 0 : 100}%)` }}
            />
            {OPTIONS.map((o) => {
              const checked = outcome === o.key;
              return (
                <button
                  key={o.key}
                  ref={(el) => {
                    radios.current[o.key] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => setOutcome(o.key)}
                  onKeyDown={onKeyDown}
                  className={`relative min-h-11 rounded-full px-2 text-sm font-semibold leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6133A7] ${
                    checked ? "text-[#211D28]" : "text-[#5A5463] hover:text-[#211D28]"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>

          {/* Settlement track: where the amount could go */}
          <div aria-hidden className="relative mt-4" style={{ height: TRACK_H }}>
            <div className="absolute inset-y-0 left-0 w-[58%]">
              <svg
                viewBox={`0 0 100 ${TRACK_H}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full overflow-visible"
                fill="none"
              >
                <path
                  d={`M0 ${STEM_Y} H${FORK_X}`}
                  stroke="#211D28"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={`M${FORK_X} ${STEM_Y} C${FORK_X + 12} ${STEM_Y} ${FORK_X + 14} ${LANE_Y.happens} ${FORK_X + 28} ${LANE_Y.happens} H100`}
                  stroke={happens ? "#6133A7" : "#CFC8BC"}
                  strokeWidth={happens ? 2.5 : 1.5}
                  strokeDasharray={happens ? undefined : "4 4"}
                  vectorEffect="non-scaling-stroke"
                  className="transition-[stroke] duration-300 motion-reduce:transition-none"
                />
                <path
                  d={`M${FORK_X} ${STEM_Y} C${FORK_X + 12} ${STEM_Y} ${FORK_X + 14} ${LANE_Y.doesnt} ${FORK_X + 28} ${LANE_Y.doesnt} H100`}
                  stroke={happens ? "#CFC8BC" : "#F58C38"}
                  strokeWidth={happens ? 1.5 : 2.5}
                  strokeDasharray={happens ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                  className="transition-[stroke] duration-300 motion-reduce:transition-none"
                />
              </svg>
              <span
                className="absolute left-0 text-[11px] font-medium text-[#5A5463]"
                style={{ top: STEM_Y + 8 }}
              >
                Purchase
              </span>
              <span
                ref={chip}
                className={`${DISPLAY} absolute flex items-center justify-center rounded-full text-sm font-bold tabular-nums shadow-[0_2px_6px_rgba(33,29,40,0.25)] transition-colors duration-300 motion-reduce:transition-none ${
                  happens ? "bg-[#6133A7] text-white" : "bg-[#F58C38] text-[#211D28]"
                }`}
                style={{ width: CHIP_W, height: CHIP_H, left: pos.left, top: pos.top }}
              >
                {price}
              </span>
            </div>

            <div className="absolute inset-y-0 left-[62%] right-0">
              {(
                [
                  ["happens", "Customer", "could claim it back"],
                  ["doesnt", "Merchant", "could claim it"],
                ] as const
              ).map(([key, who, doing]) => {
                const active = outcome === key;
                return (
                  <div
                    key={key}
                    className="absolute left-0 right-0 -translate-y-1/2"
                    style={{ top: LANE_Y[key] }}
                  >
                    <p
                      className={`${DISPLAY} text-base font-bold leading-tight transition-colors duration-300 motion-reduce:transition-none ${
                        active
                          ? key === "happens"
                            ? "text-[#6133A7]"
                            : "text-[#7A4208]"
                          : "text-[#8A8494]"
                      }`}
                    >
                      {who}
                    </p>
                    <p
                      className={`text-xs leading-tight ${active ? "font-medium text-[#4E4858]" : "text-[#8A8494]"}`}
                    >
                      {active ? doing : "no claim"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <p aria-live="polite" className="mt-3 text-sm leading-relaxed text-[#211D28]">
            {happens
              ? `Once settlement is verified, the customer could claim their ${price} back.`
              : `Once settlement is verified, the merchant could claim the ${price}.`}
          </p>
        </div>

        <p className="mt-5 border-t border-[#E6E1D8] pt-3 text-xs leading-relaxed text-[#5A5463]">
          Escrow: Arc testnet, test USDC. Pricing context: Gemini Predictions, read-only.{" "}
          {marketId ? (
            <>
              Market: <span className="break-all font-mono">{marketId}</span>.
            </>
          ) : (
            "No market is linked to this sample."
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="max-w-[20rem] text-xs leading-relaxed text-[#5A5463]">
            {live
              ? "The two scenarios are a preview: neither is a result. A real claim needs the official outcome."
              : "Illustrative only. No live odds, deposits or settlements are shown. A real claim needs verified settlement."}
          </p>
          <Link
            href={checkoutHref}
            className={`text-sm font-semibold text-[#6133A7] underline underline-offset-4 hover:text-[#4E2890] ${FOCUS}`}
          >
            {live ? "Open the checkout" : "See live offers"}
          </Link>
        </div>
      </div>
    </article>
  );
}
