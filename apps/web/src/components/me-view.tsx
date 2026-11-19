"use client";

import Link from "next/link";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { orderNumber, usd } from "@/lib/format";
import { store, usePoll } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet/session";
import { AddUsdc } from "./account";
import { myPurchasesKey, type MyPurchase } from "@/lib/purchases";
import { LoginCard } from "./login-card";
import { Spinner } from "./ui";

/**
 * Customer: balance in dollars (refunds land here) and their purchases, newest first, from the
 * server (GET /api/purchases?customer=<wallet>). Payments made in this browser that the server
 * hasn't seen yet are listed too, as "waiting".
 */
export function MeView() {
  const w = useWallet();
  const ready = w.phase === "ready" && w.wallet;
  const address = ready ? w.wallet!.address : null;
  const list = usePoll(address ? () => api.customerPurchases(address) : null, 6_000, [address]);
  const server = list.data?.purchases ?? [];
  const known = new Set(server.map((r) => r.purchasePda.toLowerCase()));
  const pending = (address ? (store.get<MyPurchase[]>(myPurchasesKey(address)) ?? []) : [])
    .filter((m) => !known.has(m.purchaseKey.toLowerCase()))
    .reverse();
  const empty = list.data !== undefined && server.length === 0 && pending.length === 0;

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
        <p className="truncate text-[14px] text-ink-soft">{w.email}</p>
        <p className="font-display text-[52px] leading-none">{usd(w.wallet!.usdcBalance)}</p>
        <AddUsdc onAdded={() => void w.refreshWallet()} />
        <button
          type="button"
          onClick={() => w.logout()}
          className="text-[14px] font-semibold text-ink-soft hover:text-ink"
        >
          Log out
        </button>
      </section>

      <section aria-labelledby="mine" className="space-y-3">
        <h2 id="mine" className="font-wide text-[20px] font-bold">
          Your orders
        </h2>
        {list.error && !list.data ? (
          <p className="text-[13px] text-ink-soft">
            {describe(list.error).title}. {describe(list.error).detail}
          </p>
        ) : null}
        {list.data === undefined && !list.error ? (
          <p className="flex items-center gap-2 text-ink-soft">
            <Spinner /> Loading your orders…
          </p>
        ) : empty ? (
          <div className="rounded-2xl border border-dashed border-ink/25 px-5 py-8 text-center text-ink-soft">
            No orders yet.{" "}
            <Link href="/discover" className="font-semibold text-ink underline">
              Find a promo
            </Link>
            .
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((m) => (
              <li key={m.purchaseKey}>
                <Link
                  href={`/purchases/${m.purchaseKey}`}
                  className="flex items-center gap-4 rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-ink/10 hover:ring-ink/40"
                >
                  <span className="font-display text-[22px]">{orderNumber(m.purchaseKey)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">Purchase</span>
                    <span className="block text-[13px] text-ink-soft">Waiting for the server…</span>
                  </span>
                  <Spinner />
                </Link>
              </li>
            ))}
            {server.map((r) => (
              <li key={r.purchasePda}>
                <Link
                  href={`/purchases/${r.purchasePda}`}
                  className="flex items-center gap-4 rounded-2xl bg-paper-raised px-4 py-3 ring-1 ring-ink/10 hover:ring-ink/40"
                >
                  <span className="font-display text-[22px]">
                    {r.orderCode ? `#${r.orderCode}` : orderNumber(r.purchasePda)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.promotion.itemName} at {r.promotion.shopName}
                    </span>
                    <span className="block text-[13px] text-ink-soft">{r.message}</span>
                  </span>
                  <span className="shrink-0 font-semibold">{usd(r.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
