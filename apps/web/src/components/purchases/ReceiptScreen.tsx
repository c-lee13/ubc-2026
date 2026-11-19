"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, type PurchaseReceiptDto } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { publicConfig } from "@/lib/config";
import { describe, type Problem } from "@/lib/errors";
import { conditionText, displayCode, usd } from "@/lib/format";
import { store, useNowSeconds, usePoll, useSeenFor } from "@/lib/hooks";
import { happened, whenText } from "@/lib/promo-view";
import {
  CANCEL_AFTER_SECS,
  PURCHASE_KEY,
  STUCK_AFTER_SECS,
  myPurchasesKey,
  receiptStages,
  refundClaimable,
  type MyPurchase,
  type StageState,
} from "@/lib/purchases";
import { useWallet } from "@/lib/wallet/session";
import { IconCheck, IconClose } from "../icons";
import { Button, Mark, Note, Spinner } from "../kit";

// The live receipt (Dylan's prototype receipt: ribbon header with the order code, a timeline with
// pink checks), upside-only words. Polls GET /api/purchases/:key (docs/FRONTEND-API.md "Receipt").
// A stage is done only from the on-chain escrow state. Money back follows `autoPayout`: true
// (escrow v2) = sent automatically, a claim button only if a payout sits for a few minutes;
// false (escrow v1) = the claim button by `step`.

const REFUND_STEPS = new Set(["REFUNDING", "REFUND_READY", "REFUNDED"]);

export function ReceiptScreen({
  purchaseKey,
  fresh = false,
}: {
  purchaseKey: string;
  fresh?: boolean;
}) {
  const valid = PURCHASE_KEY.test(purchaseKey);
  const receipt = usePoll(valid ? () => api.purchase(purchaseKey) : null, 3_000, [purchaseKey]);
  const r = receipt.data ?? null;
  const waiting =
    valid &&
    (receipt.loading ||
      (receipt.error instanceof ApiError && receipt.error.code === "purchase_not_found"));

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-4 pb-12">
      <header className="flex h-[60px] items-center justify-between">
        <Link
          href="/me"
          aria-label="Close"
          className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          <IconClose size={22} />
        </Link>
        <Mark className="h-6" />
        <span className="w-10" />
      </header>
      {r ? (
        <Receipt
          r={r}
          purchaseKey={purchaseKey}
          fresh={fresh}
          stale={receipt.error}
          onClaimed={receipt.refresh}
        />
      ) : waiting ? (
        <div className="mt-6 rounded-[28px] bg-paper-raised px-6 py-14 text-center ring-1 ring-inset ring-rule">
          <Spinner className="mx-auto h-7 w-7 text-note" />
          <p className="font-title mt-5 text-[22px]">Confirming your payment</p>
          <p className="mt-1 text-[15px] text-ink-soft">This takes a few seconds.</p>
        </div>
      ) : (
        <div className="mt-6">
          <Note
            tone="error"
            title={valid ? describe(receipt.error).title : "This isn't a receipt link"}
          >
            {valid ? describe(receipt.error).detail : "Open the receipt from My promos."}
          </Note>
        </div>
      )}
    </main>
  );
}

function Receipt({
  r,
  purchaseKey,
  fresh,
  stale,
  onClaimed,
}: {
  r: PurchaseReceiptDto;
  purchaseKey: string;
  fresh: boolean;
  stale: unknown;
  onClaimed: () => void;
}) {
  const now = useNowSeconds();
  const promo = usePoll(() => api.promotion(r.promotion.id), 30_000, [r.promotion.id]);
  const deadline = promo.data?.promotion.depositDeadline ?? null;
  const cost = usd(r.amount);
  const item = r.promotion.itemName;
  const cond = conditionText(r.promotion.outcomeLabel, r.promotion.geminiMarketId);
  const stages = receiptStages(r);
  const refunding = REFUND_STEPS.has(r.step);
  const outcome = r.promotion.resolvedOutcome;
  const won = outcome === "YES" && !refunding;
  const lost = outcome === "NO" && !refunding;
  const processing = r.step === "PROCESSING";
  const code = displayCode(r.orderCode, purchaseKey);

  const head = won
    ? { title: "It's free.", sub: `${happened(cond)}.`, ribbon: true }
    : refunding
      ? {
          title: r.step === "REFUNDED" ? "Refunded" : "Money on its way back",
          sub: `This one didn't go through, so your ${cost} comes back. Nothing to do.`,
          ribbon: false,
        }
      : lost
        ? {
            title: "Thanks for coming in",
            sub: `Hope you enjoyed the ${item.toLowerCase()}.`,
            ribbon: false,
          }
        : processing
          ? { title: "Confirming payment", sub: "This takes a few seconds.", ribbon: true }
          : { title: "You're in.", sub: `If ${cond}, it's free.`, ribbon: true };

  const steps: { key: string; state: StageState; title: string; body: string }[] = [
    {
      key: "paid",
      state: stages.paid,
      title: `Paid ${cost}`,
      body: "From your balance",
    },
    {
      key: "covered",
      state: stages.covered,
      title: refunding ? "Didn't go through" : "Ready at the counter",
      body: refunding
        ? `Your ${cost} is being sent back`
        : stages.covered === "done"
          ? "Show your code, grab your order"
          : "Confirming payment",
    },
    {
      key: "result",
      state: stages.result,
      title: outcome ? (won ? happened(cond) : "Game over") : "The game",
      body: outcome
        ? won
          ? "Official result is in"
          : "Official result is in"
        : deadline && now !== null && deadline > now
          ? `Kickoff ${whenText(deadline, now)}`
          : "Waiting for the official result",
    },
    {
      key: "money",
      state: refunding ? stages.money : won ? stages.money : lost ? "skipped" : "todo",
      title: refunding
        ? r.step === "REFUNDED"
          ? `${cost} refunded`
          : `${cost} on its way`
        : won
          ? "Free"
          : `Free if ${cond}`,
      body: won
        ? r.onChainState === "ClaimedByCustomer"
          ? `${cost} is back in your balance`
          : `${cost} on its way to your balance`
        : refunding
          ? "Straight back to your balance"
          : lost
            ? "Better luck next game"
            : `${cost} back after the game`,
    },
  ];

  return (
    <div className={fresh ? "animate-sheet-up" : undefined}>
      {stale ? (
        <div className="mb-3">
          <Note tone="warn" title="Showing the last update">
            {describe(stale).detail}
          </Note>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[28px] bg-paper-raised ring-1 ring-inset ring-rule">
        <div
          className={`@container relative overflow-hidden px-6 pb-6 pt-6 ${head.ribbon ? `bg-ribbon text-white ${fresh ? "sweep" : ""}` : "bg-surface-3"}`}
        >
          <p className="font-display text-[34px]">{head.title}</p>
          <p className={`mt-2 text-[16px] ${head.ribbon ? "text-white/85" : "text-ink-soft"}`}>
            {head.sub}
          </p>
        </div>

        {won ? (
          <div className="border-b border-rule px-6 py-7 text-center">
            <p className="font-num text-ribbon inline-block pb-1 text-[80px]">+{cost}</p>
            <p className="mt-1 text-[15px] text-ink-soft">
              back in your balance, for your {item.toLowerCase()} at {r.promotion.shopName}
            </p>
            <p className="mt-3 text-[13.5px] text-ink-faint">Order {code}</p>
          </div>
        ) : (
          <div className="border-b border-rule px-6 py-6 text-center">
            <p className="text-[13.5px] font-medium text-ink-soft">
              {processing
                ? "Your order code, almost ready"
                : refunding
                  ? "Your order code"
                  : "Show this at the counter"}
            </p>
            <p
              className={`font-display mt-2 text-[64px] leading-none ${processing || refunding ? "text-ink-faint" : ""}`}
            >
              {code}
            </p>
            <p className="mt-2 text-[15px] text-ink-soft">
              {item}, {r.promotion.shopName}
            </p>
          </div>
        )}

        <ol className="px-6 py-5">
          {steps
            .filter((s) => !(refunding && s.key === "result"))
            .map((s, i, shown) => (
              <li key={s.key} className="relative flex gap-4 pb-5 last:pb-0">
                {i < shown.length - 1 ? (
                  <span
                    aria-hidden
                    className={`absolute left-[15px] top-8 h-[calc(100%-28px)] w-0.5 ${s.state === "done" ? "bg-note/60" : "bg-rule"}`}
                  />
                ) : null}
                <Dot state={s.state} n={i + 1} />
                <div className="min-w-0 pt-1">
                  <p
                    className={`font-semibold ${s.state === "todo" || s.state === "skipped" ? "text-ink-faint" : "text-ink"}`}
                  >
                    {s.title}
                  </p>
                  <p className="text-[14px] text-ink-soft">{s.body}</p>
                </div>
              </li>
            ))}
        </ol>

        <ClaimPanel r={r} purchaseKey={purchaseKey} cost={cost} onClaimed={onClaimed} />
      </section>

      {r.transactions.deposit && !publicConfig.walletFixture ? (
        <p className="mt-4 text-center text-[13px] text-ink-faint">
          <a
            href={chain().explorerTx(r.transactions.deposit)}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-ink-soft"
          >
            Payment record on Arc
          </a>
        </p>
      ) : null}

      <Link
        href="/"
        className="mt-5 flex h-[58px] w-full items-center justify-center rounded-[18px] bg-surface-2 text-[17px] font-semibold text-ink ring-1 ring-inset ring-line-strong"
      >
        More promos
      </Link>
    </div>
  );
}

function Dot({ state, n }: { state: StageState; n: number }) {
  if (state === "done")
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-note text-black">
        <IconCheck size={16} />
      </span>
    );
  if (state === "doing")
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-note-soft ring-1 ring-note/50">
        <Spinner className="h-4 w-4 text-note" />
      </span>
    );
  if (state === "failed")
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-ink-soft">
        <IconClose size={15} />
      </span>
    );
  return (
    <span className="font-title grid h-8 w-8 shrink-0 place-items-center rounded-full text-[14px] text-ink-faint ring-1 ring-inset ring-rule">
      {n}
    </span>
  );
}

/**
 * Getting money back by hand: only on escrow v1, when an automatic payout (v2) has sat for a few
 * minutes, or when a payment is still not locked in 10 minutes after paying (cancel on Arc).
 */
function ClaimPanel({
  r,
  purchaseKey,
  cost,
  onClaimed,
}: {
  r: PurchaseReceiptDto;
  purchaseKey: string;
  cost: string;
  onClaimed: () => void;
}) {
  const w = useWallet();
  const now = useNowSeconds();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const ready = w.phase === "ready" && Boolean(w.wallet);
  const isBuyer = Boolean(
    ready && w.wallet && w.wallet.address.toLowerCase() === r.customer.toLowerCase(),
  );
  const auto = r.autoPayout;
  const claimable = refundClaimable(r);

  const seenFor = useSeenFor(claimable ? [`${purchaseKey}:${r.step}`] : []);
  const stuck = claimable && auto && seenFor(`${purchaseKey}:${r.step}`) >= STUCK_AFTER_SECS;
  const offerClaim = claimable && (!auto || stuck);

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

  if (!offerClaim && !canCancel) return null;

  async function run(kind: "claim" | "cancel") {
    if (!w.wallet) return;
    setBusy(true);
    setProblem(null);
    const what =
      kind === "claim"
        ? `Move your ${cost} back to your balance`
        : `Cancel this payment and get your ${cost} back`;
    try {
      const ch =
        kind === "claim"
          ? await api.claimRefund(purchaseKey, w.wallet.id)
          : await api.cancelExpired(purchaseKey, w.wallet.id);
      await w.execute(ch.challengeId, what);
      onClaimed();
      void w.refreshWallet();
    } catch (err) {
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-rule px-6 py-5">
      <p className="text-[14.5px] text-ink-soft">
        {canCancel
          ? "This payment never locked in. Cancel it and your money comes straight back."
          : auto
            ? "Your money is taking longer than usual. You can move it back now."
            : "Your money is ready. Move it back to your balance."}
      </p>
      {isBuyer ? (
        <Button size="lg" busy={busy} onClick={() => run(canCancel ? "cancel" : "claim")}>
          {canCancel ? `Cancel and get ${cost} back` : `Get my ${cost} back`}
        </Button>
      ) : (
        <p className="text-[14px] text-ink-faint">Sign in with the email that paid to do this.</p>
      )}
      {problem ? (
        <Note tone="error" title={problem.title}>
          {problem.detail}
        </Note>
      ) : null}
    </div>
  );
}
