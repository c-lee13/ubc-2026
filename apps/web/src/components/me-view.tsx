"use client";

import Link from "next/link";
import type { PurchaseReceiptDto } from "@/lib/api";
import { api } from "@/lib/client";
import { orderNumber, usd } from "@/lib/format";
import { store, usePoll } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet/session";
import { AddUsdc } from "./account";
import { myPurchasesKey, type MyPurchase } from "./checkout/checkout-view";
import { LoginCard } from "./login-card";
import { Spinner } from "./ui";

/**
 * Customer: balance in dollars (refunds land here) and the promos bought from this browser.
 * The API has no "purchases of this customer" route yet, so the list is this device's receipts.
 */
export function MeView() {
  const w = useWallet();
  const ready = w.phase === "ready" && w.wallet;
  const mine = ready ? (store.get<MyPurchase[]>(myPurchasesKey(w.wallet!.address)) ?? []) : [];
  const keys = mine.map((m) => m.purchaseKey).join(",");
  const receipts = usePoll<(PurchaseReceiptDto | null)[]>(
    ready && mine.length
      ? () => Promise.all(mine.map((m) => api.purchase(m.purchaseKey).catch(() => null)))
      : null,
    6_000,
    [keys],
  );

  if (!ready) {
    return (
      <div className="max-w-xl rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10">
        <LoginCard title="Log in with the email you paid with" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-[360px_minmax(0,1fr)]">
      <section className="space-y-3 self-start rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10">
        <p className="text-[14px] text-ink-soft">Your balance</p>
        <p className="font-display text-[52px] leading-none">{usd(w.wallet!.usdcBalance)}</p>
        <AddUsdc onAdded={() => void w.refreshWallet()} />
      </section>

      <section aria-labelledby="mine" className="space-y-3">
        <h2 id="mine" className="font-wide text-[20px] font-bold">
          Your orders
        </h2>
        {mine.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink/25 px-5 py-8 text-center text-ink-soft">
            No orders yet.{" "}
            <Link href="/discover" className="font-semibold text-ink underline">
              Find a promo
            </Link>
            .
          </div>
        ) : (
          <ul className="space-y-2">
            {[...mine].reverse().map((m) => {
              const r = receipts.data?.[mine.indexOf(m)] ?? null;
              return (
                <li key={m.purchaseKey}>
                  <Link
                    href={`/checkout/${m.promotionId}?p=${m.purchaseKey}`}
                    className="flex items-center gap-4 rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-ink/10 hover:ring-ink/40"
                  >
                    <span className="font-display text-[22px]">{orderNumber(m.purchaseKey)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        {r ? `${r.promotion.itemName} at ${r.promotion.shopName}` : "Purchase"}
                      </span>
                      <span className="block text-[13px] text-ink-soft">
                        {r ? r.message : receipts.loading ? "Loading…" : "Waiting for the server…"}
                      </span>
                    </span>
                    {r ? (
                      <span className="shrink-0 font-semibold">{usd(r.amount)}</span>
                    ) : (
                      <Spinner />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
