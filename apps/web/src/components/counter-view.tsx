"use client";

import { pauseText, type PurchaseSummaryDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { chance, conditionText, countdown, orderNumber, usd } from "@/lib/format";
import { useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import { QrCode } from "./qr";
import { Notice, Spinner } from "./ui";

/**
 * The barista's screen: the promo's QR code for customers to scan, and the live order feed. An
 * order says "Paid & hedged: serve" only when the server's canServe is true (the payment is in the
 * escrow and the hedge is confirmed); a failed hedge says don't serve. The feed is
 * GET /api/promotions/:id/purchases (newest first), polled every 3 s; its 4-character `orderCode`
 * is the one on the customer's receipt.
 */
export function CounterView({ promoId }: { promoId: string }) {
  const origin = useOrigin();
  const now = useNowSeconds();
  const promo = usePoll(() => api.promotion(promoId), 10_000, [promoId]);
  const p = promo.data?.promotion;
  const orders = usePoll(p ? () => api.promotionPurchases(p.id) : null, 3_000, [p?.id]);

  if (!p) {
    return promo.error ? (
      <Notice tone="error" title={describe(promo.error).title}>
        {describe(promo.error).detail}
      </Notice>
    ) : (
      <p className="flex items-center justify-center gap-2 py-24 text-ink-soft">
        <Spinner /> Loading the promo…
      </p>
    );
  }

  const link = `${origin}/checkout/${p.id}`;
  const cond = conditionText(p.outcomeLabel, p.geminiMarketId);
  const live = p.live;
  const selling = live?.phase === "LIVE";
  const rows = orders.data?.purchases ?? [];

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10">
          <p className="font-wide text-[22px] leading-tight font-bold">
            {p.itemName} {usd(p.offerAmount).replace(/\.00$/, "")}, free if {cond}
          </p>
          <p className="mt-1 text-[15px] text-ink-soft">{p.shop.name}</p>
          <div className="relative mx-auto mt-5 w-full overflow-hidden rounded-xl ring-1 ring-ink/15">
            {origin ? (
              <div className={selling ? "" : "opacity-25"}>
                <QrCode value={link} label={`QR code: ${link}`} className="w-full" />
              </div>
            ) : (
              <div className="aspect-square" />
            )}
            {!selling ? (
              <div className="absolute inset-0 grid place-items-center">
                <span
                  className={`font-display -rotate-12 rounded-lg border-4 bg-paper-raised/70 px-4 py-2 text-[34px] tracking-[0.04em] ${live?.phase === "PAUSED" ? "border-sim text-sim" : "border-stamp text-stamp"}`}
                  title={live?.phase === "PAUSED" ? pauseText(live.pauseReason) : undefined}
                >
                  {live?.phase === "PAUSED" ? "PAUSED" : "SALES CLOSED"}
                </span>
              </div>
            ) : null}
          </div>
          {selling ? (
            <>
              <p className="mt-4 text-center text-[22px] font-bold">Scan to pay with your email</p>
              {now !== null ? (
                <div className="mt-4 grid grid-cols-2 gap-4 text-center">
                  <p>
                    <span className="font-display block text-[48px] leading-none sm:text-[64px] text-note">
                      {chance(live?.liveAskMicroUsd)}
                    </span>
                    <span className="text-[15px] font-semibold text-ink-soft">
                      chance it&apos;s free
                    </span>
                  </p>
                  <p>
                    <span className="font-display block text-[48px] leading-none sm:text-[64px]">
                      {countdown(p.depositDeadline - now)}
                    </span>
                    <span className="text-[15px] font-semibold text-ink-soft">left to buy</span>
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>

      <section aria-labelledby="orders" className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <h1 id="orders" className="font-display text-[34px] md:text-[44px]">
            Orders
          </h1>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-note">
            <span className="animate-pulse-dot h-2 w-2 rounded-full bg-note" aria-hidden />
            Live
          </span>
        </div>

        <div className="mt-5 space-y-3">
          {orders.data === undefined ? (
            orders.error ? (
              <Notice tone="error" title={describe(orders.error).title}>
                {describe(orders.error).detail}
              </Notice>
            ) : (
              <p className="flex items-center gap-2 text-ink-soft">
                <Spinner /> Loading orders…
              </p>
            )
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink/25 px-6 py-12 text-center text-ink-soft">
              No orders yet.
            </div>
          ) : (
            rows.map((r) => <OrderRow key={r.purchasePda} r={r} item={p.itemName} />)
          )}
        </div>
      </section>
    </div>
  );
}

function OrderRow({ r, item }: { r: PurchaseSummaryDto; item: string }) {
  const refund = r.step === "REFUNDING" || r.step === "REFUND_READY" || r.step === "REFUNDED";
  const tone = r.canServe
    ? "bg-ribbon text-white"
    : refund
      ? "bg-stamp-soft text-stamp ring-1 ring-stamp/30"
      : "bg-paper-raised text-ink ring-1 ring-ink/15";
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-2xl px-6 py-5 ${tone}`}
    >
      <span className="font-display text-[64px] leading-none">
        {r.orderCode ? `#${r.orderCode}` : orderNumber(r.purchasePda)}
      </span>
      <span className="text-right">
        <span className="font-display block text-[40px] leading-none">
          {r.canServe ? "Serve" : refund ? "Don't serve" : "Wait"}
        </span>
        <span className="text-[15px] opacity-85">
          {r.canServe ? "Paid & hedged" : refund ? "Payment going back" : "Covering it now…"}
          {r.canServe ? `, ${item.toLowerCase()}` : ""}
        </span>
      </span>
    </div>
  );
}
