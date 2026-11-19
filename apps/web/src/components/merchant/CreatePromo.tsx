"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { describeDeadlineReason, type PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { DEFAULT_COUPONS, registerCoupons } from "@/lib/coupons";
import { describe, type Problem } from "@/lib/errors";
import { clock, dateTime, dollarsToBase, usd, usdExact } from "@/lib/format";
import { store, useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import {
  MIN_LEAD_SECS,
  confirmWithRetry,
  removeDraft,
  saveDraft,
  type LocalDraft,
} from "@/lib/merchant";
import { NEIGHBORHOODS, placeIn, rememberShopPlace } from "@/lib/places";
import { oddsPct } from "@/lib/promo-view";
import { useWallet } from "@/lib/wallet/session";
import { IconBack, IconCheck, IconMinus, IconPlus } from "../icons";
import { Button, INPUT, Note, Spinner } from "../kit";
import { LoginCard } from "../login-card";
import { PromoCard } from "../promo-card";
import { QrCode } from "../qr";
import { MarketPicker, pickedAsk, type PickedMarket } from "./MarketPicker";

// Create a promo, phone-first. The live card at the top is exactly what customers will see.
// Publish follows docs/FRONTEND-API.md "Create and publish a promo":
//   1. deadline check against the exact Gemini market   GET  /api/markets/:id/deadline-check
//   2. draft with the exact on-chain arguments          POST /api/promotions
//   3. the shop approves creating it on Arc             POST /api/promotions/:id/initialize
//      + Circle's approval window (returns the promo's on-chain id, promoPda)
//   4. the server reads it back from Arc, turns it on   POST /api/promotions/:id/confirm
// Amounts are BigInt base units. The coupon count and selling-out threshold have no API field yet:
// they are kept in this browser (lib/coupons.ts).

const DEFAULT_MAX_PCT = 49;
const MAX_PRICE = 1_000_000_000n;

type StepKey = "check" | "draft" | "sign" | "verify";
const STEP_TEXT: Record<StepKey, string> = {
  check: "Checking the game time",
  draft: "Saving your promo",
  sign: "Approve it in the window",
  verify: "Going live",
};

function ceilDiv(a: bigint, b: bigint) {
  return (a + b - 1n) / b;
}

export function CreatePromo() {
  const wallet = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const signedIn = mounted && wallet.phase === "ready" && Boolean(wallet.wallet);
  const now = useNowSeconds();
  const origin = useOrigin();

  const [shopName, setShopName] = useState("Barton Springs Coffee Co.");
  // Where the shop is, for the customer map. Sent as the promo's `location` text (an API field),
  // and the exact point is remembered in this browser (lib/places.ts).
  const [hood, setHood] = useState(NEIGHBORHOODS[0]!.name);
  const [itemName, setItemName] = useState("Latte");
  const [priceText, setPriceText] = useState("5");
  const [maxPct, setMaxPct] = useState(DEFAULT_MAX_PCT);
  const [coupons, setCoupons] = useState(DEFAULT_COUPONS);
  const [picked, setPicked] = useState<PickedMarket | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [editDeadline, setEditDeadline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<StepKey | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);

  useEffect(() => {
    const saved = store.get<{ shopName: string; itemName: string }>("hedged:shop");
    if (saved) {
      setShopName(saved.shopName);
      setItemName(saved.itemName);
    }
  }, []);

  const onPick = useCallback((m: PickedMarket) => {
    setPicked(m);
    setProblem(null);
    if (m.kind === "window") {
      setDeadline(m.window.recommendedDepositDeadline);
      return;
    }
    setDeadline(null);
    void api
      .deadlineCheck(m.marketId, Math.floor(Date.now() / 1000) + 120)
      .then((probe) => {
        if (probe.latest) setDeadline(probe.latest);
        else
          setProblem({
            title: "No safe sales deadline",
            detail: describeDeadlineReason(probe.reason),
          });
      })
      .catch((err) => setProblem(describe(err)));
  }, []);

  const offerBase = useMemo(() => {
    const b = dollarsToBase(priceText);
    return b && BigInt(b) > 0n && BigInt(b) <= MAX_PRICE ? b : null;
  }, [priceText]);
  const capMicro = String(maxPct * 10_000);
  const marketId = picked?.marketId ?? null;
  const outcomeLabel = picked
    ? picked.kind === "window"
      ? "SOL closes up"
      : picked.market.category === "Sports" && !/\bwins?\b/.test(picked.market.outcomeLabel)
        ? `${picked.market.outcomeLabel} wins`
        : picked.market.outcomeLabel
    : "";

  const quote = usePoll(
    marketId && offerBase ? () => api.quote(marketId, offerBase, capMicro) : null,
    10_000,
    [marketId, offerBase, capMicro],
  );
  const check = usePoll(
    marketId && deadline ? () => api.deadlineCheck(marketId, deadline) : null,
    20_000,
    [marketId, deadline],
  );

  // Live odds: the latest quote, or the picked row's price until the quote lands.
  const ask = quote.data?.quote.yesAskMicroUsd ?? pickedAsk(picked);
  const pct = oddsPct(ask);
  const overMax = pct !== null && pct > maxPct;
  // Cost to cover one sale = price x the market's price for $1 (computed here, so it moves as you type).
  const perSale = offerBase && ask ? ceilDiv(BigInt(offerBase) * BigInt(ask), 1_000_000n) : null;
  const budget = perSale !== null ? perSale * BigInt(coupons) : null;
  const keep = offerBase && perSale !== null ? BigInt(offerBase) - perSale : null;

  // A game line over the max: ask the server for the likeliest line that fits.
  const game =
    picked?.kind === "market" && picked.market.category === "Sports" ? picked.market : null;
  const team = game ? game.outcomeLabel.replace(/ wins.*$/, "") : null;
  const suggestion = usePoll(
    game && team && offerBase && overMax
      ? () => api.lines(game.eventTicker, team, offerBase, maxPct * 100)
      : null,
    0,
    [game?.eventTicker, team, offerBase, maxPct, overMax],
  );

  const errors: string[] = [];
  if (!shopName.trim()) errors.push("Add your shop's name.");
  if (!itemName.trim()) errors.push("Add the item.");
  if (!offerBase) errors.push("Set a price.");
  if (!marketId) errors.push("Pick a game.");
  if (marketId && !deadline) errors.push("Waiting for the game time.");
  if (deadline && now !== null && deadline - now < MIN_LEAD_SECS)
    errors.push("Sales would close too soon. Pick a later game.");
  if (check.data && !check.data.ok) errors.push(describeDeadlineReason(check.data.reason));
  if (overMax)
    errors.push(
      `The odds are ${Math.round(pct!)}%, above your ${maxPct}% max. Pick an underdog or raise the max.`,
    );

  const preview: PromotionDto = {
    id: published ?? "preview",
    status: "ACTIVE",
    promoPda: null,
    shop: {
      merchant: wallet.wallet?.address ?? "",
      name: shopName.trim() || "Your shop",
      location: "",
    },
    itemName: itemName.trim() || "Your item",
    offerAmount: offerBase ?? "5000000",
    outcomeLabel: outcomeLabel || "your team wins",
    geminiMarketId: marketId ?? "",
    depositDeadline: deadline ?? (now ?? 0) + 3 * 3600,
    onChainState: "Active",
    live: {
      phase: "LIVE",
      pauseReason: null,
      canBuy: true,
      liveAskMicroUsd: ask,
      costPerSale: perSale?.toString() ?? null,
    },
    coupons: { total: coupons, sold: 0 },
  };

  async function publish() {
    if (!signedIn || !wallet.wallet || !marketId || !deadline || !offerBase || errors.length)
      return;
    const shop = wallet.wallet;
    setBusy(true);
    setProblem(null);
    let current: StepKey = "check";
    try {
      setStep("check");
      const fresh = await api.deadlineCheck(marketId, deadline);
      if (!fresh.ok) throw new Error(describeDeadlineReason(fresh.reason));
      current = "draft";
      setStep("draft");
      store.set("hedged:shop", { shopName: shopName.trim(), itemName: itemName.trim() });
      const hedgeBudget = (
        budget ?? (BigInt(offerBase) * BigInt(coupons) * BigInt(maxPct)) / 100n
      ).toString();
      const created = await api.createPromotion({
        merchant: shop.address,
        shopName: shopName.trim(),
        location: `${hood}, Austin`,
        itemName: itemName.trim(),
        geminiMarketId: marketId,
        outcomeLabel,
        offerAmount: offerBase,
        depositDeadline: deadline,
        maxYesPriceMicroUsd: capMicro,
        hedgeBudget,
        coupons,
      });
      const id = created.promotion.id;
      registerCoupons(id, coupons);
      const n = NEIGHBORHOODS.find((x) => x.name === hood);
      if (n) rememberShopPlace(shop.address, placeIn(n, shop.address));
      const local: LocalDraft = { promotionId: id, init: created.initializePromo };
      saveDraft(shop.address, local);
      setDraftSaved(true);
      current = "sign";
      setStep("sign");
      const ch = await api.initializePromo(id, shop.id);
      await wallet.execute(
        ch.challengeId,
        `Start the promo: ${itemName.trim()}, ${usdExact(offerBase)}, free if ${outcomeLabel}`,
      );
      saveDraft(shop.address, { ...local, promoId: ch.promoPda });
      current = "verify";
      setStep("verify");
      await confirmWithRetry(id, ch.promoPda);
      removeDraft(shop.address, id);
      setPublished(id);
      setStep(null);
    } catch (err) {
      setStep(current);
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  if (published) {
    const link = `${origin}/checkout/${published}`;
    return (
      <Frame>
        <div className="animate-sheet-up text-center">
          <span className="mx-auto grid h-16 w-16 animate-pop place-items-center rounded-full bg-ribbon text-white">
            <IconCheck size={32} />
          </span>
          <h1 className="font-display mt-5 text-[30.5px]">It&apos;s live.</h1>
          <p className="mt-2 text-[14px] text-ink-soft">
            {itemName}, free if {outcomeLabel}.
          </p>
          <div className="mx-auto mt-6 w-[220px] overflow-hidden rounded-[22px] bg-white p-3">
            {origin ? (
              <QrCode value={link} label={`QR code for ${link}`} className="w-full" />
            ) : (
              <div className="aspect-square" />
            )}
          </div>
          <p className="font-title mt-3 text-[15px]">Scan to buy</p>
          <div className="mt-6 space-y-3">
            <Link
              href={`/counter/${published}`}
              className="flex h-[58px] items-center justify-center rounded-[18px] bg-ink text-[15px] font-semibold text-black"
            >
              Open the counter screen
            </Link>
            <Link
              href="/merchant"
              className="flex h-[58px] items-center justify-center rounded-[18px] bg-surface-2 text-[15px] font-semibold ring-1 ring-inset ring-line-strong"
            >
              Back to workspace
            </Link>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="font-display text-[30.5px]">New promo</h1>
      <div className="mt-4" inert>
        <PromoCard p={preview} now={now} />
      </div>

      <Section n={1} title="The offer">
        <Field label="Shop name">
          <input
            className={`${INPUT} h-12`}
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            maxLength={80}
          />
        </Field>
        <Field label="Neighborhood (for the map)">
          <select
            className={`${INPUT} h-12 appearance-none`}
            value={hood}
            onChange={(e) => setHood(e.target.value)}
          >
            {NEIGHBORHOODS.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}, Austin
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Item">
            <input
              className={`${INPUT} h-12`}
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              maxLength={60}
              placeholder="Latte"
            />
          </Field>
          <Field label="Price">
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft">
                $
              </span>
              <input
                className={`${INPUT} h-12 pl-8`}
                value={priceText}
                inputMode="decimal"
                onChange={(e) => setPriceText(e.target.value.replace(/[^\d.]/g, ""))}
                aria-invalid={!offerBase}
              />
            </div>
          </Field>
        </div>
      </Section>

      <Section n={2} title="The game">
        <MarketPicker selected={picked} onPick={onPick} maxPct={maxPct} />
        {overMax && game ? (
          <div className="rounded-[18px] bg-surface-2 p-4 ring-1 ring-inset ring-rule">
            {suggestion.loading ? (
              <p className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                <Spinner /> Finding an underdog line
              </p>
            ) : suggestion.data?.suggested ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px]">
                  Underdog line that fits: <strong>{suggestion.data.suggested.label}</strong>,{" "}
                  <span className="text-note">
                    {Math.round(oddsPct(suggestion.data.suggested.bestAskMicroUsd) ?? 0)}%
                  </span>
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const sg = suggestion.data!.suggested!;
                    setPicked({
                      kind: "market",
                      marketId: sg.marketId,
                      market: {
                        ...game,
                        marketId: sg.marketId,
                        outcomeLabel: sg.label,
                        bestAskMicroUsd: sg.bestAskMicroUsd,
                      },
                    });
                  }}
                >
                  Use it
                </Button>
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-soft">
                No line of this game is under your max right now.
              </p>
            )}
          </div>
        ) : null}
        {deadline ? (
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <p className="text-ink-soft">
              Sales close{" "}
              <span className="font-semibold text-ink">
                {now !== null && deadline - now > 86_400 ? dateTime(deadline) : clock(deadline)}
              </span>
              {picked?.kind === "market" ? " at kickoff" : ""}
            </p>
            <button
              type="button"
              className="font-semibold text-chain"
              onClick={() => setEditDeadline((v) => !v)}
            >
              {editDeadline ? "Done" : "Change"}
            </button>
          </div>
        ) : null}
        {editDeadline && deadline ? (
          <input
            type="datetime-local"
            className={`${INPUT} h-12`}
            value={toLocalInput(deadline)}
            onChange={(e) => {
              const t = Date.parse(e.target.value);
              if (!Number.isNaN(t)) setDeadline(Math.floor(t / 1000));
            }}
          />
        ) : null}
      </Section>

      <Section n={3} title="Underdog limit" hint="Under 50% keeps it an underdog.">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[12px] text-ink-soft">Chance now</p>
            <p className={`font-num mt-1 text-[35.5px] ${overMax ? "text-orange" : "text-note"}`}>
              {pct === null ? "–" : `${Math.round(pct)}%`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[12px] text-ink-soft">Max chance</p>
            <p className="font-num mt-1 text-[35.5px]">{maxPct}%</p>
          </div>
        </div>
        <input
          type="range"
          min={5}
          max={95}
          value={maxPct}
          onChange={(e) => setMaxPct(Number(e.target.value))}
          aria-label="Max odds you will cover"
          className="w-full"
        />
        <p className="text-[12px] text-ink-soft">Sales pause above your max.</p>
      </Section>

      <Section n={4} title="Coupons">
        <Stepper
          label="How many coupons"
          value={coupons}
          min={10}
          max={1000}
          step={10}
          onChange={setCoupons}
        />
      </Section>

      <section className="mt-6 rounded-[24px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
        <p className="text-[13.5px] font-semibold text-ink-soft">Cost to cover one sale</p>
        <p className="font-num mt-1.5 text-[39px]">{perSale === null ? "–" : usd(perSale)}</p>
        <dl className="mt-3 space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">Covering {coupons} coupons</dt>
            <dd className="font-semibold tabular-nums">{budget === null ? "–" : usd(budget)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-soft">You keep on every sale</dt>
            <dd className="font-semibold tabular-nums">{keep === null ? "–" : usd(keep)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-ink-faint">
          Live price from Gemini. Simulated in this demo.
        </p>
      </section>

      <div className="mt-6 space-y-3">
        {!signedIn ? (
          <div className="rounded-[24px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
            <p className="font-title mb-3 text-[16px]">
              Sign in with your shop&apos;s email to publish
            </p>
            <LoginCard />
          </div>
        ) : (
          <>
            <Button size="lg" onClick={publish} busy={busy} disabled={errors.length > 0}>
              {busy && step ? STEP_TEXT[step] : "Publish promo"}
            </Button>
            {errors.length && !busy ? (
              <p className="text-center text-[12.5px] text-ink-soft">{errors[0]}</p>
            ) : null}
          </>
        )}
        {problem ? (
          <Note tone="error" title={problem.title}>
            {problem.detail}
            {draftSaved ? " The draft is saved: finish it from your workspace." : ""}
          </Note>
        ) : null}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-4 pb-16">
      <header className="flex h-[60px] items-center">
        <Link
          href="/merchant"
          aria-label="Back to workspace"
          className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          <IconBack size={22} />
        </Link>
      </header>
      {children}
    </main>
  );
}

function Section({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 space-y-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="font-num mt-px grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[13px] text-ink ring-1 ring-inset ring-rule"
        >
          {n}
        </span>
        <div>
          <h2 className="font-title text-[18px]">
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          {hint ? <p className="text-[12.5px] text-ink-soft">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] bg-surface-2 px-4 py-2.5 ring-1 ring-inset ring-rule">
      <span className="text-[13.5px] font-medium">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Fewer: ${label}`}
          onClick={() => onChange(clamp(value - step))}
          className="grid h-9 w-9 place-items-center rounded-full bg-surface-3 text-ink hover:bg-line-strong"
        >
          <IconMinus size={16} />
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/\D/g, ""));
            if (Number.isFinite(n)) onChange(clamp(n || min));
          }}
          className="font-num w-14 bg-transparent text-center text-[19.5px] text-ink focus:outline-none"
        />
        <button
          type="button"
          aria-label={`More: ${label}`}
          onClick={() => onChange(clamp(value + step))}
          className="grid h-9 w-9 place-items-center rounded-full bg-surface-3 text-ink hover:bg-line-strong"
        >
          <IconPlus size={16} />
        </button>
        {suffix ? <span className="ml-1 text-[12.5px] text-ink-soft">{suffix}</span> : null}
      </div>
    </div>
  );
}

function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
