"use client";

import Link from "next/link";
import { useState } from "react";
import { cents, clock, conditionText, countdown, dateTime, usd } from "@/lib/format";
import { useNowSeconds, useOrigin } from "@/lib/hooks";
import type { DashboardPromo } from "@/lib/merchant";
import {
  BTN_SMALL,
  DISPLAY,
  LINK,
  PILL_GREEN,
  PILL_GREY,
  PILL_ORANGE,
  PILL_PURPLE,
} from "../layout/styles";
import { SimTag } from "../ui";

// One published promotion in Zahin's ruled-record style (the dashboard's "Illustrative sample"
// article, now with real data). The left rule's color follows the promo's phase.

function phase(p: DashboardPromo, now: number | null) {
  const live = p.live;
  const left = now === null ? null : p.depositDeadline - now;
  const until =
    left !== null && left > 0
      ? left > 86_400
        ? dateTime(p.depositDeadline)
        : `in ${countdown(left)}`
      : clock(p.depositDeadline);
  switch (live?.phase) {
    case "LIVE":
      return {
        pill: PILL_PURPLE,
        label: "Selling",
        rule: "border-l-[#6133A7]",
        line: `At ${cents(live.liveAskMicroUsd)} on Gemini. Sales close ${until}.`,
      };
    case "PAUSED":
      return {
        pill: PILL_ORANGE,
        label: "Paused",
        rule: "border-l-[#F58C38]",
        line:
          live.pauseReason === "PRICE_ABOVE_THRESHOLD"
            ? `Market ${cents(live.liveAskMicroUsd)} is over your${p.maxYesPriceMicroUsd ? ` ${cents(p.maxYesPriceMicroUsd)}` : ""} limit.`
            : live.pauseReason === "PRICE_NEAR_THRESHOLD"
              ? `Market ${cents(live.liveAskMicroUsd)} is at your limit.`
              : live.pauseReason === "BUDGET_USED"
                ? "Hedge budget used up."
                : "No live price on Gemini.",
      };
    case "WAITING_FOR_RESULT":
      return {
        pill: PILL_GREY,
        label: "Waiting for result",
        rule: "border-l-[#CFC8BC]",
        line: `Sales closed ${clock(p.depositDeadline)}.`,
      };
    case "RESULT_YES":
      return {
        pill: PILL_GREEN,
        label: "It happened",
        rule: "border-l-[#1E8A5A]",
        line: "Customers' refunds are open.",
      };
    case "RESULT_NO":
      return {
        pill: PILL_GREY,
        label: "Didn't happen",
        rule: "border-l-[#211D28]",
        line: "You can collect covered sales on the Claims page.",
      };
    default:
      return { pill: PILL_GREY, label: p.onChainState, rule: "border-l-[#CFC8BC]", line: "" };
  }
}

export function PromotionRecord({ promo }: { promo: DashboardPromo }) {
  const now = useNowSeconds();
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);
  const ph = phase(promo, now);
  const price = usd(promo.offerAmount);
  const condition = conditionText(promo.outcomeLabel, promo.geminiMarketId);
  const s = promo.stats;
  const keepSame = s.ifYes === s.ifNo;
  const link = `${origin}/checkout/${promo.id}`;

  return (
    <article
      aria-label={`${promo.itemName} promotion`}
      className={`border-b border-l-[3px] border-b-[#E6E1D8] py-8 pl-5 sm:pl-7 ${ph.rule}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-xl">
          <span className={`inline-block ${ph.pill}`}>{ph.label}</span>
          <h3
            className={`${DISPLAY} mt-3 break-words text-[1.7rem] font-semibold leading-tight tracking-[-0.025em]`}
          >
            {promo.itemName}
          </h3>
          <p className="mt-1 text-sm text-[#5A5463]">{promo.shop.name}</p>
          {ph.line ? (
            <p className="mt-3 text-[15px] leading-relaxed text-[#4E4858]">{ph.line}</p>
          ) : null}
        </div>
        <div className="shrink-0 sm:text-right">
          <p
            className={`${DISPLAY} text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums`}
          >
            {price}
          </p>
          <p className="mt-1.5 text-xs text-[#5A5463]">test USDC</p>
        </div>
      </div>

      <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-[#E6E1D8] pt-5 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Refund condition</dt>
          <dd className="mt-1 font-medium">If {condition}, the customer is refunded.</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Sales close</dt>
          <dd className="mt-1 font-medium">{dateTime(promo.depositDeadline)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Market</dt>
          <dd className="mt-1 break-all font-mono text-[13px]">{promo.geminiMarketId}</dd>
        </div>
      </dl>

      <dl className="mt-5 grid grid-cols-3 gap-x-8 gap-y-3 border-t border-[#E6E1D8] pt-5 text-sm">
        <div title={`${s.hedged} covered, ${s.refundedOrCancelled} refunded`}>
          <dt className="text-xs text-[#5A5463]">Sold</dt>
          <dd className={`${DISPLAY} mt-1 text-2xl font-semibold tabular-nums`}>{s.purchases}</dd>
        </div>
        <div title={`${s.contracts} YES contracts`}>
          <dt className="text-xs text-[#5A5463]">
            Hedge cost <SimTag>simulated</SimTag>
          </dt>
          <dd className={`${DISPLAY} mt-1 text-2xl font-semibold tabular-nums`}>
            {usd(s.premium)}
          </dd>
        </div>
        <div
          title={
            keepSame
              ? "Per the simulated hedge, the same whichever way it goes, before the cost of the item."
              : `If it happens ${usd(s.ifYes)}. If not ${usd(s.ifNo)}.`
          }
        >
          <dt className="text-xs text-[#5A5463]">
            You keep <SimTag>simulated</SimTag>
          </dt>
          <dd className={`${DISPLAY} mt-1 text-2xl font-semibold tabular-nums`}>
            {keepSame ? usd(s.ifNo) : `${usd(s.ifNo)}*`}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3">
        <Link href={`/checkout/${promo.id}`} className={BTN_SMALL}>
          Open checkout
        </Link>
        <Link href={`/counter/${promo.id}`} className={BTN_SMALL}>
          Counter screen
        </Link>
        <button
          type="button"
          className={BTN_SMALL}
          title={link}
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        {promo.live?.phase === "RESULT_NO" ? (
          <Link href="/merchant/claims" className={`text-sm ${LINK}`}>
            Collect on Claims
          </Link>
        ) : null}
      </div>
    </article>
  );
}
