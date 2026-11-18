"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ApiError, pauseText, type CheckoutStatusDto, type PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import {
  chance,
  clock,
  conditionFinePrint,
  conditionText,
  countdown,
  dateTime,
  usd,
} from "@/lib/format";
import { store, useNowSeconds, usePoll } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet/session";
import { AddUsdc } from "../account";
import { LoginCard } from "../login-card";
import { Progress, type ProgressStep } from "../progress";
import { Button, Notice, Spinner } from "../ui";
import { Voucher, type StampTone } from "../voucher";
import { Receipt } from "./receipt";

/** Purchases made in this browser, per wallet (until the API can list a customer's purchases). */
export const myPurchasesKey = (wallet: string) => `hedged:purchases:${wallet.toLowerCase()}`;
export interface MyPurchase {
  purchaseKey: string;
  promotionId: string;
  at: number;
}

export function rememberPurchase(wallet: string, p: MyPurchase) {
  const all = store.get<MyPurchase[]>(myPurchasesKey(wallet)) ?? [];
  store.set(myPurchasesKey(wallet), [...all.filter((x) => x.purchaseKey !== p.purchaseKey), p]);
}

export function CheckoutView({
  promoId,
  initialPurchase,
}: {
  promoId: string;
  initialPurchase: string | null;
}) {
  const [purchase, setPurchase] = useState<string | null>(initialPurchase);
  const [stamp, setStamp] = useState<{ text: string; tone: StampTone } | null>(null);
  const promo = usePoll(() => api.promotion(promoId), 10_000, [promoId]);
  const now = useNowSeconds();

  function opened(key: string) {
    setPurchase(key);
    const url = new URL(window.location.href);
    url.searchParams.set("p", key);
    window.history.replaceState(null, "", url.toString());
  }
  function newPurchase() {
    setPurchase(null);
    setStamp(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("p");
    window.history.replaceState(null, "", url.toString());
  }

  const p = promo.data?.promotion;
  if (!p) {
    if (promo.error) {
      const pr = describe(promo.error);
      return (
        <div className="mx-auto max-w-xl py-10">
          <Notice
            tone="error"
            title={pr.title}
            action={
              <Button size="sm" variant="secondary" onClick={promo.refresh}>
                Retry
              </Button>
            }
          >
            {pr.detail}
          </Notice>
        </div>
      );
    }
    return (
      <p className="flex items-center justify-center gap-2 py-24 text-ink-soft">
        <Spinner /> Loading the promo…
      </p>
    );
  }

  const condition = conditionText(p.outcomeLabel, p.geminiMarketId);
  const fine = conditionFinePrint(p.geminiMarketId);

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-x-14">
      <div className="min-w-0">
        <Voucher
          seed={p.promoPda ?? p.id}
          shopName={p.shop.name}
          itemName={p.itemName}
          amount={p.offerAmount}
          condition={condition}
          closesLabel={`Sales close ${p.depositDeadline - (now ?? 0) > 86_400 ? dateTime(p.depositDeadline) : clock(p.depositDeadline)}`}
          serial={p.promoPda}
          marketId={p.geminiMarketId}
          stamp={purchase ? stamp : null}
        />
      </div>

      <div className="min-w-0 space-y-4">
        {promo.error ? (
          <Notice tone="warn" title={describe(promo.error).title}>
            {describe(promo.error).detail}
          </Notice>
        ) : null}
        {purchase ? (
          <>
            <Receipt purchaseKey={purchase} promo={p} onStamp={setStamp} />
            {p.live?.canBuy ? (
              <Button variant="secondary" size="sm" onClick={newPurchase}>
                Buy another
              </Button>
            ) : null}
          </>
        ) : (
          <PayPanel promo={p} condition={condition} fine={fine} now={now} onPurchased={opened} />
        )}
      </div>
    </div>
  );
}

/* ---------- paying (docs/email-wallets.md, Checkout) ---------- */

type PayStep = "approve" | "pay" | "confirm";

function PayPanel({
  promo,
  condition,
  fine,
  now,
  onPurchased,
}: {
  promo: PromotionDto;
  condition: string;
  fine: string | null;
  now: number | null;
  onPurchased: (purchaseKey: string) => void;
}) {
  const w = useWallet();
  const ready = w.phase === "ready" && w.wallet;
  const walletId = w.wallet?.id ?? null;
  // 1. What the button should do for this wallet and promo (also re-checked right before paying).
  const status = usePoll(
    ready && walletId ? () => api.checkoutStatus(promo.id, walletId) : null,
    8_000,
    [promo.id, walletId],
  );
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Partial<Record<PayStep, ProgressStep["state"]>>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  useEffect(() => {
    if (status.error instanceof ApiError) setProblem(describe(status.error));
  }, [status.error]);

  const live = promo.live;
  const closed = now !== null && now >= promo.depositDeadline;
  const s: CheckoutStatusDto | undefined = status.data;

  const blocker: Problem | null =
    promo.status === "DRAFT"
      ? {
          title: "Not published yet",
          detail: "The shop hasn't published this promo, so it can't take payments.",
        }
      : closed || live?.phase === "WAITING_FOR_RESULT"
        ? {
            title: "Sales closed",
            detail: "This promo stopped selling. The result decides the purchases already made.",
          }
        : live?.phase === "RESULT_YES" || live?.phase === "RESULT_NO"
          ? { title: "Promo finished", detail: "This promo already has its official result." }
          : (s && !s.canBuy) || (live && !live.canBuy)
            ? {
                title: "Paused right now",
                detail: `This promo isn't selling because ${pauseText(s?.pauseReason ?? live?.pauseReason)}. Nothing has been charged.`,
              }
            : null;
  const short = s ? !s.enoughBalance : false;

  async function pay() {
    if (!walletId) return;
    setBusy(true);
    setProblem(null);
    const set = (k: PayStep, v: ProgressStep["state"]) => setSteps((x) => ({ ...x, [k]: v }));
    let step: PayStep = "approve";
    try {
      // Re-check right before asking for any approval: a paused promo takes no money.
      let st = await api.checkoutStatus(promo.id, walletId);
      if (!st.canBuy) throw new ApiError(409, "promo_not_buyable", { pauseReason: st.pauseReason });
      if (!st.enoughBalance) throw new ApiError(409, "insufficient_usdc", {});
      // 2. First purchase only: allow the escrow to take payments (up to $100).
      if (st.needsApproval) {
        setSteps({ approve: "doing" });
        try {
          const ch = await api.checkoutApprove(promo.id, walletId);
          await w.execute(
            ch.challengeId,
            "Allow this escrow to take your payments (up to $100, first time only)",
          );
        } catch (err) {
          if (!(err instanceof ApiError && err.code === "already_approved")) throw err;
        }
        const end = Date.now() + 60_000;
        while (st.needsApproval && Date.now() < end) {
          await new Promise((r) => setTimeout(r, 2000));
          st = await api.checkoutStatus(promo.id, walletId);
        }
        if (st.needsApproval) throw new ApiError(409, "approval_needed", {});
        set("approve", "done");
      } else {
        setSteps({ approve: "skipped" });
      }
      // 3. The payment itself.
      step = "pay";
      set("pay", "doing");
      const dep = await api.checkoutDeposit(promo.id, walletId);
      await w.execute(
        dep.challengeId,
        `Pay ${usd(promo.offerAmount)} to ${promo.shop.name} for a ${promo.itemName.toLowerCase()}`,
      );
      set("pay", "done");
      rememberPurchase(w.wallet!.address, {
        purchaseKey: dep.purchaseKey,
        promotionId: promo.id,
        at: Date.now(),
      });
      void w.refreshWallet();
      onPurchased(dep.purchaseKey);
    } catch (err) {
      set(step, "error");
      setProblem(describe(err));
      status.refresh();
    } finally {
      setBusy(false);
    }
  }

  const progress: ProgressStep[] = [
    {
      key: "approve",
      label: "One-time approval",
      state: steps.approve ?? "todo",
      detail: steps.approve === "skipped" ? "Already done on an earlier purchase." : null,
    },
    { key: "pay", label: `Pay ${usd(promo.offerAmount)}`, state: steps.pay ?? "todo" },
  ];

  return (
    <section className="rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-wide text-[22px] leading-tight font-bold">
          {promo.itemName}
          <span className="block text-[15px] font-semibold text-ink-soft">{promo.shop.name}</span>
        </h2>
        {live?.liveAskMicroUsd ? (
          <p className="text-right" title="From Gemini's live market price">
            <span className="font-display block text-[40px] leading-none text-note">
              {chance(live.liveAskMicroUsd)}
            </span>
            <span className="text-[12.5px] font-semibold text-ink-soft">chance it happens</span>
          </p>
        ) : null}
      </div>

      <dl className="mt-5 space-y-2.5 border-t border-ink/10 pt-4 text-[15px]">
        <Row k="You pay now" v={usd(promo.offerAmount)} />
        <Row
          title={fine ?? undefined}
          k={`If ${condition}`}
          v={<span className="font-semibold text-note">{usd(promo.offerAmount)} back to you</span>}
        />
        <Row k="If not" v={<span className="text-ink-soft">The shop keeps it</span>} />
        <Row
          k="Sales close"
          v={
            now !== null && promo.depositDeadline > now
              ? `${clock(promo.depositDeadline)} (in ${countdown(promo.depositDeadline - now)})`
              : clock(promo.depositDeadline)
          }
        />
      </dl>

      <div className="mt-5 space-y-3">
        {blocker ? (
          <Notice tone="warn" title={blocker.title}>
            {blocker.detail}
          </Notice>
        ) : null}

        {!ready ? (
          <div className="rounded-xl bg-paper p-4">
            <LoginCard title="Pay with your email" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg bg-paper px-3.5 py-2.5 text-[14px]">
              <span className="text-ink-soft">Your balance</span>
              {s ? (
                <strong className="font-wide text-[17px]">{usd(s.usdcBalance)}</strong>
              ) : status.loading ? (
                <Spinner />
              ) : (
                <span>{usd(w.wallet!.usdcBalance)}</span>
              )}
            </div>
            {short && !blocker ? (
              <Notice tone="warn" title="Add dollars to pay">
                <div className="mt-1">
                  <AddUsdc compact onAdded={status.refresh} />
                </div>
              </Notice>
            ) : null}
            <Button
              size="lg"
              className="w-full"
              onClick={pay}
              busy={busy}
              disabled={Boolean(blocker || short || !s)}
              title={
                s?.needsApproval
                  ? "First payment: approve once to allow payments, then approve the $5."
                  : undefined
              }
            >
              Pay {usd(promo.offerAmount)}
            </Button>
            {busy || steps.pay ? <Progress steps={progress} /> : null}
          </>
        )}

        {problem ? (
          <Notice tone="error" title={problem.title}>
            {problem.detail}
          </Notice>
        ) : null}
      </div>
    </section>
  );
}

function Row({ k, v, title }: { k: ReactNode; v: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4" title={title}>
      <dt className="text-ink-soft">{k}</dt>
      <dd className="text-right font-semibold">{v}</dd>
    </div>
  );
}
