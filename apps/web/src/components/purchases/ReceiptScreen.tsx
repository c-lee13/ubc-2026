"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ApiError, type PurchaseReceiptDto } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { describe } from "@/lib/errors";
import {
  cents,
  clock,
  conditionText,
  countdown,
  marketMeaning,
  orderNumber,
  shortAddr,
  usd,
} from "@/lib/format";
import { store, useNowSeconds, usePoll, useSeenFor } from "@/lib/hooks";
import {
  CANCEL_AFTER_SECS,
  ESCROW_STATE_TEXT,
  PURCHASE_KEY,
  STUCK_AFTER_SECS,
  failureText,
  myPurchasesKey,
  receiptHeadline,
  receiptStages,
  refundClaimable,
  type MyPurchase,
  type StageState,
} from "@/lib/purchases";
import { useWallet } from "@/lib/wallet/session";
import {
  BACK_LINK,
  BRAND_HAIRLINE,
  BTN_BLOCK,
  DISPLAY,
  EYEBROW,
  EYEBROW_RULE,
  PANEL,
  PILL_GREEN,
  PILL_GREY,
  PILL_ORANGE,
  TICKET,
} from "../layout/styles";
import { LoginCard } from "../login-card";
import { StatusBadge } from "../ui/StatusBadge";
import { TransactionStatus, type TransactionState } from "../ui/TransactionStatus";
import { ChainLink, SimTag, Spinner } from "../ui";
import { NetworkNote } from "../wallet/NetworkNote";

// The live receipt, in Zahin's receipt layout: summary ticket and tracking timeline (left), the
// refund panel (right). Polls GET /api/purchases/:key (docs/FRONTEND-API.md "Receipt").
// A stage is shown as verified only from the on-chain escrow state; hedge figures are simulated.
// Getting money back follows the receipt's `autoPayout`: true (escrow v2) = sent automatically, no
// button unless a payout sits for a few minutes; false (escrow v1) = the claim buttons by `step`.

const REFUND_STEPS = new Set(["REFUNDING", "REFUND_READY", "REFUNDED"]);

/** Timeline marker. Solid = verified on Arc; dashed = in progress; outlined = not yet. */
function Marker({ state }: { state: StageState | "keyDone" | "keyDoing" | "keyNone" }) {
  if (state === "done" || state === "keyDone") {
    return (
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#6133A7] text-white"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
          <path
            d="M5 10.4l3.2 3.2L15 6.8"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#C4372B] text-white"
      >
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none">
          <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      </span>
    );
  }
  if (state === "doing" || state === "keyDoing") {
    return (
      <span
        aria-hidden
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-dashed border-[#6133A7] bg-[#EFE9F8]"
      >
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#6133A7]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="block h-[22px] w-[22px] rounded-full border-2 border-[#A59E92] bg-[#FAF9F6]"
    />
  );
}

export function ReceiptScreen({ purchaseKey }: { purchaseKey: string }) {
  const valid = PURCHASE_KEY.test(purchaseKey);
  const receipt = usePoll(valid ? () => api.purchase(purchaseKey) : null, 3_000, [purchaseKey]);
  const r = receipt.data ?? null;

  if (!r) {
    const waiting =
      valid &&
      (receipt.loading ||
        (receipt.error instanceof ApiError && receipt.error.code === "purchase_not_found"));
    return (
      <Unavailable
        purchaseKey={purchaseKey}
        mode={!valid ? "invalid" : waiting ? "waiting" : "error"}
        error={receipt.error}
      />
    );
  }
  return (
    <Receipt r={r} purchaseKey={purchaseKey} stale={receipt.error} onClaimed={receipt.refresh} />
  );
}

function Intro({
  back,
  eyebrow,
  title,
  lead,
}: {
  back: ReactNode;
  eyebrow: string;
  title: string;
  lead: ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-4 sm:px-8 lg:pb-10">
      <div className="-my-3 flex flex-wrap items-center gap-x-6">{back}</div>
      <div className="mt-6 max-w-3xl">
        <p className={EYEBROW}>
          <span aria-hidden className={EYEBROW_RULE} />
          {eyebrow}
        </p>
        <h1
          className={`${DISPLAY} mt-5 text-[clamp(2.5rem,5vw,4.2rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
        >
          {title}
        </h1>
        <p className="mt-5 max-w-[36rem] text-lg leading-relaxed text-[#5A5463]">{lead}</p>
      </div>
    </section>
  );
}

/* ---------- not a receipt (yet): Zahin's "Unavailable" layout ---------- */

function Unavailable({
  purchaseKey,
  mode,
  error,
}: {
  purchaseKey: string;
  mode: "invalid" | "waiting" | "error";
  error: unknown;
}) {
  const lead =
    mode === "invalid"
      ? "This link isn't a purchase reference, so no purchase details, status or timeline are available."
      : mode === "waiting"
        ? "The promo server hasn't seen this purchase yet. It appears once Arc confirms the payment, usually within seconds. This page keeps checking."
        : `${describe(error).detail} This page keeps trying.`;
  return (
    <>
      <Intro
        back={
          <Link href="/me" className={BACK_LINK}>
            ← My purchases
          </Link>
        }
        eyebrow={mode === "waiting" ? "Your receipt" : "Receipt unavailable"}
        title={mode === "waiting" ? "Confirming your payment." : "We can’t show this receipt yet."}
        lead={lead}
      />
      <div className="mx-auto max-w-[1240px] px-5 pb-16 sm:px-8 lg:pb-20">
        <div className="lg:w-7/12">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              className={`${DISPLAY} text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]`}
            >
              Purchase Details
            </h2>
            <span className={PILL_GREY}>
              {mode === "waiting" ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner className="h-3 w-3" /> Waiting for Arc
                </span>
              ) : mode === "invalid" ? (
                "Not a purchase link"
              ) : (
                describe(error).title
              )}
            </span>
          </div>
          <dl className="mt-6 divide-y divide-[#E6E1D8] border-y-2 border-t-[#211D28] border-b-[#E6E1D8] text-sm">
            <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
              <dt className="shrink-0 text-[#5A5463]">Purchase reference</dt>
              <dd className="min-w-0 font-medium sm:text-right">
                <span className="break-all font-mono">{purchaseKey}</span>
                <span className="block text-xs font-normal text-[#5A5463]">
                  From the link, not verified yet
                </span>
              </dd>
            </div>
            {["Promotion", "Purchase amount (test USDC)", "Payment on Arc", "Purchase status"].map(
              (label) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <dt className="shrink-0 text-[#5A5463]">{label}</dt>
                  <dd className="min-w-0 font-medium text-[#5A5463] sm:text-right">
                    {mode === "waiting" ? "Waiting…" : "Unavailable"}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </div>
      </div>
    </>
  );
}

/* ---------- the receipt ---------- */

function Receipt({
  r,
  purchaseKey,
  stale,
  onClaimed,
}: {
  r: PurchaseReceiptDto;
  purchaseKey: string;
  stale: unknown;
  onClaimed: () => void;
}) {
  const now = useNowSeconds();
  const price = usd(r.amount);
  const item = r.promotion.itemName;
  const condition = conditionText(r.promotion.outcomeLabel, r.promotion.geminiMarketId);
  // Headline from the receipt step; the server's sentence below it, minus a repeat of the headline.
  const headline = receiptHeadline(r, item);
  const title = /[.!…]$/.test(headline) ? headline : `${headline}.`;
  const bare = headline.replace(/[.!…]+$/, "");
  const rest = r.message.startsWith(bare)
    ? r.message.slice(bare.length).replace(/^[.!…]+\s*/, "")
    : r.message;
  const lead = rest || "Show the order number at the counter.";
  const stages = receiptStages(r);
  const refunding = REFUND_STEPS.has(r.step);
  const outcome = r.promotion.resolvedOutcome;
  const meaning = marketMeaning(r.promotion.geminiMarketId);
  const h = r.hedge;
  const hedgeLine =
    h && h.premium && h.status !== "FAILED" && h.status !== "VOIDED"
      ? `${h.contracts} YES contracts at ${cents(h.avgFillPriceMicroUsd)} = ${usd(h.premium)}`
      : null;

  const STAGES: {
    key: keyof typeof stages;
    title: string;
    body: string;
    related: string;
    detail: ReactNode;
  }[] = [
    {
      key: "paid",
      title: "Purchase submitted",
      body: "You paid test USDC into the escrow on Arc",
      related: "Deposited",
      detail: r.transactions.deposit ? (
        <ChainLink
          href={chain().explorerTx(r.transactions.deposit)}
          label="Payment on Arc"
          value={r.transactions.deposit}
        />
      ) : (
        "Confirming your payment…"
      ),
    },
    {
      key: "covered",
      title: stages.covered === "failed" ? "Not covered: your money comes back" : "Hedge recorded",
      body: "The promo server checks the payment, records a simulated Gemini hedge, and Arc marks the purchase covered",
      related: "Hedge simulated, then Hedged once confirmed on Arc",
      detail:
        stages.covered === "failed" ? (
          `${h?.failureReason ? `${capitalize(failureText(h.failureReason))}. ` : ""}Your full ${price} comes back.`
        ) : stages.covered === "doing" ? (
          refunding ? (
            `Not covered. Your ${price} is coming back.`
          ) : (
            "Covering it now…"
          )
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {r.transactions.markHedged ? (
              <ChainLink
                href={chain().explorerTx(r.transactions.markHedged)}
                label="Covered on Arc"
                value={r.transactions.markHedged}
              />
            ) : null}
            {hedgeLine ? (
              <span title="Priced from Gemini's live order book. No order was placed.">
                {hedgeLine} <SimTag />
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: "result",
      title: "Outcome finalized",
      body: `The Gemini market's official final result decides whether ${condition}`,
      related: "Resolved",
      detail:
        stages.result === "skipped"
          ? "The result doesn't matter for this order: it is being refunded."
          : outcome === "YES"
            ? "It happened."
            : outcome === "NO"
              ? "It didn't happen this time."
              : meaning.closesAt && now !== null && meaning.closesAt > now
                ? `Result at ${clock(meaning.closesAt)} (in ${countdown(meaning.closesAt - now)}).`
                : "Waiting for the official result.",
    },
    {
      key: "money",
      title: r.autoPayout ? "Paid out automatically" : "Eligible party claims",
      body: r.autoPayout
        ? "The escrow sends the test USDC to the customer or the merchant on its own"
        : "The customer or the merchant claims the escrowed test USDC",
      related: r.autoPayout ? "Refunded or claimed" : "Claimed",
      detail:
        r.onChainState === "Refunded" || r.onChainState === "ClaimedByCustomer" ? (
          <span className="flex flex-wrap items-center gap-x-3">
            Back in your balance.
            {r.transactions.claim ? (
              <ChainLink
                href={chain().explorerTx(r.transactions.claim)}
                label="Paid out on Arc"
                value={r.transactions.claim}
              />
            ) : null}
          </span>
        ) : r.onChainState === "ClaimedByMerchant" ||
          (outcome === "NO" && r.onChainState === "Hedged") ? (
          `The shop keeps the ${price}. Enjoy the ${item.toLowerCase()}.`
        ) : refundClaimable(r) ? (
          r.autoPayout ? (
            `Your ${price} is on its way to your balance.`
          ) : (
            `Your ${price} is ready: claim it in the panel.`
          )
        ) : (
          `${price} back to you, or the shop keeps it.`
        ),
    },
  ];

  return (
    <>
      <Intro
        back={
          <>
            <Link href={`/checkout/${r.promotion.id}`} className={BACK_LINK}>
              ← Back to checkout
            </Link>
            <Link href="/me" className={BACK_LINK}>
              ← My purchases
            </Link>
          </>
        }
        eyebrow={refunding ? "Don't serve this order" : "Your receipt"}
        title={title}
        lead={lead}
      />

      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-20">
        {/* Left: the receipt and its progress */}
        <div className="lg:col-span-7">
          <section aria-labelledby="details-heading">
            <article aria-label="Receipt" className={TICKET}>
              <div
                aria-hidden
                className={`h-[3px] ${refunding ? "bg-[#C4372B]" : BRAND_HAIRLINE}`}
              />
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <StatusBadge status={r.status} />
                  {r.canServe ? (
                    <span className={PILL_GREEN}>Paid and covered: serve it</span>
                  ) : refunding ? (
                    <span className="rounded-full bg-[#FCEDEB] px-3 py-1 text-xs font-bold text-[#8A1F16]">
                      Don&apos;t serve
                    </span>
                  ) : null}
                </div>
                <h2 id="details-heading" className="sr-only">
                  Purchase Details
                </h2>

                <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#5A5463]">Promotion</p>
                    <p
                      className={`${DISPLAY} mt-1 break-words text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.035em]`}
                    >
                      {item} at {r.promotion.shopName}
                    </p>
                    <p className="mt-1 text-sm text-[#5A5463]">Free if {condition}</p>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <p className="text-xs font-medium text-[#5A5463]">Order number</p>
                    <p
                      className={`${DISPLAY} mt-1 text-[3rem] font-semibold leading-none tracking-[-0.045em] tabular-nums`}
                      title="Show this at the counter"
                    >
                      {r.orderCode ? `#${r.orderCode}` : orderNumber(purchaseKey)}
                    </p>
                  </div>
                </div>

                <div aria-hidden className="my-7 border-t border-dashed border-[#CFC8BC]" />

                <dl className="divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
                  <Row label="Purchase amount (test USDC)">
                    <span className={`${DISPLAY} text-xl font-semibold tabular-nums`}>{price}</span>
                  </Row>
                  <Row label="Purchase reference">
                    <span className="break-all font-mono">{purchaseKey}</span>
                  </Row>
                  <Row label="Payment on Arc">
                    {r.transactions.deposit ? (
                      <ChainLink
                        href={chain().explorerTx(r.transactions.deposit)}
                        label="View transaction"
                        value={r.transactions.deposit}
                      />
                    ) : (
                      <span className="text-[#5A5463]">Not seen yet</span>
                    )}
                  </Row>
                  <Row label="Escrow state (on Arc)">
                    <span className="font-semibold text-[#3F2A66]">
                      {ESCROW_STATE_TEXT[r.onChainState]}
                    </span>
                  </Row>
                  <Row label="Paid from">
                    <span className="font-mono">{shortAddr(r.customer, 6)}</span>
                  </Row>
                </dl>
              </div>
            </article>
          </section>

          {stale ? (
            <p className="mt-4 text-xs text-[#5A5463]">
              {describe(stale).title}: showing the last data received, retrying.
            </p>
          ) : null}

          {/* Purchase progress: a vertical timeline, verified from the escrow state. */}
          <section
            id="tracking"
            aria-labelledby="tracking-heading"
            className="mt-14 border-t border-[#E6E1D8] pt-10"
          >
            <h2
              id="tracking-heading"
              className={`${DISPLAY} text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]`}
            >
              Purchase Tracking
            </h2>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
              Live from the promo server and the escrow on Arc. Updates on its own.
            </p>

            <div
              role="group"
              aria-label="Timeline key"
              className="mt-5 flex flex-wrap items-start gap-x-8 gap-y-3 border-y border-[#E6E1D8] py-3.5"
            >
              <p className="text-xs font-semibold text-[#5A5463] sm:pt-0.5">Key</p>
              <ul className="grid flex-1 gap-x-6 gap-y-3 text-xs text-[#4E4858] sm:grid-cols-3">
                <li className="flex items-center gap-2.5">
                  <Marker state="keyDone" />
                  <span className="font-semibold text-[#211D28]">Verified on Arc</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Marker state="keyDoing" />
                  <span className="font-semibold text-[#211D28]">In progress</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Marker state="keyNone" />
                  <span className="font-semibold text-[#211D28]">Not yet</span>
                </li>
              </ul>
            </div>

            <ol className="mt-8">
              {STAGES.map((stage) => {
                const state = stages[stage.key];
                const muted = state === "todo" || state === "skipped";
                return (
                  <li
                    key={stage.key}
                    className="relative ml-[10px] border-l border-[#CFC8BC] pb-9 pl-9 last:border-l-transparent last:pb-0"
                  >
                    <span className="absolute -left-[11px] top-0">
                      <Marker state={state} />
                    </span>
                    <h3
                      className={`${DISPLAY} text-xl font-semibold leading-tight tracking-[-0.02em] ${muted ? "text-[#8A8494]" : ""}`}
                    >
                      {stage.title}
                    </h3>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-[#4E4858]">
                      {stage.body}
                    </p>
                    <p className="mt-1 text-xs text-[#5A5463]">Related status: {stage.related}</p>
                    {muted && state === "todo" ? null : (
                      <div
                        className={`mt-2 text-xs font-semibold ${state === "failed" ? "text-[#8A1F16]" : state === "done" ? "text-[#3F2A66]" : "text-[#5A5463]"}`}
                      >
                        {stage.detail}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        {/* Right: the claim area, a narrower supporting column */}
        <aside aria-labelledby="claim-heading" className="lg:col-span-5">
          <ClaimPanel r={r} purchaseKey={purchaseKey} price={price} onClaimed={onClaimed} />
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-[#5A5463]">{label}</dt>
      <dd className="min-w-0 font-medium sm:text-right">{children}</dd>
    </div>
  );
}

/* ---------- getting the money back ---------- */

function ClaimPanel({
  r,
  purchaseKey,
  price,
  onClaimed,
}: {
  r: PurchaseReceiptDto;
  purchaseKey: string;
  price: string;
  onClaimed: () => void;
}) {
  const w = useWallet();
  const now = useNowSeconds();
  const [tx, setTx] = useState<TransactionState>({ status: "idle" });
  const ready = w.phase === "ready" && Boolean(w.wallet);
  const isBuyer = Boolean(
    ready && w.wallet && w.wallet.address.toLowerCase() === r.customer.toLowerCase(),
  );
  const auto = r.autoPayout;
  const claimable = refundClaimable(r);
  const paidBack = r.onChainState === "Refunded" || r.onChainState === "ClaimedByCustomer";
  const shopKeeps =
    r.onChainState === "ClaimedByMerchant" ||
    (r.promotion.resolvedOutcome === "NO" && r.onChainState === "Hedged");

  // Escrow v2: the claim is only a fallback once an automatic payout has sat for a few minutes.
  const seenFor = useSeenFor(claimable ? [`${purchaseKey}:${r.step}`] : []);
  const stuck = claimable && auto && seenFor(`${purchaseKey}:${r.step}`) >= STUCK_AFTER_SECS;
  const offerClaim = claimable && (!auto || stuck);

  // A payment still not covered 10 minutes after paying: the customer can cancel it on Arc.
  const deposited = r.step === "PROCESSING" && r.onChainState === "Deposited";
  const list = usePoll(
    deposited && isBuyer ? () => api.customerPurchases(r.customer) : null,
    30_000,
    [deposited, isBuyer, r.customer],
  );
  const local = deposited
    ? (store.get<MyPurchase[]>(myPurchasesKey(r.customer)) ?? []).find(
        (m) => m.purchaseKey.toLowerCase() === purchaseKey.toLowerCase(),
      )
    : undefined;
  const paidAt =
    list.data?.purchases.find((p) => p.purchasePda.toLowerCase() === purchaseKey.toLowerCase())
      ?.depositedAt ?? (local ? Math.floor(local.at / 1000) : null);
  const canCancel =
    deposited && paidAt !== null && now !== null && now >= paidAt + CANCEL_AFTER_SECS;

  const eligibility = paidBack
    ? { pill: PILL_GREEN, text: "Paid back" }
    : claimable
      ? { pill: PILL_GREEN, text: auto ? "On its way" : "Eligible" }
      : shopKeeps
        ? { pill: PILL_GREY, text: "Not eligible" }
        : { pill: PILL_ORANGE, text: "Not yet" };

  const why = paidBack
    ? `Your ${price} is back in your balance.`
    : r.onChainState === "Cancelled"
      ? auto
        ? `The shop couldn't cover this purchase, so the escrow is sending your full ${price} back. No action needed.`
        : `The shop couldn't cover this purchase, so the escrow owes you the full ${price}.`
      : claimable
        ? auto
          ? `It happened, and the escrow on Arc shows this purchase covered: your ${price} is being sent back automatically.`
          : `It happened, and the escrow on Arc shows this purchase covered: your ${price} can come back.`
        : shopKeeps
          ? "The official result was no, so the shop keeps this payment."
          : auto
            ? "Once the official result is in (or right away if the shop can't cover the purchase), the escrow on Arc pays you automatically if you're owed."
            : "Eligibility comes from the escrow on Arc once the official result is in (or right away if the shop can't cover the purchase).";

  async function run(kind: "claim" | "cancel") {
    if (!w.wallet) return;
    const what =
      kind === "claim"
        ? `Move your ${price} back to your balance`
        : `Cancel this payment so your ${price} can come back`;
    setTx({ status: "awaiting_signature", what });
    try {
      const ch =
        kind === "claim"
          ? await api.claimRefund(purchaseKey, w.wallet.id)
          : await api.cancelExpired(purchaseKey, w.wallet.id);
      await w.execute(ch.challengeId, what);
      setTx({ status: "confirming" });
      onClaimed();
      void w.refreshWallet();
    } catch (err) {
      const p = describe(err);
      setTx({ status: "failed", message: `${p.title}. ${p.detail}` });
    }
  }

  const busy = tx.status === "awaiting_signature";
  const done = paidBack && tx.status !== "idle" ? { status: "confirmed" as const } : null;
  const action = canCancel ? "cancel" : "claim";
  const showButton = !auto || offerClaim || canCancel || paidBack;

  return (
    <div className={PANEL}>
      <h2
        id="claim-heading"
        className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
      >
        {auto ? "Refund" : "Claim Refund"}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[#5A5463]">
        {auto
          ? "Refunds are sent to your email wallet automatically. If one is stuck, you can claim it with one approval."
          : "Eligible customers move their test USDC back with one approval in Circle's window."}
      </p>

      {/* Eligibility */}
      <section
        aria-labelledby="eligibility-heading"
        className="mt-6 border-t border-[#E6E1D8] pt-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="eligibility-heading" className="text-sm font-semibold">
            Refund Eligibility
          </h3>
          <span className={eligibility.pill}>{eligibility.text}</span>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[#5A5463]">{why}</p>
      </section>

      {/* Wallet: the purchase's own email wallet is the only one that can claim. */}
      <section className="mt-6 border-t border-[#E6E1D8] pt-6">
        <h3 className="text-sm font-semibold">Your email wallet</h3>
        {!ready ? (
          <div className="mt-3">
            <LoginCard compact cta={auto ? "Log in" : "Log in to claim"} />
          </div>
        ) : isBuyer ? (
          <p className="mt-2 text-[13px] leading-relaxed text-[#5A5463]">
            Logged in as {w.email}, the wallet that paid.
          </p>
        ) : (
          <p className="mt-2 text-[13px] leading-relaxed text-[#7A4208]">
            {w.email}&apos;s wallet didn&apos;t make this purchase (it was paid from{" "}
            <span className="font-mono">{shortAddr(r.customer)}</span>). Log in with the email you
            paid with to claim.
          </p>
        )}
        <NetworkNote />
      </section>

      {/* The action: a claim (v1, or a stuck v2 payout) or a timeout cancel */}
      <section className="mt-6 border-t border-[#E6E1D8] pt-6">
        {showButton ? (
          <button
            type="button"
            disabled={
              (action === "claim" ? !offerClaim : !canCancel) ||
              !isBuyer ||
              busy ||
              tx.status === "confirming"
            }
            onClick={() => run(action)}
            className={BTN_BLOCK}
          >
            {busy ? <Spinner /> : null}
            {paidBack
              ? "Refund received"
              : action === "cancel"
                ? "Cancel and get refund"
                : auto
                  ? `Not arrived? Claim ${price} yourself`
                  : `Claim ${price} refund`}
          </button>
        ) : null}
        <p className={`${showButton ? "mt-3 " : ""}text-[13px] leading-relaxed text-[#5A5463]`}>
          {paidBack
            ? "Nothing left to do for this purchase."
            : canCancel
              ? "Still not covered 10 minutes after paying, so you can cancel it on Arc. One approval in Circle's window."
              : claimable && auto && !stuck
                ? "No action needed: it arrives in your balance on its own, usually within a minute."
                : !claimable
                  ? auto
                    ? "Nothing to do: if you're owed money, it is sent to you automatically."
                    : "The button turns on when the escrow shows this purchase as refundable."
                  : !isBuyer
                    ? "Only the wallet that paid can claim."
                    : auto
                      ? "The automatic payout hasn't arrived after a few minutes. One approval in Circle's window moves it to your balance."
                      : "One approval in Circle's window moves it back to your balance."}
        </p>
        {tx.status !== "idle" ? (
          <TransactionStatus state={done ?? tx} explorerTx={chain().explorerTx} className="mt-4" />
        ) : null}
      </section>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
