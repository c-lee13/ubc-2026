"use client";

import type { MarketSummary, MarketWindow } from "@hedged/shared";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  describeDeadlineReason,
  type CreatePromotionDto,
  type PricedLineDto,
} from "@/lib/api";
import { api, chain } from "@/lib/client";
import { useWallet } from "@/lib/wallet/session";
import { describe, type Problem } from "@/lib/errors";
import { cents, clock, countdown, dateTime, dollarsToBase, marketMeaning, usd } from "@/lib/format";
import { store, useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import { Progress, type ProgressStep } from "../progress";
import { QrCode } from "../qr";
import {
  Button,
  ButtonLink,
  ChainLink,
  Field,
  inputClass,
  Notice,
  SimPanel,
  SimTag,
  Spinner,
} from "../ui";
import { LoginCard } from "../login-card";
import { Voucher } from "../voucher";

type Source =
  | { kind: "window"; marketId: string; window: MarketWindow }
  | { kind: "market"; marketId: string; market: MarketSummary };

/** Unfinished publish, kept so a closed tab can finish later (see the ledger's draft rows). */
export interface LocalDraft {
  promotionId: string;
  init: CreatePromotionDto["initializePromo"];
  /** bytes32 promo id, once the wallet approved creating it. */
  promoId?: string;
}
export const draftKey = (merchant: string) => `hedged:drafts:${merchant}`;

/** Time to approve the promo in the wallet and have the backend verify it before sales close. */
const MIN_LEAD_SECS = 150;

type StepKey = "check" | "draft" | "sign" | "verify";

export function Composer({ onPublished }: { onPublished: () => void }) {
  const wallet = useWallet();
  const signedIn = wallet.phase === "ready" && Boolean(wallet.wallet);
  const now = useNowSeconds();
  const origin = useOrigin();

  const [tab, setTab] = useState<"windows" | "search">("windows");
  const [source, setSource] = useState<Source | null>(null);
  const [shopName, setShopName] = useState("Hill Country Coffee");
  const [itemName, setItemName] = useState("Latte");
  const [price, setPrice] = useState("5");
  const [maxCost, setMaxCost] = useState("2.75");
  const [budget, setBudget] = useState("25");
  const [condition, setCondition] = useState("SOL closes up");
  const [customDeadline, setCustomDeadline] = useState<number | null>(null);

  const [steps, setSteps] = useState<Record<StepKey, ProgressStep["state"]>>({
    check: "todo",
    draft: "todo",
    sign: "todo",
    verify: "todo",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [published, setPublished] = useState<{
    promotionId: string;
    promoPda: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Remember the shop profile between promos.
  useEffect(() => {
    const saved = store.get<{ shopName: string; itemName: string }>("hedged:shop");
    if (saved) {
      setShopName(saved.shopName);
      setItemName(saved.itemName);
    }
  }, []);

  const windows = usePoll(() => api.windows("SOL", 5, 12), 15_000);
  const offerBase = dollarsToBase(price);
  // "Max cost per sale" is the merchant's words; the backend's cap is the YES price per $1 of refund.
  const maxCostBase = dollarsToBase(maxCost);
  const capMicro =
    offerBase && maxCostBase && BigInt(offerBase) > 0n && BigInt(maxCostBase) > 0n
      ? (() => {
          const c = (BigInt(maxCostBase) * 1_000_000n) / BigInt(offerBase);
          return c > 0n && c <= 1_000_000n ? c.toString() : null;
        })()
      : null;
  const capCents = capMicro ? cents(capMicro) : "–";
  const budgetBase = dollarsToBase(budget);

  const deadline =
    source?.kind === "window" ? source.window.recommendedDepositDeadline : customDeadline;

  // Auto-pick the first window that is still safely sellable.
  useEffect(() => {
    if (source || tab !== "windows" || !windows.data || now === null) return;
    const w = windows.data.windows.find((x) => windowUsable(x, now).ok);
    if (w) setSource({ kind: "window", marketId: w.marketId, window: w });
  }, [source, tab, windows.data, now]);

  const marketId = source?.marketId ?? null;
  const quote = usePoll(
    marketId && offerBase && capMicro ? () => api.quote(marketId, offerBase, capMicro) : null,
    10_000,
    [marketId, offerBase, capMicro],
  );
  const check = usePoll(
    marketId && deadline ? () => api.deadlineCheck(marketId, deadline) : null,
    20_000,
    [marketId, deadline],
  );

  // "Which line fits my max cost?": for a game, the backend prices every line and suggests one.
  const game =
    source?.kind === "market" && source.market.category === "Sports" ? source.market : null;
  const team = game ? game.outcomeLabel.replace(/ wins.*$/, "") : null;
  const suggestion = usePoll(
    game && team && offerBase && capMicro
      ? () => api.lines(game.eventTicker, team, offerBase, Number(BigInt(capMicro) / 100n))
      : null,
    0,
    [game?.eventTicker, team, offerBase, capMicro],
  );

  function applyLine(marketId: string, label: string) {
    if (source?.kind !== "market") return;
    setSource({
      kind: "market",
      marketId,
      market: { ...source.market, marketId, outcomeLabel: label },
    });
    setCondition(label);
  }

  function pickWindow(w: MarketWindow) {
    setSource({ kind: "window", marketId: w.marketId, window: w });
    setCondition("SOL closes up");
    setProblem(null);
  }

  async function pickMarket(m: MarketSummary) {
    setSource({ kind: "market", marketId: m.marketId, market: m });
    setCondition(
      m.category === "Sports" && /-M$/.test(m.eventTicker)
        ? `${m.outcomeLabel} wins`
        : m.outcomeLabel,
    );
    setCustomDeadline(null);
    setProblem(null);
    try {
      const probe = await api.deadlineCheck(m.marketId, Math.floor(Date.now() / 1000) + 120);
      if (probe.latest) setCustomDeadline(probe.latest);
      else setProblem({ title: "No safe deadline", detail: describeDeadlineReason(probe.reason) });
    } catch (err) {
      setProblem(describe(err));
    }
  }

  const formError = useMemo(() => {
    if (!source) return "Pick a market first.";
    if (!shopName.trim()) return "Add the shop name.";
    if (!itemName.trim()) return "Add the item.";
    if (!offerBase || BigInt(offerBase) <= 0n || BigInt(offerBase) > 1_000_000_000n)
      return "Price must be between $0.01 and $1,000.";
    if (!capMicro) return "Max cost per sale must be above $0 and at most the price.";
    if (!budgetBase) return "Budget must be a dollar amount.";
    if (!condition.trim()) return "Say what has to happen for the refund.";
    if (!deadline) return "Waiting for the market's deadline.";
    return null;
  }, [source, shopName, itemName, offerBase, capMicro, budgetBase, condition, deadline]);

  async function publish() {
    if (!signedIn || !wallet.wallet) return;
    if (formError || !source || !deadline || !offerBase || !capMicro || !budgetBase) return;
    const shop = wallet.wallet;
    setBusy(true);
    setProblem(null);
    setPublished(null);
    const set = (k: StepKey, v: ProgressStep["state"]) => setSteps((s) => ({ ...s, [k]: v }));
    setSteps({ check: "doing", draft: "todo", sign: "todo", verify: "todo" });
    let step: StepKey = "check";
    try {
      // 1. Deadline check right before the wallet approves (backend rule for this exact market).
      const fresh = await api.deadlineCheck(source.marketId, deadline);
      if (!fresh.ok) throw new Error(describeDeadlineReason(fresh.reason));
      if (deadline - Math.floor(Date.now() / 1000) < MIN_LEAD_SECS) {
        throw new Error("Sales would close before the promo can go live. Pick the next window.");
      }
      set("check", "done");

      // 2. Draft: the backend fixes the exact on-chain arguments (nonce, price, deadline, market).
      step = "draft";
      set("draft", "doing");
      store.set("hedged:shop", { shopName, itemName });
      const created = await api.createPromotion({
        merchant: shop.address,
        shopName: shopName.trim(),
        itemName: itemName.trim(),
        geminiMarketId: source.marketId,
        outcomeLabel: condition.trim(),
        offerAmount: offerBase,
        depositDeadline: deadline,
        maxYesPriceMicroUsd: capMicro,
        hedgeBudget: budgetBase,
      });
      const local: LocalDraft = {
        promotionId: created.promotion.id,
        init: created.initializePromo,
      };
      saveDraft(shop.address, local);
      set("draft", "done");

      // 3. The shop approves creating the promo on Arc (a Circle challenge).
      step = "sign";
      set("sign", "doing");
      const promoId = await approveCreate(created.promotion.id, shop.id, itemName, offerBase);
      saveDraft(shop.address, { ...local, promoId });
      set("sign", "done");
      setPublished({ promotionId: created.promotion.id, promoPda: promoId });

      // 4. The backend reads the promo from Arc and activates it if every field matches.
      step = "verify";
      set("verify", "doing");
      await confirmWithRetry(created.promotion.id, promoId);
      set("verify", "done");
      removeDraft(shop.address, created.promotion.id);
      onPublished();
    } catch (err) {
      set(step, "error");
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function approveCreate(
    promotionId: string,
    walletId: string,
    item: string,
    amount: string,
  ): Promise<string> {
    const ch = await api.initializePromo(promotionId, walletId);
    await wallet.execute(
      ch.challengeId,
      `Create the promo: ${item}, ${usd(amount)} with money back`,
    );
    return ch.promoId;
  }

  const shareUrl = published ? `${origin}/checkout/${published.promotionId}` : null;
  const publishedLive = steps.verify === "done" && published;

  const progress: ProgressStep[] = [
    { key: "check", label: "Deadline checked against the market", state: steps.check },
    { key: "draft", label: "Promo saved as a draft", state: steps.draft },
    {
      key: "sign",
      label: "Approved in your wallet",
      state: steps.sign,
      detail:
        steps.sign === "doing" ? "Approve creating the promo in the window that opened." : null,
    },
    {
      key: "verify",
      label: "Confirmed on Arc by the promo server, now live",
      state: steps.verify,
      detail:
        steps.verify === "doing" ? (
          "Arc confirms in about a second; the server then checks every field."
        ) : published && steps.verify === "done" && chain().reads ? (
          <ChainLink
            href={chain().explorerAddress(chain().reads!.escrow)}
            label="Escrow"
            value={chain().reads!.escrow}
          />
        ) : null,
    },
  ];

  const est = quote.data?.estimate;
  const ask = quote.data?.quote.yesAskMicroUsd;
  const meaning = marketId ? marketMeaning(marketId) : null;

  return (
    <section
      aria-labelledby="new-promo"
      className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-12"
    >
      <div className="min-w-0 space-y-9">
        <h2 id="new-promo" className="font-display text-[34px] md:text-[40px]">
          New promo
        </h2>

        {/* Step 1: market */}
        <Step n={1} title="Pick what decides the refund">
          <div role="tablist" className="mb-4 inline-flex rounded-lg bg-paper-deep p-1">
            {(["windows", "search"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3.5 py-1.5 text-[14px] font-semibold transition-colors ${tab === t ? "bg-paper-raised shadow-sm" : "text-ink-soft hover:text-ink"}`}
              >
                {t === "windows" ? "Next SOL windows" : "Any Gemini market"}
              </button>
            ))}
          </div>
          {tab === "windows" ? (
            <WindowList
              windows={windows.data?.windows ?? null}
              loading={windows.loading}
              error={windows.error}
              now={now}
              selected={source?.marketId ?? null}
              onPick={pickWindow}
            />
          ) : (
            <div className="space-y-3">
              <MarketSearch selected={source?.marketId ?? null} onPick={pickMarket} />
              {game ? (
                <SuggestedLine
                  loading={suggestion.loading}
                  error={suggestion.error}
                  suggested={suggestion.data?.suggested ?? null}
                  selected={source?.marketId ?? null}
                  maxCost={usd(maxCostBase)}
                  onUse={applyLine}
                />
              ) : null}
            </div>
          )}
        </Step>

        {/* Step 2: terms */}
        <Step n={2} title="Set the offer">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop name" htmlFor="shop">
              <input
                id="shop"
                className={inputClass}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label="Item" htmlFor="item">
              <input
                id="item"
                className={inputClass}
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                maxLength={60}
              />
            </Field>
            <Field label="Price and refund" htmlFor="price" hint="Customers pay in dollars.">
              <Money id="price" value={price} onChange={setPrice} />
            </Field>
            <Field
              label="Max cost per sale"
              htmlFor="maxcost"
              hint={
                capMicro
                  ? `${capCents} per $1 of refund. Above this the promo pauses instead of selling.`
                  : "Must be more than $0 and no more than the price."
              }
            >
              <Money id="maxcost" value={maxCost} onChange={setMaxCost} />
            </Field>
            <Field
              label="Fund the promo budget"
              htmlFor="budget"
              hint="Covers the hedge for every sale. Simulated funding: no money moves for the budget yet."
            >
              <Money id="budget" value={budget} onChange={setBudget} />
            </Field>
          </div>

          {source?.kind === "market" ? (
            <div className="mt-4">
              <Field
                label="Sales close"
                htmlFor="deadline"
                hint="No later than the market's last safe moment (kickoff for games)."
              >
                <input
                  id="deadline"
                  type="datetime-local"
                  className={inputClass}
                  value={customDeadline ? toLocalInput(customDeadline) : ""}
                  onChange={(e) => setCustomDeadline(fromLocalInput(e.target.value))}
                />
              </Field>
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <LiveQuote
              loading={quote.loading}
              error={quote.error}
              ask={ask ?? null}
              depth={quote.data?.quote.asks.reduce((s, a) => s + Number(a.quantity), 0) ?? null}
              fetchedAt={quote.data?.quote.fetchedAt ?? null}
              marketReady={Boolean(marketId)}
            />
            <SimPanel title="Cost to cover one sale">
              {est ? (
                est.status === "SIMULATED_FILLED" ? (
                  <div>
                    <p className="font-display text-[44px] leading-none">{usd(est.premium)}</p>
                    <p
                      className="mt-1.5 text-[14px] text-ink-soft"
                      title={`${est.filledContracts} contracts at ${cents(est.avgFillPriceMicroUsd)}, before the cost of the item`}
                    >
                      You keep {usd(BigInt(offerBase ?? "0") - BigInt(est.premium ?? "0"))} a sale
                      either way.
                    </p>
                  </div>
                ) : (
                  <p className="text-[14px] text-ink">
                    {est.failureReason === "QUOTE_OVER_CAP"
                      ? `${usd((BigInt(offerBase ?? "0") * BigInt(ask ?? "0") + 999_999n) / 1_000_000n)} a sale at ${cents(ask)}: over your ${usd(maxCostBase)} max. It would stay paused.`
                      : est.failureReason === "INSUFFICIENT_LIQUIDITY" ||
                          est.status === "SIMULATED_PARTIAL"
                        ? "Not enough on sale at your max."
                        : `Can't be covered right now (${est.failureReason ?? "no fill"}).`}
                  </p>
                )
              ) : (
                <p className="text-[14px] text-ink-soft">
                  {marketId ? "Pricing…" : "Pick a market."}
                </p>
              )}
            </SimPanel>
          </div>
        </Step>

        {/* Step 3: sign */}
        <Step n={3} title="Approve and publish">
          <div className="space-y-4">
            <DeadlineLine
              source={source}
              deadline={deadline}
              now={now}
              ok={check.data?.ok ?? null}
              reason={check.data?.reason}
              checking={check.loading}
              meaningClose={meaning?.closesAt ?? null}
            />
            {signedIn ? (
              <p className="text-[14px] text-ink-soft">
                Publishing as <strong className="text-ink">{wallet.email}</strong>
              </p>
            ) : (
              <div className="rounded-xl bg-paper-raised p-4 ring-1 ring-ink/15">
                <LoginCard title="Log in as the shop" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={publish}
                busy={busy}
                disabled={!signedIn || !!formError || check.data?.ok === false}
              >
                Publish promo
              </Button>
              {formError && signedIn ? (
                <span className="text-[14px] text-ink-soft">{formError}</span>
              ) : null}
            </div>
            {steps.check !== "todo" ? <Progress steps={progress} /> : null}
            {problem ? (
              <Notice tone="error" title={problem.title}>
                {problem.detail}
              </Notice>
            ) : null}
            {publishedLive && shareUrl ? (
              <div className="flex flex-wrap items-start gap-5 rounded-xl bg-note-soft/60 p-4 ring-1 ring-note/30">
                <div className="w-36 shrink-0 overflow-hidden rounded-lg ring-1 ring-ink/15">
                  <QrCode value={shareUrl} label={`QR code for ${shareUrl}`} className="w-full" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-semibold">Live. Customers scan this.</p>
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink size="sm" href={`/counter/${published!.promotionId}`}>
                      Open counter screen
                    </ButtonLink>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard?.writeText(shareUrl);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      }}
                    >
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Step>
      </div>

      {/* Live preview */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <p className="mb-3 text-[14px] font-semibold text-ink-soft">What customers will see</p>
        <Voucher
          seed={published?.promoPda ?? marketId ?? "preview"}
          shopName={shopName || "Your shop"}
          itemName={itemName || "item"}
          amount={offerBase ?? "0"}
          condition={condition || "it happens"}
          closesLabel={
            deadline
              ? `Sales close ${deadline - (now ?? 0) > 86_400 ? dateTime(deadline) : clock(deadline)}`
              : null
          }
          serial={published?.promoPda ?? null}
          marketId={marketId ?? "GEMI-…"}
          stamp={publishedLive ? { text: "LIVE", tone: "note" } : null}
        />
      </aside>
    </section>
  );
}

/* ---------- pieces ---------- */

function SuggestedLine({
  loading,
  error,
  suggested,
  selected,
  maxCost,
  onUse,
}: {
  loading: boolean;
  error: unknown;
  suggested: PricedLineDto | null;
  selected: string | null;
  maxCost: string;
  onUse: (marketId: string, label: string) => void;
}) {
  return (
    <div className="bg-hatch-soft rounded-xl px-4 py-3 ring-1 ring-sim/30">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-semibold">Suggested line for your max cost</p>
        <SimTag>Simulated hedge</SimTag>
      </div>
      {loading ? (
        <p className="mt-1 flex items-center gap-2 text-[14px] text-ink-soft">
          <Spinner /> Pricing every line of this game…
        </p>
      ) : error ? (
        <p className="mt-1 text-[14px] text-ink-soft">{describe(error).detail}</p>
      ) : suggested ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px]">
            <strong>{suggested.label}</strong> at {cents(suggested.bestAskMicroUsd)}: covering a
            sale costs {usd(suggested.costPerSale)}, within your {maxCost}. The most likely line
            that fits.
          </p>
          {selected === suggested.marketId ? (
            <span className="text-[13px] font-semibold text-note">Using this line</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onUse(suggested.marketId, suggested.label)}
            >
              Use this line
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-[14px] text-ink-soft">
          No line of this game fits {maxCost} per sale right now. Raise the max cost or pick another
          market.
        </p>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-center gap-3">
        <span className="font-display grid h-8 w-8 place-items-center rounded-full bg-ink text-[14px] text-paper-raised">
          {n}
        </span>
        <h3 className="text-[19px] font-bold">{title}</h3>
      </div>
      <div className="md:pl-11">{children}</div>
    </section>
  );
}

function Money({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft">
        $
      </span>
      <input
        id={id}
        inputMode="decimal"
        className={`${inputClass} pl-7`}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
      />
    </div>
  );
}

function windowUsable(w: MarketWindow, now: number): { ok: boolean; why?: string } {
  if (w.recommendedDepositDeadline - now < MIN_LEAD_SECS)
    return { ok: false, why: "Too late to sell" };
  if (!w.bestAskMicroUsd) return { ok: false, why: "No sellers yet" };
  return { ok: true };
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
    if (error) {
      const p = describe(error);
      return (
        <Notice tone="error" title={p.title}>
          {p.detail}
        </Notice>
      );
    }
    return (
      <p className="flex items-center gap-2 text-[14px] text-ink-soft">
        {loading ? <Spinner /> : null} Loading Gemini&apos;s next SOL windows…
      </p>
    );
  }
  if (windows.length === 0) {
    return (
      <Notice title="No SOL windows listed">
        Gemini lists them about an hour ahead. Try again shortly.
      </Notice>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl bg-paper-raised ring-1 ring-ink/15">
      <div className="grid grid-cols-[1.3fr_1.3fr_0.7fr_0.8fr] gap-3 border-b border-ink/10 px-4 py-2 text-[12.5px] text-ink-soft max-sm:hidden">
        <span>SOL window</span>
        <span title="5 minutes before the window opens, so nobody buys once the starting price is known">
          Sales close
        </span>
        <span className="text-right">Price</span>
        <span className="text-right">On sale</span>
      </div>
      <ul role="radiogroup" aria-label="SOL windows">
        {windows
          .filter((w) => now === null || windowUsable(w, now).ok)
          .slice(0, 6)
          .map((w) => {
            const use = now === null ? { ok: false } : windowUsable(w, now);
            const isSel = selected === w.marketId;
            return (
              <li key={w.marketId}>
                <button
                  role="radio"
                  aria-checked={isSel}
                  disabled={!use.ok}
                  onClick={() => onPick(w)}
                  className={`grid w-full grid-cols-2 items-center gap-x-3 gap-y-0.5 border-b border-ink/5 px-4 py-3 text-left text-[14.5px] last:border-b-0 sm:grid-cols-[1.3fr_1.3fr_0.7fr_0.8fr] ${isSel ? "bg-note-soft/70 shadow-[inset_3px_0_0_var(--color-note)]" : use.ok ? "hover:bg-paper-deep/60" : "cursor-not-allowed text-ink-faint"}`}
                >
                  <span className="font-semibold">
                    {clock(w.opensAt)} to {clock(w.expiresAt)}
                  </span>
                  <span className="max-sm:text-right">
                    {clock(w.recommendedDepositDeadline)}{" "}
                    {now !== null && w.recommendedDepositDeadline > now ? (
                      <span className="text-ink-soft">
                        (in {countdown(w.recommendedDepositDeadline - now)})
                      </span>
                    ) : (
                      <span className="text-ink-faint">(closed)</span>
                    )}
                  </span>
                  <span className="font-semibold sm:text-right">
                    {w.bestAskMicroUsd ? cents(w.bestAskMicroUsd) : "–"}
                  </span>
                  <span className="text-ink-soft max-sm:text-right sm:text-right">
                    {use.ok ? `${Number(w.askDepthContracts).toLocaleString()} contracts` : use.why}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
    </div>
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
        className={inputClass}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Team, coin, event…"
      />
      {res.error ? (
        <Notice tone="error" title={describe(res.error).title}>
          {describe(res.error).detail}
        </Notice>
      ) : res.loading ? (
        <p className="flex items-center gap-2 text-[14px] text-ink-soft">
          <Spinner /> Searching Gemini…
        </p>
      ) : open.length === 0 ? (
        <p className="text-[14px] text-ink-soft">No open markets match.</p>
      ) : (
        <ul
          role="radiogroup"
          aria-label="Gemini markets"
          className="overflow-hidden rounded-xl bg-paper-raised ring-1 ring-ink/15"
        >
          {open.map((m) => (
            <li key={m.marketId}>
              <button
                role="radio"
                aria-checked={selected === m.marketId}
                onClick={() => onPick(m)}
                className={`flex w-full items-center justify-between gap-4 border-b border-ink/5 px-4 py-3 text-left last:border-b-0 ${selected === m.marketId ? "bg-note-soft/70 shadow-[inset_3px_0_0_var(--color-note)]" : "hover:bg-paper-deep/60"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{m.outcomeLabel}</span>
                  <span className="block truncate text-[13px] text-ink-soft">
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

function LiveQuote({
  loading,
  error,
  ask,
  depth,
  fetchedAt: _fetchedAt,
  marketReady,
}: {
  loading: boolean;
  error: unknown;
  ask: string | null;
  depth: number | null;
  fetchedAt: string | null;
  marketReady: boolean;
}) {
  return (
    <section className="rounded-xl bg-paper-raised ring-1 ring-ink/15">
      <header className="flex items-center justify-between border-b border-ink/10 px-4 py-2">
        <h3 className="text-[14px] font-semibold">Live price on Gemini</h3>
      </header>
      <div className="px-4 py-3">
        {!marketReady ? (
          <p className="text-[14px] text-ink-soft">Pick a market.</p>
        ) : error && !ask ? (
          <p className="text-[14px] text-ink">{describe(error).detail}</p>
        ) : ask ? (
          <>
            <p className="font-display text-[44px] leading-none">{cents(ask)}</p>
            <p className="mt-1.5 text-[14px] text-ink-soft">
              {Number(ask) / 10_000}% chance
              {depth !== null ? `, ${depth.toLocaleString()} on sale` : ""}
            </p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-[14px] text-ink-soft">
            {loading ? <Spinner /> : null} Reading the order book…
          </p>
        )}
      </div>
    </section>
  );
}

function DeadlineLine({
  source,
  deadline,
  now,
  ok,
  reason,
  checking,
  meaningClose,
}: {
  source: Source | null;
  deadline: number | null;
  now: number | null;
  ok: boolean | null;
  reason?: Parameters<typeof describeDeadlineReason>[0];
  checking: boolean;
  meaningClose: number | null;
}) {
  if (!source || !deadline) return null;
  const left = now === null ? null : deadline - now;
  return (
    <div
      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl bg-paper-raised px-4 py-3 ring-1 ring-ink/15"
      title={
        meaningClose
          ? `The answer comes when the window ends at ${clock(meaningClose)}.`
          : undefined
      }
    >
      <p className="text-[16px]">
        Sales close{" "}
        <strong>{left !== null && left > 86_400 ? dateTime(deadline) : clock(deadline)}</strong>
        {left !== null && left > 0 ? (
          <span className="text-ink-soft"> ({countdown(left)})</span>
        ) : null}
      </p>
      <p
        className={`flex items-center gap-1.5 text-[14px] font-semibold ${ok === false ? "text-stamp" : "text-note"}`}
        title={ok === false ? describeDeadlineReason(reason) : undefined}
      >
        {checking && ok === null ? (
          <Spinner />
        ) : ok ? (
          <svg
            viewBox="0 0 12 12"
            className="h-4 w-4"
            role="img"
            aria-label="Deadline check passed"
          >
            <title>Deadline check passed</title>
            <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ) : ok === false ? (
          "Deadline not allowed"
        ) : null}
      </p>
    </div>
  );
}

async function confirmWithRetry(promotionId: string, promoPda: string): Promise<void> {
  const end = Date.now() + 75_000;
  for (;;) {
    try {
      await api.confirmPromotion(promotionId, promoPda);
      return;
    } catch (err) {
      const retry = err instanceof ApiError && err.code === "promo_not_found_on_chain_yet";
      if (!retry || Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function saveDraft(merchant: string, d: LocalDraft) {
  const all = store.get<LocalDraft[]>(draftKey(merchant)) ?? [];
  store.set(draftKey(merchant), [...all.filter((x) => x.promotionId !== d.promotionId), d]);
}

function removeDraft(merchant: string, promotionId: string) {
  const all = store.get<LocalDraft[]>(draftKey(merchant)) ?? [];
  store.set(
    draftKey(merchant),
    all.filter((x) => x.promotionId !== promotionId),
  );
}

export { confirmWithRetry, removeDraft, saveDraft };

function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(v: string): number | null {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}
