"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CustomerPurchaseDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { conditionText, displayCode, usd } from "@/lib/format";
import { store, usePoll } from "@/lib/hooks";
import { happened, price } from "@/lib/promo-view";
import { myPurchasesKey, type MyPurchase } from "@/lib/purchases";
import { useWallet } from "@/lib/wallet/session";
import { IconChevron } from "./icons";
import { Note, SectionTitle, Spinner } from "./kit";
import { LoginCard } from "./login-card";
import { CustomerShell } from "./shell";
import { Seal } from "./voucher";

/**
 * My promos: everything this email bought (GET /api/purchases?customer=, polled), plus purchases
 * this browser just made that the server hasn't listed yet. Upside-only status words.
 */
export function MyPromos() {
  const w = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted && w.phase === "ready" && w.wallet;
  const address = ready ? w.wallet!.address : null;
  const list = usePoll(address ? () => api.customerPurchases(address) : null, 6_000, [address]);
  const server = list.data?.purchases ?? [];
  const known = new Set(server.map((r) => r.purchasePda.toLowerCase()));
  const pending = (address ? (store.get<MyPurchase[]>(myPurchasesKey(address)) ?? []) : [])
    .filter((m) => !known.has(m.purchaseKey.toLowerCase()))
    .reverse();

  const active = server.filter((r) => !isFinished(r));
  const finished = server.filter(isFinished);
  const saved = server
    .filter(
      (r) =>
        r.promotion.resolvedOutcome === "YES" &&
        r.onChainState !== "Cancelled" &&
        r.onChainState !== "Refunded",
    )
    .reduce((a, r) => a + BigInt(r.amount), 0n);

  return (
    <CustomerShell>
      <h1 className="font-display pb-5 pt-4 text-[34px]">My promos</h1>
      {!ready ? (
        <div className="rounded-[24px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
          <p className="font-title text-[19px]">Sign in to see your promos</p>
          <p className="mb-4 mt-1 text-[15px] text-ink-soft">Use the email you paid with.</p>
          <LoginCard />
        </div>
      ) : list.data === undefined ? (
        list.error ? (
          <Note tone="error" title={describe(list.error).title}>
            {describe(list.error).detail}
          </Note>
        ) : (
          <div className="grid place-items-center py-16 text-ink-soft">
            <Spinner className="h-6 w-6" />
          </div>
        )
      ) : server.length === 0 && pending.length === 0 ? (
        <div className="rounded-[24px] bg-paper-raised px-6 py-10 text-center ring-1 ring-inset ring-rule">
          <p className="font-title text-[20px]">Nothing yet</p>
          <p className="mt-1.5 text-[15px] text-ink-soft">
            Buy a coupon and it shows up here, with your order code.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-11 items-center rounded-full bg-ink px-5 font-semibold text-black"
          >
            Find a promo
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {saved > 0n ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat value={usd(saved)} label="free so far" accent />
              <Stat
                value={String(server.length + pending.length)}
                label={server.length + pending.length === 1 ? "promo" : "promos"}
              />
            </div>
          ) : null}

          {active.length + pending.length > 0 ? (
            <section>
              <SectionTitle>Waiting on the game</SectionTitle>
              <ul className="space-y-2.5">
                {pending.map((m) => (
                  <li key={m.purchaseKey}>
                    <Link
                      href={`/purchases/${m.purchaseKey}`}
                      className="flex items-center gap-3.5 rounded-[20px] bg-paper-raised px-4 py-3.5 ring-1 ring-inset ring-rule"
                    >
                      <Spinner className="h-5 w-5 text-note" />
                      <span className="flex-1 text-[15px] font-semibold">
                        Confirming your payment
                      </span>
                      <IconChevron size={18} className="text-ink-faint" />
                    </Link>
                  </li>
                ))}
                {active.map((r) => (
                  <Row key={r.purchasePda} r={r} />
                ))}
              </ul>
            </section>
          ) : null}

          {finished.length > 0 ? (
            <section>
              <SectionTitle>Done</SectionTitle>
              <ul className="space-y-2.5">
                {finished.map((r) => (
                  <Row key={r.purchasePda} r={r} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </CustomerShell>
  );
}

function isFinished(r: CustomerPurchaseDto): boolean {
  return (
    r.promotion.resolvedOutcome !== null ||
    r.step === "REFUNDED" ||
    r.step === "DONE" ||
    r.onChainState === "Refunded"
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[22px] bg-paper-raised px-4 py-4 ring-1 ring-inset ring-rule">
      <p className={`font-num text-[34px] ${accent ? "text-note" : ""}`}>{value}</p>
      <p className="mt-1.5 text-[13.5px] text-ink-soft">{label}</p>
    </div>
  );
}

function statusOf(r: CustomerPurchaseDto): { text: string; tone: "win" | "live" | "quiet" } {
  const cond = r.promotion.outcomeLabel ? conditionText(r.promotion.outcomeLabel, "") : "";
  if (r.step === "REFUNDING" || r.step === "REFUND_READY")
    return { text: "Money on its way back", tone: "quiet" };
  if (r.step === "REFUNDED" || r.onChainState === "Refunded")
    return { text: "Refunded", tone: "quiet" };
  if (r.promotion.resolvedOutcome === "YES")
    return { text: `Free! ${happened(cond)}`, tone: "win" };
  if (r.promotion.resolvedOutcome === "NO") return { text: "Enjoyed", tone: "quiet" };
  if (r.step === "PROCESSING") return { text: "Confirming", tone: "live" };
  return { text: `Free if ${cond}`, tone: "live" };
}

function Row({ r }: { r: CustomerPurchaseDto }) {
  const s = statusOf(r);
  return (
    <li>
      <Link
        href={`/purchases/${r.purchasePda}`}
        className="flex items-center gap-3.5 rounded-[20px] bg-paper-raised px-4 py-3.5 ring-1 ring-inset ring-rule transition-colors hover:ring-line-strong"
      >
        <Seal seed={r.purchasePda} size={46} label={price(r.amount)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-semibold">
            {r.promotion.itemName}{" "}
            <span className="font-normal text-ink-soft">at {r.promotion.shopName}</span>
          </p>
          <p
            className={`truncate text-[14px] ${s.tone === "win" ? "font-semibold text-note" : s.tone === "live" ? "text-ink" : "text-ink-soft"}`}
          >
            {s.text}
          </p>
        </div>
        <span className="font-num shrink-0 text-[17px] text-ink-soft">
          {displayCode(r.orderCode, r.purchasePda)}
        </span>
      </Link>
    </li>
  );
}
