"use client";

import type { MarketSummary, MarketWindow } from "@hedged/shared";
import { useEffect, useState } from "react";
import type { PricedLineDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { cents, clock, countdown, dateTime, usd } from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { windowUsable } from "@/lib/merchant";
import { Spinner } from "../ui";

// Choosing the Gemini market behind a promotion (live, read-only data from the promo server):
// the next 5-minute SOL Up/Down windows, or a search over any open Gemini market. For a game, the
// server also suggests the most likely line whose simulated hedge fits the shop's max price.
// Styled as Zahin's ruled lists with the Outcome Playground's segmented control.

export type PickedMarket =
  | { kind: "window"; marketId: string; window: MarketWindow }
  | { kind: "market"; marketId: string; market: MarketSummary };

const ROW_BASE =
  "w-full border-b border-[#E6E1D8] px-4 py-3 text-left text-[14.5px] last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#6133A7]";
const ROW_SELECTED = "bg-[#EFE9F8] shadow-[inset_3px_0_0_#6133A7]";
const LIST = "overflow-hidden rounded-[12px] border border-[#E6E1D8] bg-white";

export function MarketPicker({
  selected,
  onPick,
  offerBase,
  capMicro,
  onUseLine,
}: {
  selected: PickedMarket | null;
  onPick: (m: PickedMarket) => void;
  /** Price in base units and max YES price in micro-USD, for the suggested game line. */
  offerBase: string | null;
  capMicro: string | null;
  onUseLine: (marketId: string, label: string) => void;
}) {
  const [tab, setTab] = useState<"windows" | "search">("windows");
  const now = useNowSeconds();
  const windows = usePoll(() => api.windows("SOL", 5, 12), 15_000);

  // Auto-pick the first window that is still safely sellable (the fastest demo path).
  useEffect(() => {
    if (selected || tab !== "windows" || !windows.data || now === null) return;
    const w = windows.data.windows.find((x) => windowUsable(x, now).ok);
    if (w) onPick({ kind: "window", marketId: w.marketId, window: w });
  }, [selected, tab, windows.data, now, onPick]);

  const game =
    selected?.kind === "market" && selected.market.category === "Sports" ? selected.market : null;
  const team = game ? game.outcomeLabel.replace(/ wins.*$/, "") : null;
  const suggestion = usePoll(
    game && team && offerBase && capMicro
      ? () => api.lines(game.eventTicker, team, offerBase, Number(BigInt(capMicro) / 100n))
      : null,
    0,
    [game?.eventTicker, team, offerBase, capMicro],
  );

  return (
    <div className="sm:col-span-2">
      <p className="block text-sm font-semibold text-[#211D28]" id="market-picker-label">
        Market
      </p>
      <div
        role="tablist"
        aria-labelledby="market-picker-label"
        className="relative mt-2 grid max-w-md grid-cols-2 rounded-full bg-[#F1ECE2] p-1"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-[0_1px_2px_rgba(33,29,40,0.18)] transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${tab === "windows" ? 0 : 100}%)` }}
        />
        {(["windows", "search"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`relative min-h-10 rounded-full px-2 text-sm font-semibold transition-colors ${tab === t ? "text-[#211D28]" : "text-[#5A5463] hover:text-[#211D28]"}`}
          >
            {t === "windows" ? "Next SOL windows" : "Any Gemini market"}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === "windows" ? (
          <WindowList
            windows={windows.data?.windows ?? null}
            loading={windows.loading}
            error={windows.error}
            now={now}
            selected={selected?.marketId ?? null}
            onPick={(w) => onPick({ kind: "window", marketId: w.marketId, window: w })}
          />
        ) : (
          <div className="space-y-3">
            <MarketSearch
              selected={selected?.marketId ?? null}
              onPick={(m) => onPick({ kind: "market", marketId: m.marketId, market: m })}
            />
            {game ? (
              <SuggestedLine
                loading={suggestion.loading}
                error={suggestion.error}
                suggested={suggestion.data?.suggested ?? null}
                selected={selected?.marketId ?? null}
                onUse={onUseLine}
              />
            ) : null}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[#5A5463]">
        Live from Gemini Predictions (read-only). Customers are refunded if the market resolves YES.
      </p>
    </div>
  );
}

function WindowList({
  windows,
  loading,
  error,
  now,
  selected,
  onPick,
}: {
  windows: MarketWindow[] | null;
  loading: boolean;
  error: unknown;
  now: number | null;
  selected: string | null;
  onPick: (w: MarketWindow) => void;
}) {
  if (!windows) {
    return (
      <p className="flex items-center gap-2 text-sm text-[#5A5463]">
        {error ? (
          `${describe(error).title}. ${describe(error).detail}`
        ) : (
          <>{loading ? <Spinner /> : null} Loading Gemini&apos;s next SOL windows…</>
        )}
      </p>
    );
  }
  const usable = windows.filter((w) => now === null || windowUsable(w, now).ok).slice(0, 6);
  if (usable.length === 0) {
    return (
      <p className="text-sm text-[#5A5463]">
        No SOL window can be sold right now. Gemini lists them about an hour ahead; try again
        shortly, or search any market.
      </p>
    );
  }
  return (
    <ul role="radiogroup" aria-label="SOL windows" className={LIST}>
      {usable.map((w) => {
        const isSel = selected === w.marketId;
        return (
          <li key={w.marketId}>
            <button
              type="button"
              role="radio"
              aria-checked={isSel}
              onClick={() => onPick(w)}
              className={`${ROW_BASE} grid grid-cols-2 items-baseline gap-x-3 gap-y-0.5 sm:grid-cols-[1.3fr_1.3fr_0.6fr] ${isSel ? ROW_SELECTED : "hover:bg-[#FAF9F6]"}`}
            >
              <span className="font-semibold">
                SOL up, {clock(w.opensAt)} to {clock(w.expiresAt)}
              </span>
              <span className="text-[#5A5463] max-sm:text-right">
                Sales close {clock(w.recommendedDepositDeadline)}
                {now !== null && w.recommendedDepositDeadline > now
                  ? ` (${countdown(w.recommendedDepositDeadline - now)})`
                  : ""}
              </span>
              <span className="font-semibold sm:text-right">{cents(w.bestAskMicroUsd)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function MarketSearch({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (m: MarketSummary) => void;
}) {
  const [q, setQ] = useState("Texas");
  const [debounced, setDebounced] = useState("Texas");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const res = usePoll(debounced.length >= 2 ? () => api.markets(debounced, 12) : null, 0, [
    debounced,
  ]);
  const open = (res.data?.markets.filter((m) => m.marketState === "open") ?? []).slice(0, 8);
  return (
    <div className="space-y-3">
      <input
        aria-label="Search Gemini markets"
        className="block w-full rounded-[10px] border border-[#CFC8BC] bg-white px-3.5 py-2.5 text-base text-[#211D28] placeholder:text-[#6B6575] focus:border-[#6133A7] focus:outline-none focus:ring-2 focus:ring-[#6133A7]/20 sm:text-sm"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Team, coin, event…"
      />
      {res.error ? (
        <p className="text-sm text-[#8A1F16]">
          {describe(res.error).title}. {describe(res.error).detail}
        </p>
      ) : res.loading ? (
        <p className="flex items-center gap-2 text-sm text-[#5A5463]">
          <Spinner /> Searching Gemini…
        </p>
      ) : open.length === 0 ? (
        <p className="text-sm text-[#5A5463]">No open markets match.</p>
      ) : (
        <ul role="radiogroup" aria-label="Gemini markets" className={LIST}>
          {open.map((m) => (
            <li key={m.marketId}>
              <button
                type="button"
                role="radio"
                aria-checked={selected === m.marketId}
                onClick={() => onPick(m)}
                className={`${ROW_BASE} flex items-center justify-between gap-4 ${selected === m.marketId ? ROW_SELECTED : "hover:bg-[#FAF9F6]"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{m.outcomeLabel}</span>
                  <span className="block truncate text-[13px] text-[#5A5463]">
                    {m.eventTitle}
                    {m.startsAt ? `, starts ${dateTime(m.startsAt)}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right font-semibold">
                  {cents(m.bestAskMicroUsd)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestedLine({
  loading,
  error,
  suggested,
  selected,
  onUse,
}: {
  loading: boolean;
  error: unknown;
  suggested: PricedLineDto | null;
  selected: string | null;
  onUse: (marketId: string, label: string) => void;
}) {
  return (
    <div className="border-l-[3px] border-[#F58C38] bg-[#FDEBD9]/50 p-4 text-sm leading-relaxed">
      <p className="font-semibold text-[#211D28]">
        Suggested line for your max price{" "}
        <span className="text-xs font-semibold text-[#7A4208]">(simulated hedge)</span>
      </p>
      {loading ? (
        <p className="mt-1 flex items-center gap-2 text-[#5A5463]">
          <Spinner /> Pricing every line of this game…
        </p>
      ) : error ? (
        <p className="mt-1 text-[#5A5463]">{describe(error).detail}</p>
      ) : suggested ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[#4E4858]">
            <strong className="text-[#211D28]">{suggested.label}</strong> at{" "}
            {cents(suggested.bestAskMicroUsd)}: covering a sale costs {usd(suggested.costPerSale)}.
            The most likely line that fits.
          </p>
          {selected === suggested.marketId ? (
            <span className="text-xs font-semibold text-[#6133A7]">Using this line</span>
          ) : (
            <button
              type="button"
              onClick={() => onUse(suggested.marketId, suggested.label)}
              className="rounded-full border border-[#211D28]/30 px-4 py-1.5 text-sm font-semibold hover:border-[#211D28] hover:bg-white"
            >
              Use this line
            </button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-[#5A5463]">
          No line of this game fits your max price right now. Raise it or pick another market.
        </p>
      )}
    </div>
  );
}
