"use client";

import Link from "next/link";
import type { PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { chance, clock, conditionText, countdown, usd } from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { ButtonLink, Notice, Spinner } from "./ui";
import { Seal, Voucher } from "./voucher";

/** Customer Discover: live promos as vouchers you can buy, then a short list of closed ones. */
export function DiscoverView() {
  const promos = usePoll(() => api.promotions(), 15_000);
  const now = useNowSeconds();
  const all = promos.data?.promotions ?? [];
  const selling = all.filter((p) => p.live?.phase === "LIVE");
  // One row per shop + item + condition: the newest closed one.
  const seen = new Set<string>();
  const closed = all
    .filter((p) => p.live?.phase !== "LIVE")
    .sort((a, b) => b.depositDeadline - a.depositDeadline)
    .filter((p) => {
      const k = `${p.shop.name}|${p.itemName}|${conditionText(p.outcomeLabel, p.geminiMarketId)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5);

  if (!promos.data) {
    return promos.error ? (
      <Notice tone="error" title={describe(promos.error).title}>
        {describe(promos.error).detail}
      </Notice>
    ) : (
      <p className="flex items-center gap-2 py-16 text-ink-soft">
        <Spinner /> Finding promos…
      </p>
    );
  }

  return (
    <div className="space-y-10">
      {selling.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-ink/25 px-5 py-10 text-center text-[18px] text-ink-soft">
          Nothing selling right now.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-8">
          {selling.map((p) => (
            <LivePromo key={p.id} p={p} now={now} />
          ))}
        </ul>
      )}
      {closed.length ? (
        <section aria-labelledby="closed">
          <h2 id="closed" className="mb-2 text-[15px] font-bold text-ink-soft">
            Closed
          </h2>
          <ul className="divide-y divide-ink/10 overflow-hidden rounded-2xl bg-paper-raised ring-1 ring-ink/10">
            {closed.map((p) => (
              <ClosedPromo key={p.id} p={p} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function LivePromo({ p, now }: { p: PromotionDto; now: number | null }) {
  const cond = conditionText(p.outcomeLabel, p.geminiMarketId);
  const left = now === null ? null : p.depositDeadline - now;
  return (
    <li className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
      <Link href={`/checkout/${p.id}`} className="block overflow-hidden lg:overflow-visible">
        <Voucher
          seed={p.promoPda ?? p.id}
          shopName={p.shop.name}
          itemName={p.itemName}
          amount={p.offerAmount}
          condition={cond}
          closesLabel={`Sales close ${clock(p.depositDeadline)}`}
          serial={p.promoPda}
          marketId={p.geminiMarketId}
          stamp={{ text: "SELLING NOW", tone: "note" }}
          compact
        />
      </Link>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <p title="From Gemini's live market price">
            <span className="font-display block text-[48px] leading-none text-note">
              {chance(p.live?.liveAskMicroUsd)}
            </span>
            <span className="text-[13px] font-semibold text-ink-soft">chance it&apos;s free</span>
          </p>
          <p title={`Sales close at ${clock(p.depositDeadline)}`}>
            <span className="font-display block text-[48px] leading-none">
              {left !== null && left > 0 ? countdown(left) : "0:00"}
            </span>
            <span className="text-[13px] font-semibold text-ink-soft">left to buy</span>
          </p>
        </div>
        <ButtonLink href={`/checkout/${p.id}`} size="lg" className="h-16 w-full text-[19px]">
          Buy a {p.itemName.toLowerCase()} for {usd(p.offerAmount).replace(/\.00$/, "")}
        </ButtonLink>
      </div>
    </li>
  );
}

function ClosedPromo({ p }: { p: PromotionDto }) {
  const result =
    p.live?.phase === "RESULT_YES"
      ? { text: "FREE", cls: "text-note border-note" }
      : p.live?.phase === "RESULT_NO"
        ? { text: "PAID", cls: "text-ink border-ink" }
        : p.live?.phase === "PAUSED"
          ? { text: "PAUSED", cls: "text-sim border-sim" }
          : { text: "WAITING", cls: "text-ink-soft border-ink-soft" };
  return (
    <li>
      <Link
        href={`/checkout/${p.id}`}
        className="flex items-center gap-4 px-4 py-3 hover:bg-paper-deep/50"
      >
        <Seal seed={p.promoPda ?? p.id} size={40} label={usd(p.offerAmount).replace(/\.00$/, "")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {p.itemName} at {p.shop.name}
          </span>
          <span className="block truncate text-[13.5px] text-ink-soft">
            Free if {conditionText(p.outcomeLabel, p.geminiMarketId)}
          </span>
        </span>
        <span
          className={`font-display shrink-0 -rotate-6 rounded border-2 px-2 py-0.5 text-[14px] tracking-[0.05em] ${result.cls}`}
        >
          {result.text}
        </span>
      </Link>
    </li>
  );
}
