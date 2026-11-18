"use client";

import { ApiError, pauseText, type PurchaseReceiptDto } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { describe } from "@/lib/errors";
import { chance, clock, conditionText, countdown, orderNumber, usd } from "@/lib/format";
import { useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import { QrCode } from "./qr";
import { Notice, Spinner } from "./ui";
import { Seal } from "./voucher";

/**
 * The barista's screen: the promo's QR code for customers to scan, and the live order feed. An
 * order says "Paid & hedged: serve" only when the server's canServe is true (the payment is in the
 * escrow and the hedge is confirmed); a failed hedge says don't serve.
 */
export function CounterView({ promoId }: { promoId: string }) {
  const origin = useOrigin();
  const now = useNowSeconds();
  const promo = usePoll(() => api.promotion(promoId), 10_000, [promoId]);
  const p = promo.data?.promotion;
  const orders = usePoll<{ rows: PurchaseReceiptDto[]; source: string } | null>(
    p
      ? async () => {
          try {
            return { rows: (await api.promotionPurchases(p.id)).purchases, source: "api" };
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) throw err;
          }
          const reads = chain().reads;
          if (!reads || !p.promoPda) return null;
          const keys = await reads.purchasesOf(p.promoPda);
          const rows = await Promise.all(
            keys.map((k) => api.purchase(k.purchasePda).catch(() => null)),
          );
          return { rows: rows.filter((r): r is PurchaseReceiptDto => r !== null), source: "chain" };
        }
      : null,
    3_000,
    [p?.id],
  );

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
  const rows = [...(orders.data?.rows ?? [])].reverse();

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-12">
      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10">
          <div className="flex items-center gap-3">
            <Seal
              seed={p.promoPda ?? p.id}
              size={52}
              label={usd(p.offerAmount).replace(/\.00$/, "")}
            />
            <div className="min-w-0">
              <p className="truncate text-[14px] text-ink-soft">{p.shop.name}</p>
              <p className="font-wide text-[19px] font-bold leading-tight">
                {p.itemName} {usd(p.offerAmount).replace(/\.00$/, "")}, free if {cond}
              </p>
            </div>
          </div>
          <div className="mx-auto mt-5 w-full max-w-[280px] overflow-hidden rounded-xl ring-1 ring-ink/15">
            {origin ? (
              <QrCode value={link} label={`QR code: ${link}`} className="w-full" />
            ) : (
              <div className="aspect-square" />
            )}
          </div>
          <p className="mt-3 text-center text-[17px] font-bold">Scan to pay with your email</p>
        </div>
        <div className="rounded-2xl bg-paper-raised px-5 py-4 ring-1 ring-ink/10">
          {live?.phase === "LIVE" ? (
            <p className="text-[15px]">
              <strong className="text-note">Selling.</strong> Chance it happens{" "}
              {chance(live.liveAskMicroUsd)}. Sales close {clock(p.depositDeadline)}
              {now !== null && p.depositDeadline > now
                ? ` (in ${countdown(p.depositDeadline - now)})`
                : ""}
              .
            </p>
          ) : live?.phase === "PAUSED" ? (
            <p className="text-[15px]">
              <strong className="text-sim">Paused</strong>: {pauseText(live.pauseReason)}.
            </p>
          ) : (
            <p className="text-[15px]">
              <strong>Sales closed.</strong>{" "}
              {live?.phase === "RESULT_YES"
                ? "It happened: customers get their money back."
                : live?.phase === "RESULT_NO"
                  ? "It didn't happen: the shop keeps the sales."
                  : "Waiting for the official result."}
            </p>
          )}
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
          {orders.data === null ? (
            <Notice tone="warn" title="No order feed on this server yet">
              Needs GET /api/promotions/:id/purchases.
            </Notice>
          ) : orders.data === undefined ? (
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

function OrderRow({ r, item }: { r: PurchaseReceiptDto; item: string }) {
  const refund = r.step === "REFUNDING" || r.step === "REFUND_READY" || r.step === "REFUNDED";
  const tone = r.canServe
    ? "bg-note text-paper-raised"
    : refund
      ? "bg-stamp-soft text-stamp ring-1 ring-stamp/30"
      : "bg-paper-raised text-ink ring-1 ring-ink/15";
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-5 py-4 ${tone}`}>
      <span className="font-display text-[34px] leading-none">{orderNumber(r.purchasePda)}</span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[24px] leading-tight">
          {r.canServe ? "Paid & hedged: serve" : refund ? "Don't serve: refunding" : "Paid: wait"}
        </p>
        <p className="text-[13.5px] opacity-85">
          {r.canServe
            ? `${item}, ${usd(r.amount)}`
            : refund
              ? `No ${item.toLowerCase()}. Payment going back.`
              : "Covering it now…"}
        </p>
      </div>
      {r.hedge && r.hedge.premium && r.canServe ? (
        <span className="text-[13px] opacity-90">
          Cover {usd(r.hedge.premium)} <span className="opacity-80">(simulated hedge)</span>
        </span>
      ) : null}
    </div>
  );
}
