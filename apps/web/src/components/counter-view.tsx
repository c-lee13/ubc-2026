"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PurchaseSummaryDto } from "@/lib/api";
import { api } from "@/lib/client";
import { servedCodes, setServed } from "@/lib/coupons";
import { describe } from "@/lib/errors";
import { clock } from "@/lib/format";
import { useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import { condition, oddsPct, price, shortCountdown } from "@/lib/promo-view";
import { IconBack, IconCheck } from "./icons";
import { Note, Spinner } from "./kit";
import { CouponsLeft, type Promo } from "./promo-card";
import { QrCode } from "./qr";

/**
 * The counter screen (Dylan's prototype layout): the promo's QR code for customers to scan, and the
 * live order feed with the 4-character order code that is also on the customer's receipt. Hand the
 * item over only when the server's canServe is true; tap Served when it's out. "Served" marks are
 * CLIENT-SIDE (this device), there is no API field for them. Feed: GET
 * /api/promotions/:id/purchases (newest first), polled every 3 s.
 */
export function CounterView({ promoId }: { promoId: string }) {
  const origin = useOrigin();
  const now = useNowSeconds();
  const promo = usePoll(() => api.promotion(promoId), 10_000, [promoId]);
  const p = promo.data?.promotion as Promo | undefined;
  const orders = usePoll(p ? () => api.promotionPurchases(p.id) : null, 3_000, [p?.id]);
  const [served, setServedState] = useState<Record<string, number>>({});
  useEffect(() => setServedState(servedCodes(promoId)), [promoId]);

  if (!p) {
    return promo.error ? (
      <div className="mx-auto max-w-[480px] px-4 pt-10">
        <Note tone="error" title={describe(promo.error).title}>
          {describe(promo.error).detail}
        </Note>
      </div>
    ) : (
      <div className="grid min-h-dvh place-items-center text-ink-soft">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const link = `${origin}/checkout/${p.id}`;
  const cond = condition(p);
  const selling = p.live?.phase === "LIVE";
  const rows = orders.data?.purchases ?? [];
  const toggle = (key: string, on: boolean) => {
    setServed(p.id, key, on);
    setServedState(servedCodes(p.id));
  };
  const isServed = (r: PurchaseSummaryDto) => Boolean(served[r.purchasePda.toLowerCase()]);
  const waiting = rows.filter((r) => !isServed(r));
  const done = rows.filter(isServed);

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pb-16 lg:grid lg:max-w-[1100px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-0 lg:self-start">
        <header className="flex h-[60px] items-center justify-between">
          <Link
            href="/merchant"
            aria-label="Back to workspace"
            className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink"
          >
            <IconBack size={22} />
          </Link>
          <p className="text-[14px] font-semibold text-ink-soft">Counter</p>
          <span className="w-10" />
        </header>
        <section className="rounded-[28px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
          <p className="font-display text-[26px] leading-tight">
            {p.itemName} {price(p.offerAmount)}, free if {cond}
          </p>
          <p className="mt-1 text-[15px] text-ink-soft">{p.shop.name}</p>
          <div className="relative mx-auto mt-5 max-w-[240px] overflow-hidden rounded-[20px] bg-white p-3 lg:max-w-none lg:p-4">
            {origin ? (
              <div className={selling ? "" : "opacity-15"}>
                <QrCode value={link} label={`QR code: ${link}`} className="w-full" />
              </div>
            ) : (
              <div className="aspect-square" />
            )}
            {!selling ? (
              <div className="absolute inset-0 grid place-items-center">
                <span className="font-display rounded-xl bg-black px-4 py-2 text-[24px] text-white">
                  {p.live?.phase === "PAUSED"
                    ? p.live.pauseReason === "BUDGET_USED"
                      ? "Sold out"
                      : "Paused"
                    : "Sales closed"}
                </span>
              </div>
            ) : null}
          </div>
          {selling ? (
            <>
              <p className="font-title mt-4 text-center text-[20px]">Scan to buy</p>
              <div className="mt-4 grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="font-num text-[44px] text-note lg:text-[56px]">
                    {Math.round(oddsPct(p.live?.liveAskMicroUsd) ?? 0)}%
                  </p>
                  <p className="mt-1 text-[14px] text-ink-soft">chance it&apos;s free</p>
                </div>
                <div>
                  <p className="font-num text-[44px] lg:text-[56px]">
                    {now !== null ? shortCountdown(p.depositDeadline - now) : "–"}
                  </p>
                  <p className="mt-1 text-[14px] text-ink-soft">left to buy</p>
                </div>
              </div>
              <div className="mt-4 flex justify-center">
                <CouponsLeft p={p} sold={rows.filter((r) => r.canServe).length} />
              </div>
            </>
          ) : null}
        </section>
      </div>

      <section aria-labelledby="orders" className="mt-8 min-w-0 lg:mt-[60px]">
        <div className="flex items-baseline justify-between gap-3">
          <h1 id="orders" className="font-display text-[36px]">
            Orders
          </h1>
          <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-note">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-note" aria-hidden />
            Live
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {orders.data === undefined ? (
            orders.error ? (
              <Note tone="error" title={describe(orders.error).title}>
                {describe(orders.error).detail}
              </Note>
            ) : (
              <p className="flex items-center gap-2 text-ink-soft">
                <Spinner /> Loading orders
              </p>
            )
          ) : waiting.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-line-strong px-6 py-10 text-center text-ink-soft">
              {rows.length
                ? "All caught up."
                : "No orders yet. They pop up here the second someone pays."}
            </div>
          ) : (
            waiting.map((r) => (
              <OrderRow
                key={r.purchasePda}
                r={r}
                item={p.itemName}
                onServed={() => toggle(r.purchasePda, true)}
              />
            ))
          )}
        </div>
        {done.length > 0 ? (
          <div className="mt-8">
            <p className="font-title mb-2 text-[17px] text-ink-soft">Served ({done.length})</p>
            <ul className="divide-y divide-rule overflow-hidden rounded-[20px] bg-paper-raised ring-1 ring-inset ring-rule">
              {done.map((r) => (
                <li key={r.purchasePda} className="flex items-center gap-3 px-4 py-3">
                  <IconCheck size={18} className="text-note" />
                  <span className="font-num text-[22px]">#{r.orderCode}</span>
                  <span className="text-[14px] text-ink-soft">{clock(r.depositedAt)}</span>
                  <button
                    type="button"
                    onClick={() => toggle(r.purchasePda, false)}
                    className="ml-auto text-[14px] font-semibold text-ink-soft hover:text-ink"
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function OrderRow({
  r,
  item,
  onServed,
}: {
  r: PurchaseSummaryDto;
  item: string;
  onServed: () => void;
}) {
  const refund = r.step === "REFUNDING" || r.step === "REFUND_READY" || r.step === "REFUNDED";
  if (r.canServe) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-[24px] bg-ribbon px-5 py-4 text-white">
        <div className="min-w-0">
          <p className="font-display text-[54px] leading-none">#{r.orderCode}</p>
          <p className="mt-1.5 text-[15px] text-white/85">
            {item}, paid {clock(r.depositedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onServed}
          className="h-14 shrink-0 rounded-[18px] bg-white px-5 text-[17px] font-bold text-black transition-transform active:scale-[0.97]"
        >
          Served
        </button>
      </div>
    );
  }
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-[24px] px-5 py-4 ring-1 ring-inset ${refund ? "bg-stamp-soft ring-stamp/30" : "bg-paper-raised ring-rule"}`}
    >
      <p
        className={`font-display text-[44px] leading-none ${refund ? "text-stamp" : "text-ink-soft"}`}
      >
        #{r.orderCode}
      </p>
      <p className="text-right text-[15px] font-semibold">
        {refund ? (
          <span className="text-stamp">Don&apos;t serve: paying back</span>
        ) : (
          <span className="inline-flex items-center gap-2 text-ink-soft">
            <Spinner /> Confirming
          </span>
        )}
      </p>
    </div>
  );
}
