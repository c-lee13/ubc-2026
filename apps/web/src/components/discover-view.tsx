"use client";

import Link from "next/link";
import type { PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { chance, clock, conditionText, countdown, usd } from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { Notice, Spinner } from "./ui";
import { Seal } from "./voucher";

/** Customer Discover: shops with live promos, the chance it happens, one tap to checkout. */
export function DiscoverView() {
  const promos = usePoll(() => api.promotions(), 15_000);
  const now = useNowSeconds();
  const all = promos.data?.promotions ?? [];
  const selling = all.filter((p) => p.live?.phase === "LIVE");
  const rest = all.filter((p) => p.live?.phase !== "LIVE").slice(0, 4);

  if (!promos.data) {
    return promos.error ? (
      <Notice tone="error" title={describe(promos.error).title}>
        {describe(promos.error).detail}
      </Notice>
    ) : (
      <p className="flex items-center gap-2 py-16 text-ink-soft">
        <Spinner /> Finding promos near you…
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="selling" className="space-y-3">
        <h2 id="selling" className="text-[15px] font-semibold text-ink-soft">
          Selling now
        </h2>
        {selling.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-ink/25 px-5 py-8 text-center text-ink-soft">
            Nothing selling right now.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {selling.map((p) => (
              <PromoCard key={p.id} p={p} now={now} />
            ))}
          </ul>
        )}
      </section>
      {rest.length ? (
        <section aria-labelledby="later" className="space-y-3">
          <h2 id="later" className="text-[15px] font-semibold text-ink-soft">
            Paused or waiting for a result
          </h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {rest.map((p) => (
              <PromoCard key={p.id} p={p} now={now} muted />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function PromoCard({ p, now, muted }: { p: PromotionDto; now: number | null; muted?: boolean }) {
  const cond = conditionText(p.outcomeLabel, p.geminiMarketId);
  const left = now === null ? null : p.depositDeadline - now;
  return (
    <li>
      <Link
        href={`/checkout/${p.id}`}
        className={`flex items-center gap-4 rounded-2xl bg-paper-raised p-4 ring-1 ring-ink/10 transition-colors hover:ring-ink/40 ${muted ? "opacity-70" : ""}`}
      >
        <Seal seed={p.promoPda ?? p.id} size={56} label={usd(p.offerAmount).replace(/\.00$/, "")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] text-ink-soft">
            {p.shop.name}
            {p.shop.location ? `, ${p.shop.location}` : ""}
          </p>
          <p className="font-wide text-[17px] leading-snug font-bold">
            {p.itemName} {usd(p.offerAmount).replace(/\.00$/, "")}, free if {cond}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            {p.live?.phase === "LIVE" && left !== null && left > 0
              ? `Until ${clock(p.depositDeadline)} (${countdown(left)})`
              : p.live?.phase === "PAUSED"
                ? "Paused right now"
                : "Sales closed"}
          </p>
        </div>
        {p.live?.liveAskMicroUsd ? (
          <span
            className="shrink-0 text-right text-note"
            title="Chance it happens, from Gemini's live price"
          >
            <span className="font-display block text-[30px] leading-none">
              {chance(p.live.liveAskMicroUsd)}
            </span>
            <span className="text-[12px] font-semibold">chance</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}
