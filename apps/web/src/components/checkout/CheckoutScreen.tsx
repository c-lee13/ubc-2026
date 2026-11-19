"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, isSoldOut, type CheckoutStatusDto, type PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { publicConfig } from "@/lib/config";
import { describe, type Problem } from "@/lib/errors";
import { clock, usd } from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { withArticle } from "@/lib/items";
import {
  condition,
  happened,
  oddsPct,
  price,
  sellState,
  minSec,
  shortCountdown,
} from "@/lib/promo-view";
import { rememberPurchase } from "@/lib/purchases";
import { WalletUserError } from "@/lib/wallet/driver";
import { useWallet } from "@/lib/wallet/session";
import { AddMoneySheet } from "../add-money";
import { HowItWorksButton } from "../how-it-works";
import { IconCheck, IconClose, IconWallet } from "../icons";
import { Button, FitText, Note, Spinner, Wordmark } from "../kit";
import { LoginCard } from "../login-card";
import { CouponsLeft, closesText, type Promo } from "../promo-card";
import { Voucher } from "../voucher";

// Customer checkout, one clean screen: the promo as Dylan's price tag, the odds and the clock, then
// pay. Data: GET /api/promotions/:id (polled). Paying follows docs/FRONTEND-API.md "Checkout":
//   status -> checkout "one-tap" (escrow v2): POST /sign -> Circle signature -> POST /submit
//             (our relayer sends it on Arc and pays the gas), or
//             checkout "approve-deposit" (escrow v1 fallback): /approve (first time) -> /deposit,
// each approved in Circle's window; then the live receipt at /purchases/<purchaseKey>.

type PayStep = "idle" | "approve" | "paying" | "confirming" | "done";

export function CheckoutScreen({ promoId }: { promoId: string }) {
  const promo = usePoll(() => api.promotion(promoId), 10_000, [promoId]);
  const now = useNowSeconds();
  const p = promo.data?.promotion as Promo | undefined;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-4 pb-10">
      <header className="flex h-[60px] items-center justify-between">
        <Link
          href="/"
          aria-label="Close"
          className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          <IconClose size={22} />
        </Link>
        <Wordmark size={16} />
        {p ? (
          <HowItWorksButton
            item={p.itemName.toLowerCase()}
            price={price(p.offerAmount)}
            cond={condition(p)}
            className="-mr-1 h-10 w-10 justify-center"
          />
        ) : (
          <span className="w-10" />
        )}
      </header>

      {!p ? (
        promo.error ? (
          <div className="pt-10">
            <Note
              tone="error"
              title={
                promo.error instanceof ApiError && promo.error.code === "promotion_not_found"
                  ? "This promo doesn't exist"
                  : describe(promo.error).title
              }
              action={
                <Link href="/" className="font-semibold text-ink underline underline-offset-4">
                  See all promos
                </Link>
              }
            >
              {promo.error instanceof ApiError && promo.error.code === "promotion_not_found"
                ? "The link may be old. Nothing was charged."
                : describe(promo.error).detail}
            </Note>
          </div>
        ) : (
          <div className="grid place-items-center pt-32 text-ink-soft">
            <Spinner className="h-6 w-6" />
          </div>
        )
      ) : (
        <Offer p={p} now={now} />
      )}
    </main>
  );
}

function Offer({ p, now }: { p: Promo; now: number | null }) {
  const cond = condition(p);
  const st = sellState(p, now);
  const left = now === null ? null : p.depositDeadline - now;
  const closes = closesText(p.depositDeadline, now);
  const odds = oddsPct(p.live?.liveAskMicroUsd);
  const day = new Date(p.depositDeadline * 1000).toLocaleDateString("en-US", { weekday: "short" });

  return (
    <div className="animate-sheet-up">
      <p className="mb-3 text-center text-[12.5px] text-ink-soft">
        <span className="font-semibold text-ink">{p.shop.name}</span>
        {p.shop.location ? ` on ${p.shop.location.split(",")[0]}` : ""}
      </p>
      <Voucher
        seed={p.promoPda ?? p.id}
        shopName={p.shop.name}
        itemName={p.itemName}
        amount={p.offerAmount}
        condition={cond}
        headline={st.kind === "won" ? `${happened(cond)}. It was free.` : `Free if ${cond}.`}
        terms="Served now"
        closesLabel={closes}
        marketId={p.geminiMarketId}
        plain
        compact
        stamp={
          st.kind === "won"
            ? { text: "FREE", tone: "note" }
            : st.kind === "soldout"
              ? { text: "SOLD OUT", tone: "stamp" }
              : null
        }
      />

      <section className="mt-3 rounded-[28px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
        {st.kind === "selling" || st.kind === "paused" || st.kind === "soldout" ? (
          <div className="mb-5 grid grid-cols-2 gap-4">
            <div className="min-w-0">
              {odds !== null ? (
                <>
                  <FitText max={48} className="font-num text-note">
                    {Math.round(odds)}%
                  </FitText>
                  <span className="mt-1 block text-[11px] font-medium text-ink-soft">
                    chance it&apos;s free
                  </span>
                </>
              ) : null}
            </div>
            {st.kind === "selling" && left !== null && left > 0 ? (
              <div className="min-w-0 text-right">
                <FitText max={48} className="font-num">
                  {left > 12 * 3600 ? day : left < 3600 ? minSec(left) : shortCountdown(left)}
                </FitText>
                <span className="mt-1 block text-[11px] font-medium text-ink-soft">
                  {left > 12 * 3600 ? `kickoff ${clock(p.depositDeadline)}` : "left to buy"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
        {st.kind === "selling" ? <CouponsLeft p={p} className="mb-5" /> : null}
        <div className="border-t border-rule pt-5 first:border-t-0 first:pt-0">
          <PayPanel promo={p} cond={cond} now={now} />
        </div>
      </section>
    </div>
  );
}

/* ---------- pay: sign in, balance, one-tap ---------- */

function blockerFor(
  promo: PromotionDto,
  s: CheckoutStatusDto | undefined,
  now: number | null,
  _cond: string,
): { title: string; detail: string } | null {
  const st = sellState(promo, now);
  switch (st.kind) {
    case "draft":
      return { title: "Not live yet", detail: "The shop hasn't started this promo." };
    case "closed":
      return {
        title: "Sales closed",
        detail: "This one is locked in for the game. Find another promo.",
      };
    case "won":
      return { title: "Promo over", detail: "Everyone who bought one got it free." };
    case "done":
      return { title: "Promo over", detail: "Find another one on the Coupons tab." };
    case "soldout":
      return { title: "Sold out", detail: "Every coupon is taken." };
    case "paused":
      return {
        title: "Back in a moment",
        detail: "Sales are paused for a moment. Nothing was charged.",
      };
  }
  if (s && !s.canBuy) {
    return isSoldOut(s.pauseReason)
      ? { title: "Sold out", detail: "Every coupon is taken." }
      : {
          title: "Back in a moment",
          detail: "Sales are paused for a moment. Nothing was charged.",
        };
  }
  return null;
}

function PayPanel({ promo, cond, now }: { promo: Promo; cond: string; now: number | null }) {
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
  const [step, setStep] = useState<PayStep>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [topUp, setTopUp] = useState(false);

  useEffect(() => {
    if (status.error instanceof ApiError) setProblem(describe(status.error));
  }, [status.error]);

  const cost = usd(promo.offerAmount);
  const s = status.data;
  const blocker = blockerFor(promo, s, now, cond);
  const balance = BigInt(s?.usdcBalance ?? w.wallet?.usdcBalance ?? "0");
  const short = s ? !s.enoughBalance : false;
  const busy = step !== "idle" && step !== "done";

  async function pay() {
    if (!walletId || !w.wallet) return;
    const address = w.wallet.address;
    setProblem(null);
    setStep("approve");
    try {
      // Re-check right before asking for any approval: a paused promo takes no money.
      const st = await api.checkoutStatus(promo.id, walletId);
      if (!st.canBuy) throw new ApiError(409, "promo_not_buyable", { pauseReason: st.pauseReason });
      if (!st.enoughBalance) throw new ApiError(409, "insufficient_usdc", {});
      const what = `Pay ${cost} to ${promo.shop.name} for ${withArticle(promo.itemName)}`;
      const paid =
        st.checkout === "one-tap"
          ? await payOneTap(walletId, what)
          : await payApproveDeposit(walletId, what, st.needsApproval);
      rememberPurchase(address, {
        purchaseKey: paid.purchaseKey,
        promotionId: promo.id,
        at: Date.now(),
      });
      void w.refreshWallet();
      // Wait briefly for the promo server to record it, then open the live receipt (which keeps
      // polling if Arc or the server is slower than this).
      setStep("confirming");
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        try {
          await api.purchase(paid.purchaseKey);
          break;
        } catch {
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      setStep("done");
      router.push(`/purchases/${paid.purchaseKey}?new=1`);
    } catch (err) {
      setProblem(describe(err));
      setStep("idle");
      status.refresh();
    }
  }

  /**
   * Escrow v2: ONE approval. The customer signs a payment authorization for exactly this price
   * (valid 5 minutes, only for this promo, customer and purchase); our relayer sends it on Arc and
   * pays the gas. Submit returns once the payment has landed.
   */
  async function payOneTap(walletId: string, what: string) {
    const sig = await api.checkoutSign(promo.id, walletId);
    const { signature } = await w.execute(sig.challengeId, what);
    if (!signature) {
      throw new WalletUserError(
        "Payment not approved",
        "The approval finished without a signature, so nothing was charged. Pay again.",
      );
    }
    setStep("paying");
    const body = {
      walletId,
      purchaseIdHex: sig.purchaseIdHex,
      validBefore: sig.validBefore,
      signature,
    };
    // 503 relayer_unavailable: retry with the same body (the signature is reusable until it lands).
    for (let attempt = 0; ; attempt++) {
      try {
        const sub = await api.checkoutSubmit(promo.id, sig.submit, body);
        return {
          purchaseKey: sub.purchaseKey,
          txHash: publicConfig.walletFixture ? null : sub.txHash,
        };
      } catch (err) {
        const retry = err instanceof ApiError && err.code === "relayer_unavailable" && attempt < 3;
        if (!retry || Date.now() / 1000 >= sig.validBefore - 5) throw err;
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }

  /** Escrow v1 fallback: approve once (first purchase, up to $100), then the deposit itself. */
  async function payApproveDeposit(walletId: string, what: string, needsApproval: boolean) {
    if (needsApproval) {
      const approval = "Allow one-tap payments (up to $100)";
      try {
        const ch = await api.checkoutApprove(promo.id, walletId);
        await w.execute(ch.challengeId, approval);
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "already_approved")) throw err;
      }
      setStep("confirming");
      let pending = true;
      const end = Date.now() + 60_000;
      while (pending && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 2000));
        pending = (await api.checkoutStatus(promo.id, walletId)).needsApproval;
      }
      if (pending) throw new ApiError(409, "approval_needed", {});
      setStep("approve");
    }
    const dep = await api.checkoutDeposit(promo.id, walletId);
    await w.execute(dep.challengeId, what);
    setStep("paying");
    return { purchaseKey: dep.purchaseKey, txHash: null };
  }

  if (blocker) {
    return (
      <div>
        <p className="font-title text-[18px]">{blocker.title}</p>
        <p className="mt-1 text-[13.5px] text-ink-soft">{blocker.detail}</p>
        <Link
          href="/"
          className="mt-4 flex h-[58px] w-full items-center justify-center rounded-[18px] bg-surface-3 text-[15px] font-semibold text-ink"
        >
          See other promos
        </Link>
      </div>
    );
  }

  if (!ready) {
    return (
      <div>
        <p className="font-title mb-3 text-[17px]">Sign in to pay</p>
        <LoginCard cta="Continue with email" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconWallet size={20} className="text-ink-soft" />
          <span className="text-[13.5px] text-ink-soft">Balance</span>
          <span className="font-num text-[19.5px]">{s ? usd(balance) : <Spinner />}</span>
        </div>
        {short ? null : (
          <button
            type="button"
            onClick={() => setTopUp(true)}
            className="text-[13.5px] font-semibold text-chain hover:text-ink"
          >
            Add money
          </button>
        )}
      </div>

      {short && !busy ? (
        <Button size="lg" onClick={() => setTopUp(true)}>
          Add money
        </Button>
      ) : (
        <Button size="lg" onClick={pay} disabled={!s || busy} className="relative overflow-hidden">
          {busy ? (
            <>
              <Spinner />
              {step === "approve"
                ? "Approve the payment"
                : step === "paying"
                  ? "Paying"
                  : "Almost done"}
            </>
          ) : step === "done" ? (
            <>
              <IconCheck /> Paid
            </>
          ) : (
            `Pay ${price(promo.offerAmount)} for ${withArticle(promo.itemName)}`
          )}
        </Button>
      )}

      <p className="text-center text-[12px] text-ink-soft">
        {short
          ? `You need ${usd(BigInt(promo.offerAmount) - balance)} more.`
          : "Money back right after the game."}
      </p>

      {problem ? (
        <Note tone="error" title={problem.title}>
          {problem.detail}
        </Note>
      ) : null}

      <AddMoneySheet
        open={topUp}
        onClose={() => setTopUp(false)}
        onAdded={status.refresh}
        need={short ? BigInt(promo.offerAmount) - balance : undefined}
      />
    </div>
  );
}
