"use client";

import type { MarketSummary, MarketWindow } from "@hedged/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { clock } from "@/lib/format";
import { useNowSeconds, usePoll } from "@/lib/hooks";
import { windowUsable } from "@/lib/merchant";
import { oddsPct, shortCountdown, whenText } from "@/lib/promo-view";
import { IconCheck, IconSearch } from "../icons";
import { INPUT, Spinner } from "../kit";

// Choosing the Gemini market behind a promo (live, read-only data from the promo server): any open
// game by search, or the next 5-minute SOL Up/Down windows (fast to settle, good for a live demo).
// For a game, the server also suggests the likeliest line whose cost fits the shop's max odds.

export type PickedMarket =
  | { kind: "window"; marketId: string; window: MarketWindow }
  | { kind: "market"; marketId: string; market: MarketSummary };

export function pickedAsk(m: PickedMarket | null): string | null {
  if (!m) return null;
  return m.kind === "window" ? m.window.bestAskMicroUsd : m.market.bestAskMicroUsd;
}

export function MarketPicker({
  selected,
  onPick,
  maxPct,
}: {
  selected: PickedMarket | null;
  onPick: (m: PickedMarket) => void;
  maxPct: number;
}) {
  const [tab, setTab] = useState<"games" | "windows">("games");
  const now = useNowSeconds();
  const windows = usePoll(tab === "windows" ? () => api.windows("SOL", 5, 12) : null, 15_000, [
    tab,
  ]);

  // On the SOL tab, pick the first window that is still safely sellable (the fastest demo path).
  useEffect(() => {
    if (tab !== "windows" || selected?.kind === "window" || !windows.data || now === null) return;
    const w = windows.data.windows.find((x) => windowUsable(x, now).ok);
    if (w) onPick({ kind: "window", marketId: w.marketId, window: w });
  }, [selected, tab, windows.data, now, onPick]);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Market type"
        className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-rule"
      >
        {(
          [
            ["games", "Games"],
            ["windows", "Quick 5-min"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`h-10 rounded-full text-[13px] font-semibold transition-colors ${tab === t ? "bg-ink text-black" : "text-ink-soft hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {tab === "games" ? (
          <GameSearch
            selected={selected?.marketId ?? null}
            maxPct={maxPct}
            onPick={(m) => onPick({ kind: "market", marketId: m.marketId, market: m })}
          />
        ) : (
          <WindowList
            windows={windows.data?.windows ?? null}
            error={windows.error}
            now={now}
            selected={selected?.marketId ?? null}
            maxPct={maxPct}
            onPick={(w) => onPick({ kind: "window", marketId: w.marketId, window: w })}
          />
        )}
      </div>
    </div>
  );
}

function Row({
  selected,
  onClick,
  title,
  sub,
  ask,
  maxPct,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  ask: string | null;
  maxPct: number;
}) {
  const pct = oddsPct(ask);
  const over = pct !== null && pct > maxPct;
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${selected ? "bg-note-soft" : "hover:bg-surface-2"} ${over && !selected ? "opacity-50" : ""}`}
      >
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${selected ? "bg-note text-black" : "ring-1 ring-inset ring-line-strong"}`}
        >
          {selected ? <IconCheck size={14} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-[11.5px] text-ink-soft">{sub}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`font-num block text-[18px] ${over ? "text-ink-faint" : "text-note"}`}>
            {pct === null ? "–" : `${Math.round(pct)}%`}
          </span>
          <span className={`block text-[11px] ${over ? "text-orange" : "text-ink-faint"}`}>
            {over ? "over your max" : "chance"}
          </span>
        </span>
      </button>
    </li>
  );
}

const LIST =
  "divide-y divide-rule overflow-hidden rounded-[18px] bg-paper ring-1 ring-inset ring-rule";

function WindowList({
  windows,
  error,
  now,
  selected,
  maxPct,
  onPick,
}: {
  windows: MarketWindow[] | null;
  error: unknown;
  now: number | null;
  selected: string | null;
  maxPct: number;
  onPick: (w: MarketWindow) => void;
}) {
  if (!windows) {
    return (
      <p className="flex items-center gap-2 py-3 text-[12.5px] text-ink-soft">
        {error ? (
          `${describe(error).title}. ${describe(error).detail}`
        ) : (
          <>
            <Spinner /> Loading the next SOL windows
          </>
        )}
      </p>
    );
  }
  const usable = windows.filter((w) => now === null || windowUsable(w, now).ok).slice(0, 5);
  if (usable.length === 0) {
    return (
      <p className="py-3 text-[12.5px] text-ink-soft">
        No SOL window can be sold right now. Try again in a minute, or pick a game.
      </p>
    );
  }
  return (
    <ul role="radiogroup" aria-label="SOL windows" className={LIST}>
      {usable.map((w) => (
        <Row
          key={w.marketId}
          selected={selected === w.marketId}
          onClick={() => onPick(w)}
          title={`Solana is up at ${clock(w.expiresAt)}`}
          sub={`Sales close ${clock(w.recommendedDepositDeadline)}${now !== null && w.recommendedDepositDeadline > now ? `, in ${shortCountdown(w.recommendedDepositDeadline - now)}` : ""}`}
          ask={w.bestAskMicroUsd}
          maxPct={maxPct}
        />
      ))}
    </ul>
  );
}

function GameSearch({
  selected,
  maxPct,
  onPick,
}: {
  selected: string | null;
  maxPct: number;
  onPick: (m: MarketSummary) => void;
}) {
  const [q, setQ] = useState("Texas");
  const [debounced, setDebounced] = useState("Texas");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const res = usePoll(debounced.length >= 2 ? () => api.markets(debounced, 12) : null, 0, [
    debounced,
  ]);
  const open = (res.data?.markets.filter((m) => m.marketState === "open") ?? []).slice(0, 8);
  return (
    <div className="space-y-3">
      <div className="relative">
        <IconSearch
          size={18}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          aria-label="Search games"
          className={`${INPUT} h-12 pl-11`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Team or game"
        />
      </div>
      {res.error ? (
        <p className="text-[12.5px] text-danger">{describe(res.error).detail}</p>
      ) : res.loading ? (
        <p className="flex items-center gap-2 py-2 text-[12.5px] text-ink-soft">
          <Spinner /> Searching
        </p>
      ) : open.length === 0 ? (
        <p className="py-2 text-[12.5px] text-ink-soft">No open games match.</p>
      ) : (
        <ul role="radiogroup" aria-label="Games" className={LIST}>
          {open.map((m) => (
            <Row
              key={m.marketId}
              selected={selected === m.marketId}
              onClick={() => onPick(m)}
              title={
                /\bwins?\b/.test(m.outcomeLabel) || m.category !== "Sports"
                  ? m.outcomeLabel
                  : `${m.outcomeLabel} wins`
              }
              sub={`${m.eventTitle}${m.startsAt ? `, ${whenText(Date.parse(m.startsAt) / 1000, null)}` : ""}`}
              ask={m.bestAskMicroUsd}
              maxPct={maxPct}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
