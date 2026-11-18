"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  pauseText,
  type CheckoutStatusDto,
  type LiveStateDto,
  type PromotionDto,
} from "@/lib/api";
import { api, chain } from "@/lib/client";
import { publicConfig } from "@/lib/config";
import { describe, type Problem } from "@/lib/errors";
import {
  cents,
  chance,
  clock,
  conditionFinePrint,
  conditionText,
  countdown,
  dateTime,
  shortAddr,
  usd,
} from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { rememberPurchase } from "@/lib/purchases";
import { useWallet } from "@/lib/wallet/session";
import { AddUsdc } from "../account";
import {
  BRAND_HAIRLINE,
  BTN_BLOCK,
  DISPLAY,
  EYEBROW,
  EYEBROW_RULE,
  PANEL,
  PILL_GREEN,
  PILL_GREY,
  PILL_ORANGE,
  PILL_PURPLE,
  TICKET,
} from "../layout/styles";
import { LoginCard } from "../login-card";
import { TransactionStatus, type TransactionState } from "../ui/TransactionStatus";
import { Button, Notice, Spinner } from "../ui";
import { NetworkNote } from "../wallet/NetworkNote";

// Customer checkout, Zahin's layout: the offer ticket (left) and the checkout panel (right).
// Data: GET /api/promotions/:id (polled). Paying follows docs/email-wallets.md: status ->
// (first time) approve challenge -> deposit challenge, each approved by the customer in Circle's
// window; then the receipt at /purchases/<purchaseKey>.

const DETAIL_LABELS = [
  "Item",
  "Shop",
  "Purchase price (test USDC)",
  "Refund condition",
  "Sales close",
  "Market",
];

function OutcomeIcon({ kind }: { kind: "yes" | "no" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="mt-0.5 h-5 w-5 shrink-0" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.6" />
      {kind === "yes" ? (
        <path
          d="M6 10.4l2.7 2.7L14 7.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M7 7l6 6M13 7l-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** The offer's state as one pill, from the promo's live phase. */
function phasePill(promo: PromotionDto, closed: boolean): { text: string; cls: string } {
  if (promo.status === "DRAFT") return { text: "Not published", cls: PILL_GREY };
  switch (promo.live?.phase) {
    case "LIVE":
      return closed
        ? { text: "Sales closed", cls: PILL_GREY }
        : { text: "Selling now", cls: PILL_PURPLE };
    case "PAUSED":
      return { text: "Paused", cls: PILL_ORANGE };
    case "WAITING_FOR_RESULT":
      return { text: "Sales closed", cls: PILL_GREY };
    case "RESULT_YES":
      return { text: "It happened", cls: PILL_GREEN };
    case "RESULT_NO":
      return { text: "Didn't happen", cls: PILL_GREY };
    default:
      return { text: "Status unknown", cls: PILL_GREY };
  }
}

function Intro({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: ReactNode }) {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-8 sm:px-8 lg:pb-10 lg:pt-8">
      <div className="max-w-3xl">
        <p className={EYEBROW}>
          <span aria-hidden className={EYEBROW_RULE} />
          {eyebrow}
        </p>
        <h1
          className={`${DISPLAY} mt-6 text-[clamp(2.5rem,5vw,4.2rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
        >
          {title}
        </h1>
        <p className="mt-6 max-w-[36rem] text-lg leading-relaxed text-[#5A5463]">{lead}</p>
      </div>
    </section>
  );
}

export function CheckoutScreen({ promoId }: { promoId: string }) {
  const promo = usePoll(() => api.promotion(promoId), 10_000, [promoId]);
  const now = useNowSeconds();
  const p = promo.data?.promotion;

  if (!p) {
    if (!promo.error) {
      return (
        <>
          <Intro eyebrow="Your offer" title="A purchase with a possibility." lead="Loading…" />
          <p className="flex items-center justify-center gap-2 pb-24 pt-8 text-[#5A5463]">
            <Spinner /> Loading the offer…
          </p>
        </>
      );
    }
    return <Unavailable promoId={promoId} error={promo.error} onRetry={promo.refresh} />;
  }

  const price = usd(p.offerAmount);
  const condition = conditionText(p.outcomeLabel, p.geminiMarketId);
  const fine = conditionFinePrint(p.geminiMarketId);
  const closed = now !== null && now >= p.depositDeadline;
  const left = now === null ? null : p.depositDeadline - now;
  const pill = phasePill(p, closed);
  const ask = p.live?.liveAskMicroUsd ?? null;

  return (
    <>
      <Intro
        eyebrow="Your offer"
        title="A purchase with a possibility."
        lead="Shop as usual. If the selected event goes your way, your purchase is refunded."
      />

      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-24">
        {/* The offer: the primary content */}
        <section aria-labelledby="details-heading" className="lg:col-span-7">
          {promo.error ? (
            <div className="mb-5">
              <Notice tone="warn" title={describe(promo.error).title}>
                Showing the last data received. {describe(promo.error).detail}
              </Notice>
            </div>
          ) : null}

          <article aria-label="Offer" className={TICKET}>
            <div aria-hidden className={`h-[3px] ${BRAND_HAIRLINE}`} />
            <div className="p-6 sm:p-8">
              <span
                aria-hidden
                className="absolute right-6 top-9 h-3.5 w-3.5 rounded-full border-2 border-[#CFC8BC] sm:right-8"
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-8">
                <span className={pill.cls}>{pill.text}</span>
                <span className="text-xs font-semibold text-[#5A5463]">
                  {chain().networkLabel} · test USDC
                </span>
              </div>

              <div className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
                <div className="min-w-0 max-w-md">
                  <h2
                    id="details-heading"
                    className={`${DISPLAY} break-words text-[clamp(2rem,3.6vw,2.9rem)] font-semibold leading-[1.02] tracking-[-0.035em]`}
                  >
                    {p.itemName}
                  </h2>
                  <p className="mt-2 text-sm text-[#5A5463]">
                    {p.shop.name}
                    {p.shop.location ? `, ${p.shop.location}` : ""}
                  </p>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#4E4858]">
                    Pay {price} for a {p.itemName.toLowerCase()}. If {condition}, you get your{" "}
                    {price} back.
                  </p>
                </div>
                <div className="shrink-0 sm:text-right">
                  <p
                    className={`${DISPLAY} text-[3rem] font-semibold leading-none tracking-[-0.045em] tabular-nums`}
                  >
                    {price}
                  </p>
                  <p className="mt-1.5 text-xs text-[#5A5463]">test USDC</p>
                </div>
              </div>

              <div aria-hidden className="my-7 border-t border-dashed border-[#CFC8BC]" />

              <p className="text-xs font-medium text-[#5A5463]">Refund condition</p>
              <p
                className={`${DISPLAY} mt-1 text-[1.5rem] font-semibold leading-snug tracking-[-0.02em]`}
              >
                If {condition}, you are refunded.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
                {fine ??
                  "The shop's own words, decided by the Gemini market's official final result."}
              </p>

              <dl className="mt-5 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
                <div className="flex gap-3 py-3.5 text-[#3F2A66]">
                  <OutcomeIcon kind="yes" />
                  <div className="min-w-0 flex-1 gap-x-6 sm:flex sm:justify-between">
                    <dt className="font-semibold">If the outcome happens</dt>
                    <dd className="mt-0.5 text-[#211D28] sm:mt-0 sm:text-right">
                      You claim your {price} back.
                    </dd>
                  </div>
                </div>
                <div className="flex gap-3 py-3.5 text-[#6B3A08]">
                  <OutcomeIcon kind="no" />
                  <div className="min-w-0 flex-1 gap-x-6 sm:flex sm:justify-between">
                    <dt className="font-semibold">If it doesn&apos;t</dt>
                    <dd className="mt-0.5 text-[#211D28] sm:mt-0 sm:text-right">
                      The merchant claims the escrowed {price}.
                    </dd>
                  </div>
                </div>
              </dl>

              <dl className="mt-6 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[#5A5463]">Sales close</dt>
                  <dd className="mt-1 font-medium">
                    {left !== null && left > 86_400
                      ? dateTime(p.depositDeadline)
                      : clock(p.depositDeadline)}
                    {left !== null && left > 0 && left <= 86_400 ? (
                      <span className="text-[#5A5463]"> (in {countdown(left)})</span>
                    ) : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#5A5463]">Chance it&apos;s free</dt>
                  <dd className="mt-1 font-medium" title="From Gemini's live YES price">
                    {ask ? `${chance(ask)} (YES at ${cents(ask)} on Gemini)` : "No live price"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-[#5A5463]">Market</dt>
                  <dd className="mt-1 break-all font-mono text-[13px] font-medium">
                    {p.geminiMarketId}
                  </dd>
                </div>
              </dl>
            </div>
          </article>

          <div className="mt-6 border-l-[3px] border-[#F58C38] pl-4 text-sm leading-relaxed text-[#4E4858]">
            <p className="font-semibold text-[#211D28]">About this offer</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              <li>You pay test USDC on {chain().networkLabel}. It has no real value.</li>
              <li>
                The shop&apos;s hedge is simulated from Gemini&apos;s live prices. No Gemini order
                is placed.
              </li>
              <li>Only the market&apos;s official final result decides the refund.</li>
            </ul>
          </div>

          <p className="mt-6 break-all text-xs leading-relaxed text-[#5A5463]">
            Promotion <span className="font-mono">{p.id}</span>
            {p.promoPda ? (
              <>
                {" "}
                · on Arc as <span className="font-mono">{shortAddr(p.promoPda, 6)}</span>
              </>
            ) : null}
          </p>
        </section>

        {/* Checkout: the narrower supporting column */}
        <aside aria-labelledby="checkout-heading" className="lg:col-span-5">
          <CheckoutPanel promo={p} condition={condition} now={now} />
        </aside>
      </div>
    </>
  );
}

/* ---------- not found / offline: Zahin's "Unavailable" layout ---------- */

function Unavailable({
  promoId,
  error,
  onRetry,
}: {
  promoId: string;
  error: unknown;
  onRetry: () => void;
}) {
  const notFound = error instanceof ApiError && error.code === "promotion_not_found";
  const problem = describe(error);
  return (
    <>
      <Intro
        eyebrow="Offer unavailable"
        title="We can’t show this offer yet."
        lead={
          notFound
            ? "There is no promotion at this link, so no details are available and nothing can be purchased."
            : `${problem.detail} Nothing can be purchased until it loads.`
        }
      />
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-24">
        <section aria-labelledby="details-heading" className="lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="details-heading"
              className={`${DISPLAY} text-[1.9rem] font-semibold leading-tight tracking-[-0.03em]`}
            >
              Promotion details
            </h2>
            <span className={PILL_GREY}>{notFound ? "Not found" : problem.title}</span>
          </div>
          <dl className="mt-6 divide-y divide-[#E6E1D8] border-y-2 border-t-[#211D28] border-b-[#E6E1D8]">
            {DETAIL_LABELS.map((label) => (
              <div
                key={label}
                className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <dt className="shrink-0 text-sm font-medium text-[#5A5463]">{label}</dt>
                <dd className="min-w-0 text-sm font-medium text-[#4E4858] sm:text-right">
                  Unavailable
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 break-all text-xs leading-relaxed text-[#5A5463]">
            Reference from link (unverified): <span className="font-mono">{promoId}</span>
          </p>
        </section>
        <aside aria-labelledby="checkout-heading" className="lg:col-span-5">
          <div className={PANEL}>
            <h2
              id="checkout-heading"
              className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
            >
              Checkout
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#5A5463]">
              There is no purchase summary for this link.
            </p>
            {notFound ? null : (
              <div className="mt-5">
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

/* ---------- the checkout panel: summary, email login, pay ---------- */

function blockerFor(
  promo: PromotionDto,
  live: LiveStateDto | null,
  s: CheckoutStatusDto | undefined,
  closed: boolean,
): { over: boolean; title: string; detail: string } | null {
  if (promo.status === "DRAFT") {
    return { over: true, title: "Not published yet", detail: "The shop hasn't published it." };
  }
  if (closed || live?.phase === "WAITING_FOR_RESULT") {
    return {
      over: true,
      title: "Sales closed",
      detail: `Sales closed at ${clock(promo.depositDeadline)}. If you bought one, your receipt is in My purchases.`,
    };
  }
  if (live?.phase === "RESULT_YES" || live?.phase === "RESULT_NO") {
    return {
      over: true,
      title: "Promo finished",
      detail: "The official result is in. If you bought one, your receipt is in My purchases.",
    };
  }
  if ((s && !s.canBuy) || (live && !live.canBuy)) {
    return {
      over: false,
      title: "Paused right now",
      detail: `This promo isn't selling because ${pauseText(s?.pauseReason ?? live?.pauseReason)}. Nothing has been charged.`,
    };
  }
  return null;
}

function CheckoutPanel({
  promo,
  condition,
  now,
}: {
  promo: PromotionDto;
  condition: string;
  now: number | null;
}) {
  const w = useWallet();
  const router = useRouter();
  const ready = w.phase === "ready" && Boolean(w.wallet);
  const walletId = w.wallet?.id ?? null;
  // What the button should do for this wallet and promo (re-checked right before paying).
  const status = usePoll(
    ready && walletId ? () => api.checkoutStatus(promo.id, walletId) : null,
    8_000,
    [promo.id, walletId],
  );
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<TransactionState>({ status: "idle" });
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    if (status.error instanceof ApiError) setProblem(describe(status.error));
  }, [status.error]);

  const price = usd(promo.offerAmount);
  const closed = now !== null && now >= promo.depositDeadline;
  const s = status.data;
  const blocker = blockerFor(promo, promo.live, s, closed);
  const short = s ? !s.enoughBalance : false;

  async function pay() {
    if (!walletId || !w.wallet) return;
    setBusy(true);
    setProblem(null);
    setTx({ status: "idle" });
    try {
      // Re-check right before asking for any approval: a paused promo takes no money.
      let st = await api.checkoutStatus(promo.id, walletId);
      if (!st.canBuy) throw new ApiError(409, "promo_not_buyable", { pauseReason: st.pauseReason });
      if (!st.enoughBalance) throw new ApiError(409, "insufficient_usdc", {});
      // First purchase only: allow the escrow to take payments (up to $100).
      if (st.needsApproval) {
        const what = "One-time approval: let the escrow take your payments (up to $100)";
        setTx({ status: "awaiting_signature", what });
        try {
          const ch = await api.checkoutApprove(promo.id, walletId);
          await w.execute(ch.challengeId, what);
        } catch (err) {
          if (!(err instanceof ApiError && err.code === "already_approved")) throw err;
        }
        setTx({ status: "confirming" });
        const end = Date.now() + 60_000;
        while (st.needsApproval && Date.now() < end) {
          await new Promise((r) => setTimeout(r, 2000));
          st = await api.checkoutStatus(promo.id, walletId);
        }
        if (st.needsApproval) throw new ApiError(409, "approval_needed", {});
      }
      // The payment itself.
      const what = `Pay ${price} to ${promo.shop.name} for a ${promo.itemName.toLowerCase()}`;
      setTx({ status: "awaiting_signature", what });
      const dep = await api.checkoutDeposit(promo.id, walletId);
      await w.execute(dep.challengeId, what);
      rememberPurchase(w.wallet.address, {
        purchaseKey: dep.purchaseKey,
        promotionId: promo.id,
        at: Date.now(),
      });
      void w.refreshWallet();
      // Wait briefly for the promo server to record it, then open the live receipt (which keeps
      // polling if Arc or the server is slower than this).
      setTx({ status: "confirming" });
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        try {
          const r = await api.purchase(dep.purchaseKey);
          // Fixture hashes are made up, so they are never shown as Arc transactions.
          const hash = publicConfig.walletFixture ? null : r.transactions.deposit;
          setTx({ status: "confirmed", txHash: hash ?? undefined });
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      router.push(`/purchases/${dep.purchaseKey}`);
    } catch (err) {
      const pr = describe(err);
      setTx({ status: "failed", message: `${pr.title}. ${pr.detail}` });
      status.refresh();
    } finally {
      setBusy(false);
    }
  }

  const disabled = Boolean(blocker || short || !s || !ready || busy);
  return (
    <div className={PANEL}>
      <h2
        id="checkout-heading"
        className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
      >
        Checkout
      </h2>

      <dl className="mt-5 text-sm">
        <div className="flex items-baseline justify-between gap-4 border-t border-[#E6E1D8] py-2.5">
          <dt className="shrink-0 whitespace-nowrap text-[#5A5463]">Item</dt>
          <dd className="text-right font-medium">{promo.itemName}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-[#E6E1D8] py-2.5">
          <dt className="shrink-0 whitespace-nowrap text-[#5A5463]">Merchant</dt>
          <dd className="text-right font-medium">{promo.shop.name}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-[#E6E1D8] py-2.5">
          <dt className="shrink-0 whitespace-nowrap text-[#5A5463]">Refundable if</dt>
          <dd className="text-right font-medium">{condition}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t-2 border-[#211D28] pt-3.5">
          <dt className="shrink-0 whitespace-nowrap font-semibold">Total (test USDC)</dt>
          <dd className={`${DISPLAY} text-2xl font-semibold tracking-[-0.03em] tabular-nums`}>
            {price}
          </dd>
        </div>
      </dl>

      {/* Email login (Circle wallet) */}
      <section aria-labelledby="wallet-heading" className="mt-7 border-t border-[#E6E1D8] pt-6">
        <h3 id="wallet-heading" className="text-sm font-semibold">
          {ready ? "Your email wallet" : "Log in with your email"}
        </h3>
        {ready ? (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
            <p className="min-w-0 truncate text-[#5A5463]">{w.email}</p>
            <p>
              Balance{" "}
              <strong className="font-semibold text-[#211D28]">
                {usd(s?.usdcBalance ?? w.wallet!.usdcBalance)}
              </strong>{" "}
              <button
                type="button"
                onClick={() => w.logout()}
                className="ml-2 font-semibold text-[#6133A7] underline underline-offset-4"
              >
                Log out
              </button>
            </p>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#5A5463]">
              You pay with test USDC from an email wallet. Circle makes it for you on{" "}
              {chain().networkLabel}: no app, no seed phrase. Logging in does not start a payment.
            </p>
            <div className="mt-4">
              <LoginCard compact cta="Continue with email" />
            </div>
          </>
        )}
        <NetworkNote />
      </section>

      {/* Pay */}
      <section aria-labelledby="status-heading" className="mt-7 border-t border-[#E6E1D8] pt-6">
        {ready && short && !blocker ? (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-[#5A5463]">
              Your balance {usd(s!.usdcBalance)} is less than {price}. Add free test dollars first.
            </p>
            <AddUsdc primary onAdded={status.refresh} />
          </div>
        ) : (
          <button
            type="button"
            onClick={pay}
            disabled={disabled}
            className={BTN_BLOCK}
            title={
              s?.needsApproval
                ? "First payment: approve once to allow payments, then approve the payment."
                : undefined
            }
          >
            {busy ? <Spinner /> : null}
            Pay {price} with test USDC
          </button>
        )}

        <h3
          id="status-heading"
          className={`${DISPLAY} mt-4 text-lg font-semibold tracking-[-0.015em]`}
        >
          {blocker
            ? blocker.title
            : !ready
              ? "Log in to pay"
              : !s
                ? "Checking your wallet…"
                : short
                  ? "Not enough test USDC"
                  : "Ready to pay"}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[#5A5463]">
          {blocker
            ? blocker.detail
            : !ready
              ? "Log in above. Nothing is charged until you approve the payment in Circle's window."
              : s?.needsApproval
                ? "Your first purchase asks for two approvals in Circle's window: one to let the escrow take payments (up to $100), then the payment itself."
                : "You approve the payment in Circle's window. Then your live receipt opens."}
        </p>

        {tx.status !== "idle" ? (
          <TransactionStatus state={tx} explorerTx={chain().explorerTx} className="mt-4" />
        ) : null}

        {problem && tx.status !== "failed" ? (
          <div className="mt-4">
            <Notice tone="error" title={problem.title}>
              {problem.detail}
            </Notice>
          </div>
        ) : null}
      </section>
    </div>
  );
}
