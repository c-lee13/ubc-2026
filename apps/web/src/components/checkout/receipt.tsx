"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, type PromotionDto, type PurchaseReceiptDto } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { cents, clock, countdown, marketMeaning, orderNumber, usd } from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet/session";
import { failureText } from "../merchant/ledger";
import { Button, ButtonLink, ChainLink, Notice, SimTag, Spinner } from "../ui";
import type { StampTone } from "../voucher";

type StepState = "todo" | "doing" | "done" | "failed" | "skipped";
const REFUND_STEPS = new Set(["REFUNDING", "REFUND_READY", "REFUNDED"]);

/**
 * The live receipt the customer shows at the counter: You're in (or: don't serve, refund coming),
 * then the result and the money. Polls GET /api/purchases/<purchaseKey> (docs/email-wallets.md,
 * checkout step 4).
 */
export function Receipt({
  purchaseKey,
  promo,
  onStamp,
}: {
  purchaseKey: string;
  promo: PromotionDto;
  onStamp: (s: { text: string; tone: StampTone } | null) => void;
}) {
  const w = useWallet();
  const now = useNowSeconds();
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const receipt = usePoll(() => api.purchase(purchaseKey), 3_000, [purchaseKey]);
  const r = receipt.data ?? null;
  const notYet = receipt.error instanceof ApiError && receipt.error.code === "purchase_not_found";
  const meaning = marketMeaning(promo.geminiMarketId);
  const outcome = r?.promotion.resolvedOutcome ?? null;

  useEffect(() => {
    onStamp(stampFor(r));
  }, [r, onStamp]);

  const v = deriveSteps(r);
  const dollars = usd(r?.amount ?? promo.offerAmount);
  const isBuyer = Boolean(
    r && w.wallet && w.wallet.address.toLowerCase() === r.customer.toLowerCase(),
  );
  const canClaim = Boolean(
    r && (r.onChainState === "Cancelled" || (r.onChainState === "Hedged" && outcome === "YES")),
  );

  async function claim() {
    if (!w.wallet) return;
    setBusy(true);
    setProblem(null);
    try {
      const ch = await api.claimRefund(purchaseKey, w.wallet.id);
      await w.execute(ch.challengeId, `Move your ${dollars} back to your balance`);
      setClaimed(true);
      receipt.refresh();
      void w.refreshWallet();
    } catch (err) {
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="overflow-hidden rounded-2xl bg-paper-raised ring-1 ring-ink/10"
      aria-live="polite"
    >
      <header className={`px-5 py-4 sm:px-6 ${headerTone(r)}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] opacity-85">{headerKicker(r)}</p>
            <p className="font-display text-[26px] leading-tight">{headerText(r, notYet)}</p>
          </div>
          <div className="text-right">
            <p className="text-[12px] opacity-80">Order</p>
            <p className="font-display text-[26px] leading-tight">{orderNumber(purchaseKey)}</p>
          </div>
        </div>
        <p className="mt-1 text-[14px] opacity-90">{headerDetail(r, promo.itemName)}</p>
      </header>

      <ol className="px-5 py-5 sm:px-6">
        <TimelineStep n={1} state={r ? "done" : "doing"} title="Paid" last={false}>
          {r ? null : <p>Confirming your payment…</p>}
        </TimelineStep>

        <TimelineStep
          n={2}
          state={v.covered}
          title={
            v.covered === "failed"
              ? "Not covered, so your money comes back"
              : "The shop covers your refund"
          }
          last={false}
        >
          {v.covered === "doing" ? (
            <p>
              {r?.step === "REFUNDING"
                ? "Not covered. Your $5 is coming back."
                : "Covering it now…"}
            </p>
          ) : null}
          {v.covered === "failed" ? (
            <p>
              {r?.hedge?.failureReason ? `${capitalize(failureText(r.hedge.failureReason))}. ` : ""}
              Your full {dollars} comes back.
            </p>
          ) : null}
          {r?.hedge &&
          r.hedge.premium &&
          r.hedge.status !== "FAILED" &&
          r.hedge.status !== "VOIDED" ? (
            <div className="bg-hatch-soft mt-2 rounded-lg px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-ink">
                  {r.hedge.contracts} YES contracts at {cents(r.hedge.avgFillPriceMicroUsd)} ={" "}
                  {usd(r.hedge.premium)}
                </p>
                <SimTag />
              </div>
            </div>
          ) : null}
        </TimelineStep>

        <TimelineStep n={3} state={v.result} title={resultTitle(v.result, outcome)} last={false}>
          {v.result === "doing" ? (
            <p>
              {meaning.closesAt && now !== null && meaning.closesAt > now
                ? `Result at ${clock(meaning.closesAt)} (in ${countdown(meaning.closesAt - now)}).`
                : "Any second now."}
            </p>
          ) : null}
        </TimelineStep>

        <TimelineStep n={4} state={v.money} title={moneyTitle(r, dollars)} last>
          {canClaim && !claimed ? (
            <div className="mt-1 space-y-2">
              <Button variant="note" busy={busy} onClick={claim} disabled={!isBuyer}>
                Get my {dollars} back
              </Button>
              {!isBuyer ? (
                <p className="text-[13px] text-ink-soft">Log in with the email that paid.</p>
              ) : null}
            </div>
          ) : r && (r.onChainState === "Refunded" || r.onChainState === "ClaimedByCustomer") ? (
            <p>Back in your balance.</p>
          ) : r?.onChainState === "ClaimedByMerchant" ||
            (outcome === "NO" && r?.onChainState === "Hedged") ? (
            <p>
              The shop keeps the {dollars}. Enjoy the {promo.itemName.toLowerCase()}.
            </p>
          ) : null}
        </TimelineStep>
      </ol>

      {problem ? (
        <div className="px-5 pb-5 sm:px-6">
          <Notice tone="error" title={problem.title}>
            {problem.detail}
          </Notice>
        </div>
      ) : null}

      <footer className="space-y-2 border-t border-ink/10 px-5 py-3 text-[12.5px] text-ink-soft sm:px-6">
        {receipt.error && !notYet ? <p>{describe(receipt.error).title}: retrying.</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink size="sm" variant="ghost" href={`/counter/${promo.id}`}>
            Counter screen
          </ButtonLink>
          <ButtonLink size="sm" variant="ghost" href="/me">
            My promos
          </ButtonLink>
        </div>
        {r ? <Proof r={r} /> : null}
      </footer>
    </section>
  );
}

/** On-chain proof, tucked away: the customer never needs it, a judge can open it. */
function Proof({ r }: { r: PurchaseReceiptDto }) {
  const t = r.transactions;
  const all: [string, string | null][] = [
    ["Payment", t.deposit],
    ["Covered", t.markHedged],
    ["Cancelled", t.cancel],
    ["Paid out", t.claim],
  ];
  const items = all.filter((x): x is [string, string] => Boolean(x[1]));
  return (
    <details>
      <summary
        className="cursor-pointer font-semibold text-ink-soft"
        title={`Escrow state ${r.onChainState}, server status ${r.status}${r.hedge ? `, simulated hedge fingerprint ${r.hedge.fingerprint}` : ""}`}
      >
        Proof on Arc
      </summary>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {items.map(([label, hash]) => (
          <ChainLink key={label} href={chain().explorerTx(hash)} label={label} value={hash} />
        ))}
      </div>
    </details>
  );
}

function deriveSteps(r: PurchaseReceiptDto | null): {
  covered: StepState;
  result: StepState;
  money: StepState;
} {
  if (!r) return { covered: "todo", result: "todo", money: "todo" };
  const s = r.onChainState;
  if (s === "Cancelled" || s === "Refunded" || r.step === "REFUNDING") {
    return {
      covered: s === "Deposited" ? "doing" : "failed",
      result: "skipped",
      money: s === "Refunded" ? "done" : "doing",
    };
  }
  if (s === "Deposited") return { covered: "doing", result: "todo", money: "todo" };
  const outcome = r.promotion.resolvedOutcome;
  if (!outcome) return { covered: "done", result: "doing", money: "todo" };
  if (outcome === "YES") {
    return {
      covered: "done",
      result: "done",
      money: s === "ClaimedByCustomer" ? "done" : "doing",
    };
  }
  return { covered: "done", result: "done", money: "done" };
}

function stampFor(r: PurchaseReceiptDto | null): { text: string; tone: StampTone } | null {
  if (!r) return { text: "PAID", tone: "ink" };
  const o = r.promotion.resolvedOutcome;
  switch (r.onChainState) {
    case "Deposited":
      return r.step === "REFUNDING"
        ? { text: "DON'T SERVE", tone: "stamp" }
        : { text: "PAID", tone: "ink" };
    case "Hedged":
      if (o === "YES") return { text: "MONEY BACK", tone: "note" };
      if (o === "NO") return { text: "NOT THIS TIME", tone: "ink" };
      return { text: "COVERED", tone: "note" };
    case "Cancelled":
      return { text: "REFUND READY", tone: "stamp" };
    case "Refunded":
      return { text: "REFUNDED", tone: "ink" };
    case "ClaimedByCustomer":
      return { text: "PAID BACK", tone: "note" };
    case "ClaimedByMerchant":
      return { text: "NOT THIS TIME", tone: "ink" };
  }
}

function headerTone(r: PurchaseReceiptDto | null): string {
  if (r?.canServe) return "bg-note text-paper-raised";
  if (r && REFUND_STEPS.has(r.step)) return "bg-stamp text-paper-raised";
  return "bg-paper-deep text-ink";
}

function headerKicker(r: PurchaseReceiptDto | null): string {
  return r && REFUND_STEPS.has(r.step)
    ? "Show the barista: don't serve"
    : "Show this to the barista";
}

function headerText(r: PurchaseReceiptDto | null, notYet: boolean): string {
  if (!r) return notYet ? "Confirming…" : "Paid";
  switch (r.step) {
    case "PROCESSING":
      return "One moment…";
    case "REFUNDING":
    case "REFUND_READY":
      return "Payment coming back";
    case "REFUNDED":
      return "Refunded";
    case "YOU_WON":
      return "It happened!";
    case "NOT_THIS_TIME":
      return "Not this time";
    case "DONE":
      return "All settled";
    default:
      return "You're in";
  }
}

function headerDetail(r: PurchaseReceiptDto | null, item: string): string {
  if (!r) return "Waiting for your payment to land.";
  if (r.step === "REFUNDING" || r.step === "REFUND_READY") {
    return `The shop couldn't cover this one. Your payment is being returned; no ${item.toLowerCase()} for this order.`;
  }
  if (r.step === "REFUNDED") return "Your payment is back in your balance.";
  if (r.canServe) return `Paid and covered: hand over the ${item.toLowerCase()}.`;
  return "Not covered yet: wait a moment before serving.";
}

function resultTitle(state: StepState, outcome: "YES" | "NO" | null): string {
  if (state === "skipped") return "The result doesn't matter for this order";
  if (outcome === "YES") return "It happened";
  if (outcome === "NO") return "It didn't happen this time";
  return "Waiting for the official result";
}

function moneyTitle(r: PurchaseReceiptDto | null, dollars: string): string {
  if (!r) return "Money goes where the result says";
  const s = r.onChainState;
  if (s === "Refunded") return `Refunded ${dollars}`;
  if (s === "ClaimedByCustomer") return `${dollars} back to you`;
  if (s === "Cancelled" || r.step === "REFUNDING") return `Your ${dollars} refund`;
  if (r.promotion.resolvedOutcome === "YES") return `Your ${dollars} is ready`;
  if (r.promotion.resolvedOutcome === "NO" || s === "ClaimedByMerchant") {
    return "The shop keeps the payment";
  }
  return "Money goes where the result says";
}

function TimelineStep({
  n,
  state,
  title,
  last,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  last: boolean;
  children?: ReactNode;
}) {
  const dot = {
    todo: "bg-paper-raised text-ink-faint ring-1 ring-ink/20",
    skipped: "bg-paper-raised text-ink-faint ring-1 ring-ink/15",
    doing: "bg-chain text-paper-raised",
    done: "bg-note text-paper-raised",
    failed: "bg-stamp text-paper-raised",
  }[state];
  const muted = state === "todo" || state === "skipped";
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      {!last ? (
        <span
          className={`absolute top-8 bottom-0 left-[15px] w-0.5 ${state === "done" || state === "failed" ? "bg-note/50" : "bg-ink/10"}`}
          aria-hidden
        />
      ) : null}
      <span
        className={`font-display relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] ${dot}`}
      >
        {state === "doing" ? (
          <Spinner className="h-4 w-4" />
        ) : state === "done" ? (
          <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" aria-hidden>
            <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ) : (
          n
        )}
      </span>
      <div className={`min-w-0 pt-1 text-[14.5px] ${muted ? "text-ink-faint" : "text-ink-soft"}`}>
        <p className={`text-[16px] font-bold ${muted ? "text-ink-faint" : "text-ink"}`}>{title}</p>
        {!muted ? <div className="mt-1">{children}</div> : null}
      </div>
    </li>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
