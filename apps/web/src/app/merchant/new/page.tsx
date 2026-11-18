"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { describeDeadlineReason } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import {
  cents,
  chance,
  clock,
  dateTime,
  dollarsToBase,
  USDC_DECIMALS,
  usd,
  usdExact,
} from "@/lib/format";
import { store, useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import {
  MIN_LEAD_SECS,
  confirmWithRetry,
  removeDraft,
  saveDraft,
  type LocalDraft,
} from "@/lib/merchant";
import { useWallet } from "@/lib/wallet/session";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { LogoMark } from "@/components/layout/LogoMark";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import {
  BACK_LINK,
  BRAND_HAIRLINE,
  BTN_SMALL,
  DISPLAY,
  EYEBROW,
  EYEBROW_RULE,
  FOCUS,
  LINK,
  PILL_ORANGE,
  PILL_PURPLE,
} from "@/components/layout/styles";
import { LoginCard } from "@/components/login-card";
import { MarketPicker, type PickedMarket } from "@/components/merchant/MarketPicker";
import { Progress, type ProgressStep } from "@/components/progress";
import { QrCode } from "@/components/qr";
import { ChainLink, Notice, SimTag, Spinner } from "@/components/ui";
import { NetworkNote } from "@/components/wallet/NetworkNote";

// Create a promotion: Zahin's form and live customer preview, wired to the real publish flow:
//   1. deadline check against the exact Gemini market   GET  /api/markets/:id/deadline-check
//   2. draft with the exact on-chain arguments          POST /api/promotions
//   3. the shop approves creating it on Arc             POST /api/promotions/:id/initialize
//      (PROPOSED route, not in apps/api yet) + Circle's approval window
//   4. the server reads it back from Arc, turns it on   POST /api/promotions/:id/confirm
// Inputs stay plain strings; amounts convert to 6-decimal USDC base units with BigInt (no floats).
// The backend has no promotion name or description: the shop name and the item take their place.

type FormValues = {
  shopName: string;
  itemName: string;
  price: string;
  marketId: string;
  refundTrigger: string;
  maxHedgePrice: string;
  budget: string;
};
type FieldKey = keyof FormValues | "expiresAt";
type FormErrors = Partial<Record<FieldKey, string>>;

// Digits with an optional decimal part: "5", "5.25", ".5". No signs, commas or exponents ("1e3").
const DECIMAL_RE = /^(\d+(\.\d*)?|\.\d+)$/;
/** The promo server's cap on one item's price: $1,000. */
const MAX_PRICE = 1_000_000_000n;

/** Returns an error message for a text field that is empty, only whitespace, or too long. */
function requiredText(value: string, label: string, max: number): string | undefined {
  if (value.trim() === "") return `${label} is required.`;
  return value.length > max ? `${label} must be ${max} characters or fewer.` : undefined;
}

/** A positive amount with at most 6 decimals that fits `max` base units, or an error message. */
function amountError(raw: string, label: string, max?: bigint): string | undefined {
  const value = raw.trim();
  if (value === "") return `${label} is required.`;
  if (!DECIMAL_RE.test(value)) return "Enter a valid number, like 5 or 5.25.";
  const frac = value.split(".")[1] ?? "";
  if (frac.length > USDC_DECIMALS) return `Use at most ${USDC_DECIMALS} decimal places.`;
  const base = dollarsToBase(value);
  if (base === null) return `${label} is too large.`;
  if (BigInt(base) === 0n) return `${label} must be greater than 0.`;
  if (max !== undefined && BigInt(base) > max)
    return `${label} is too large. The maximum is ${usd(max)}.`;
  return undefined;
}

/** Price per $1 of payout: greater than 0 and at most 1. */
function hedgePriceError(raw: string): string | undefined {
  const err = amountError(raw, "Maximum hedge price");
  if (err) return err;
  return BigInt(dollarsToBase(raw)!) > 1_000_000n
    ? "Maximum hedge price cannot be more than 1 ($1 payout)."
    : undefined;
}

function validate(form: FormValues, deadline: number | null, now: number): FormErrors {
  return {
    shopName: requiredText(form.shopName, "Shop name", 80),
    itemName: requiredText(form.itemName, "Item", 60),
    price: amountError(form.price, "Purchase price", MAX_PRICE),
    marketId: requiredText(form.marketId, "Gemini market ID", 64),
    refundTrigger: requiredText(form.refundTrigger, "Refund trigger", 120),
    maxHedgePrice: hedgePriceError(form.maxHedgePrice),
    budget: amountError(form.budget, "Promotion budget"),
    expiresAt:
      deadline === null
        ? "Promotion expiration is required."
        : deadline - now < MIN_LEAD_SECS
          ? "Sales must stay open at least 2½ minutes, so the promo can go live first."
          : undefined,
  };
}

// 16px on mobile (no iOS focus-zoom), 14px from sm up. Placeholder text is >= 4.5:1 on white.
const INPUT_BASE =
  "mt-2 block w-full rounded-[10px] border bg-white px-3.5 py-2.5 text-base text-[#211D28] placeholder:text-[#6B6575] sm:text-sm focus:outline-none focus:ring-2";
const INPUT_OK = "border-[#CFC8BC] focus:border-[#6133A7] focus:ring-[#6133A7]/20";
const INPUT_INVALID = "border-[#C4372B] focus:border-[#C4372B] focus:ring-[#C4372B]/20";

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-[#211D28]">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-semibold text-[#B3261E]">
          {error}
        </p>
      )}
      <p id={`${id}-help`} className="mt-1.5 text-xs leading-relaxed text-[#5A5463]">
        {help}
      </p>
    </div>
  );
}

/** One numbered step of the form: a ruled section with a large numeral, not a card. */
function Step({
  n,
  title,
  intro,
  children,
}: {
  n: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`step-${n}-heading`}
      className="border-t border-[#E6E1D8] py-9 first:border-t-2 first:border-[#211D28]"
    >
      <div className="flex items-baseline gap-4">
        <span
          aria-hidden
          className={`${DISPLAY} text-[2.6rem] font-light leading-none tracking-[-0.05em] tabular-nums text-[#6133A7]`}
        >
          {n}
        </span>
        <div>
          <h2
            id={`step-${n}-heading`}
            className={`${DISPLAY} text-[1.5rem] font-semibold leading-tight tracking-[-0.025em]`}
          >
            {title}
          </h2>
          <p className="mt-1 text-[15px] leading-relaxed text-[#5A5463]">{intro}</p>
        </div>
      </div>
      <div className="mt-7 grid gap-x-6 gap-y-6 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function toLocalInput(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(v: string): number | null {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

type StepKey = "check" | "draft" | "sign" | "verify";

export default function NewPromotionPage() {
  const wallet = useWallet();
  const signedIn = wallet.phase === "ready" && Boolean(wallet.wallet);
  const now = useNowSeconds();
  const origin = useOrigin();

  // Demo-ready defaults (the prototype's); the shop name and item are remembered per browser.
  const [form, setForm] = useState<FormValues>({
    shopName: "Hill Country Coffee",
    itemName: "Latte",
    price: "5",
    marketId: "",
    refundTrigger: "",
    maxHedgePrice: "0.55",
    budget: "25",
  });
  const [picked, setPicked] = useState<PickedMarket | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  // A field is "touched" once the user has left it (blur). Errors only show for touched fields.
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [steps, setSteps] = useState<Record<StepKey, ProgressStep["state"]>>({
    check: "todo",
    draft: "todo",
    sign: "todo",
    verify: "todo",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [published, setPublished] = useState<{ promotionId: string; promoPda: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const saved = store.get<{ shopName: string; itemName: string }>("hedged:shop");
    if (saved) setForm((f) => ({ ...f, shopName: saved.shopName, itemName: saved.itemName }));
  }, []);

  const set = (key: keyof FormValues, value: string) => setForm((f) => ({ ...f, [key]: value }));

  // Picking a market fills the market ID, the refund trigger and the latest safe deadline.
  const onPick = useCallback((m: PickedMarket) => {
    setPicked(m);
    setProblem(null);
    if (m.kind === "window") {
      setForm((f) => ({ ...f, marketId: m.marketId, refundTrigger: "SOL closes up" }));
      setDeadline(m.window.recommendedDepositDeadline);
      return;
    }
    const trigger =
      m.market.category === "Sports" && /-M$/.test(m.market.eventTicker)
        ? `${m.market.outcomeLabel} wins`
        : m.market.outcomeLabel;
    setForm((f) => ({ ...f, marketId: m.marketId, refundTrigger: trigger }));
    setDeadline(null);
    void api
      .deadlineCheck(m.marketId, Math.floor(Date.now() / 1000) + 120)
      .then((probe) => {
        if (probe.latest) setDeadline(probe.latest);
        else
          setProblem({ title: "No safe deadline", detail: describeDeadlineReason(probe.reason) });
      })
      .catch((err) => setProblem(describe(err)));
  }, []);

  const offerBase = amountError(form.price, "Purchase price", MAX_PRICE)
    ? null
    : dollarsToBase(form.price);
  const capMicro = hedgePriceError(form.maxHedgePrice) ? null : dollarsToBase(form.maxHedgePrice);
  const budgetBase = amountError(form.budget, "Promotion budget")
    ? null
    : dollarsToBase(form.budget);
  const marketId = form.marketId.trim() || null;

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

  // Errors are recomputed from the current values on every render.
  const allErrors = validate(form, deadline, now ?? Math.floor(Date.now() / 1000));
  if (!allErrors.expiresAt && check.data && !check.data.ok) {
    allErrors.expiresAt = describeDeadlineReason(check.data.reason);
  }
  const errorFor = (key: FieldKey) => (touched[key] ? allErrors[key] : undefined);

  const inputProps = (key: keyof FormValues) => {
    const error = errorFor(key);
    return {
      id: key,
      value: form[key],
      className: `${INPUT_BASE} ${error ? INPUT_INVALID : INPUT_OK}`,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        set(key, e.target.value);
        if (key === "marketId") setPicked(null);
      },
      onBlur: () => setTouched((prev) => ({ ...prev, [key]: true })),
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? `${key}-error ${key}-help` : `${key}-help`,
    };
  };

  // Runs for the Publish button AND the Enter key (both submit the form).
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const screenOrder: FieldKey[] = [
      "shopName",
      "itemName",
      "price",
      "marketId",
      "refundTrigger",
      "expiresAt",
      "maxHedgePrice",
      "budget",
    ];
    setTouched(Object.fromEntries(screenOrder.map((k) => [k, true])));
    const firstInvalid = screenOrder.find((key) => allErrors[key]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    if (
      !signedIn ||
      !wallet.wallet ||
      !marketId ||
      !deadline ||
      !offerBase ||
      !capMicro ||
      !budgetBase
    ) {
      return;
    }
    const shop = wallet.wallet;
    setBusy(true);
    setProblem(null);
    setPublished(null);
    const mark = (k: StepKey, v: ProgressStep["state"]) => setSteps((s) => ({ ...s, [k]: v }));
    setSteps({ check: "doing", draft: "todo", sign: "todo", verify: "todo" });
    let step: StepKey = "check";
    try {
      // 1. Deadline check right before the wallet approves (backend rule for this exact market).
      const fresh = await api.deadlineCheck(marketId, deadline);
      if (!fresh.ok) throw new Error(describeDeadlineReason(fresh.reason));
      if (deadline - Math.floor(Date.now() / 1000) < MIN_LEAD_SECS) {
        throw new Error("Sales would close before the promo can go live. Pick the next window.");
      }
      mark("check", "done");

      // 2. Draft: the backend fixes the exact on-chain arguments (nonce, price, deadline, market).
      step = "draft";
      mark("draft", "doing");
      store.set("hedged:shop", { shopName: form.shopName.trim(), itemName: form.itemName.trim() });
      const created = await api.createPromotion({
        merchant: shop.address,
        shopName: form.shopName.trim(),
        itemName: form.itemName.trim(),
        geminiMarketId: marketId,
        outcomeLabel: form.refundTrigger.trim(),
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
      mark("draft", "done");

      // 3. The shop approves creating the promo on Arc (a Circle challenge).
      step = "sign";
      mark("sign", "doing");
      const ch = await api.initializePromo(created.promotion.id, shop.id);
      await wallet.execute(
        ch.challengeId,
        `Create the promo: ${form.itemName.trim()}, ${usdExact(offerBase)} with money back`,
      );
      saveDraft(shop.address, { ...local, promoId: ch.promoId });
      mark("sign", "done");
      setPublished({ promotionId: created.promotion.id, promoPda: ch.promoId });

      // 4. The backend reads the promo from Arc and activates it if every field matches.
      step = "verify";
      mark("verify", "doing");
      await confirmWithRetry(created.promotion.id, ch.promoId);
      mark("verify", "done");
      removeDraft(shop.address, created.promotion.id);
    } catch (err) {
      mark(step, "error");
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  };

  const progress: ProgressStep[] = [
    { key: "check", label: "Deadline checked against the market", state: steps.check },
    { key: "draft", label: "Saved as a draft on the promo server", state: steps.draft },
    {
      key: "sign",
      label: "Approved in Circle's window",
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
        ) : steps.verify === "done" && chain().reads ? (
          <ChainLink
            href={chain().explorerAddress(chain().reads!.escrow)}
            label="Escrow"
            value={chain().reads!.escrow}
          />
        ) : null,
    },
  ];

  const live = steps.verify === "done" && published;
  const shareUrl = published ? `${origin}/checkout/${published.promotionId}` : null;
  const est = quote.data?.estimate;
  const ask = quote.data?.quote.yesAskMicroUsd ?? null;
  const price = offerBase ? usdExact(offerBase) : null;

  return (
    <>
      <DisclosureStrip />

      {/* Shared header. Its account control sits OUTSIDE the <form>, so it can never submit it. */}
      <SiteHeader current="promotions" />

      <main>
        {/* Intro: compact. Headline on the left, the shop login on the right. */}
        <section className="mx-auto grid max-w-[1240px] gap-8 px-5 pb-10 pt-4 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-12 lg:pt-6">
          <div className="lg:col-span-7">
            <Link href="/merchant" className={BACK_LINK}>
              ← Back to Dashboard
            </Link>

            <p className={`mt-6 ${EYEBROW}`}>
              <span aria-hidden className={EYEBROW_RULE} />
              Create a promotion
            </p>
            <h1
              className={`${DISPLAY} mt-5 text-[clamp(2.5rem,5vw,4.1rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
            >
              Give them something to root for.
            </h1>
            <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-[#5A5463]">
              Design an offer, choose its outcome, and see how customers will experience it.
            </p>
            <a
              href="#preview-heading"
              className={`mt-4 inline-block text-sm font-semibold text-[#6133A7] underline underline-offset-4 lg:hidden ${FOCUS}`}
            >
              Jump to the customer preview
            </a>
          </div>

          {/* Utility area: the shop's email login. Outside the <form>. */}
          <div className="lg:col-span-5 lg:self-end">
            <p className="text-sm font-semibold">Shop login</p>
            {signedIn ? (
              <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
                Publishing as <strong className="text-[#211D28]">{wallet.email}</strong>. You
                approve the promo in Circle&apos;s window; nothing is signed for you.
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
                  Log in with the shop&apos;s email to publish. Circle makes the shop&apos;s wallet
                  on Arc testnet; filling in the form needs no login.
                </p>
                <div className="mt-3">
                  <LoginCard compact cta="Log in as the shop" />
                </div>
              </>
            )}
            <NetworkNote />
          </div>
        </section>

        <div className="mx-auto grid max-w-[1240px] gap-14 px-5 pb-20 sm:px-8 lg:grid-cols-12 lg:gap-12 lg:pb-28">
          {/* Configuration form */}
          <form className="lg:col-span-7" onSubmit={handleSubmit} noValidate>
            <Step n="01" title="The offer" intro="Who is selling, what, and what customers pay.">
              <div className="sm:col-span-2">
                <Field
                  id="shopName"
                  error={errorFor("shopName")}
                  label="Shop Name"
                  help="Shown to your customers on the offer and the receipt."
                >
                  <input
                    {...inputProps("shopName")}
                    type="text"
                    placeholder="Hill Country Coffee"
                  />
                </Field>
              </div>
              <Field
                id="itemName"
                error={errorFor("itemName")}
                label="Item"
                help="What the customer is buying. Any product or service works."
              >
                <input {...inputProps("itemName")} type="text" placeholder="Latte" />
              </Field>
              <Field
                id="price"
                error={errorFor("price")}
                label="Purchase Price (test USDC)"
                help="Each customer pays this into escrow, and gets it back if the trigger occurs. Arc testnet USDC, no value."
              >
                <input
                  {...inputProps("price")}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                />
              </Field>
            </Step>

            <Step
              n="02"
              title="The outcome"
              intro="The Gemini market that decides whether customers are refunded."
            >
              <MarketPicker
                selected={picked}
                onPick={onPick}
                offerBase={offerBase}
                capMicro={capMicro}
                onUseLine={(id, label) => {
                  if (picked?.kind !== "market") return;
                  setPicked({
                    kind: "market",
                    marketId: id,
                    market: { ...picked.market, marketId: id, outcomeLabel: label },
                  });
                  setForm((f) => ({ ...f, marketId: id, refundTrigger: label }));
                }}
              />
              <Field
                id="marketId"
                error={errorFor("marketId")}
                label="Gemini Market ID"
                help="Filled in when you pick a market above. You can also paste an exact market identifier."
              >
                <input {...inputProps("marketId")} type="text" placeholder="Market identifier" />
              </Field>
              <Field
                id="refundTrigger"
                error={errorFor("refundTrigger")}
                label="Refund Trigger"
                help="A readable label for the outcome that earns customers a refund. Customers are refunded if the market resolves YES."
              >
                <input
                  {...inputProps("refundTrigger")}
                  type="text"
                  placeholder="Outcome that triggers a refund"
                />
              </Field>
            </Step>

            <Step
              n="03"
              title="The limits"
              intro="When sales close, and off-chain guardrails for the simulated hedge. These are not escrowed funds."
            >
              <div className="sm:col-span-2">
                <Field
                  id="expiresAt"
                  error={errorFor("expiresAt")}
                  label="Promotion Expiration"
                  help={
                    picked?.kind === "window" ? (
                      "Set by the SOL window: 5 minutes before it opens, so nobody buys once the starting price is known."
                    ) : check.data?.ok ? (
                      <span className="font-semibold text-[#14513A]">
                        Checked against this market: allowed.
                      </span>
                    ) : (
                      "Deadline for purchases. No later than the market's last safe moment (kickoff for games)."
                    )
                  }
                >
                  <input
                    id="expiresAt"
                    type="datetime-local"
                    value={deadline ? toLocalInput(deadline) : ""}
                    onChange={(e) => setDeadline(fromLocalInput(e.target.value))}
                    onBlur={() => setTouched((prev) => ({ ...prev, expiresAt: true }))}
                    aria-invalid={errorFor("expiresAt") ? true : undefined}
                    aria-describedby={
                      errorFor("expiresAt") ? "expiresAt-error expiresAt-help" : "expiresAt-help"
                    }
                    className={`${INPUT_BASE} ${errorFor("expiresAt") ? INPUT_INVALID : INPUT_OK}`}
                  />
                </Field>
              </div>
              <Field
                id="maxHedgePrice"
                error={errorFor("maxHedgePrice")}
                label="Maximum Hedge Price (USD per $1 payout)"
                help="The most you would pay per $1 of simulated payout. Above this the promo pauses instead of selling."
              >
                <input
                  {...inputProps("maxHedgePrice")}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="1"
                  step="any"
                  placeholder="0.00"
                />
              </Field>
              <Field
                id="budget"
                error={errorFor("budget")}
                label="Promotion Budget (test USDC)"
                help="Your cap on total simulated hedge spending across all purchases. Separate from customer payments held in escrow on Arc."
              >
                <input
                  {...inputProps("budget")}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                />
              </Field>

              {/* Live market check: Gemini's price now and the simulated cost of covering a sale */}
              <div className="sm:col-span-2">
                <p className="text-sm font-semibold">Live market check</p>
                <dl className="mt-2 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
                  <div className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-[#5A5463]">Gemini YES price now</dt>
                    <dd className="text-right font-medium">
                      {!marketId ? (
                        "Pick a market"
                      ) : ask ? (
                        `${cents(ask)} (${chance(ask)} chance it's free)`
                      ) : quote.error ? (
                        describe(quote.error).title
                      ) : (
                        <Spinner />
                      )}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-[#5A5463]">
                      Cost to cover one sale <SimTag>simulated</SimTag>
                    </dt>
                    <dd className="text-right font-medium">
                      {!est
                        ? "–"
                        : est.status === "SIMULATED_FILLED"
                          ? usd(est.premium)
                          : est.failureReason === "QUOTE_OVER_CAP"
                            ? "Over your max price: it would stay paused"
                            : "Can't be covered right now"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-[#5A5463]">
                      You keep a sale, either way <SimTag>simulated</SimTag>
                    </dt>
                    <dd className="text-right font-medium">
                      {est?.status === "SIMULATED_FILLED" && offerBase
                        ? usd(BigInt(offerBase) - BigInt(est.premium ?? "0"))
                        : "–"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-1.5 text-xs leading-relaxed text-[#5A5463]">
                  Priced from Gemini&apos;s live order book, before the cost of the item. No order
                  is ever placed.
                </p>
              </div>
            </Step>

            {/* Primary action */}
            <div className="border-t border-[#E6E1D8] pt-9">
              <button
                type="submit"
                disabled={busy || !signedIn || Boolean(live)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#6133A7] px-9 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-[#4E2890] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7] disabled:cursor-not-allowed disabled:bg-[#E6E1D8] disabled:text-[#5A5463] disabled:shadow-none"
              >
                {busy ? <Spinner /> : null}
                {live ? "Published" : signedIn ? "Publish promotion" : "Log in to publish"}
              </button>
              <ul className="mt-5 max-w-xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[#5A5463]">
                <li>
                  Publishing asks for one approval in Circle&apos;s window, from the shop&apos;s
                  email wallet.
                </li>
                <li>
                  The promo server checks the deadline against the market, saves a draft, and turns
                  the promo on only after reading it back from Arc.
                </li>
                <li>Hedging is simulated from Gemini&apos;s live prices. No order is placed.</li>
              </ul>

              {steps.check !== "todo" ? (
                <div className="mt-6 max-w-xl">
                  <Progress steps={progress} />
                </div>
              ) : null}

              <div role="status" aria-live="polite">
                {problem ? (
                  <div className="mt-5 max-w-xl">
                    <Notice tone="error" title={problem.title}>
                      {problem.detail}
                      {steps.draft === "done" && steps.verify !== "done" ? (
                        <>
                          {" "}
                          The draft is saved: you can finish it from the{" "}
                          <Link href="/merchant" className={LINK}>
                            dashboard
                          </Link>
                          .
                        </>
                      ) : null}
                    </Notice>
                  </div>
                ) : null}
                {live && shareUrl ? (
                  <div className="mt-5 flex max-w-xl flex-wrap items-start gap-5 border-l-[3px] border-[#1E8A5A] bg-[#EAF6F0] p-4 text-sm leading-relaxed text-[#14513A]">
                    <div className="w-32 shrink-0 overflow-hidden rounded-lg ring-1 ring-[#211D28]/15">
                      <QrCode
                        value={shareUrl}
                        label={`QR code for ${shareUrl}`}
                        className="w-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="font-semibold">Live on Arc. Customers scan this.</p>
                      <p className="break-all text-xs">{shareUrl}</p>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/counter/${published!.promotionId}`} className={BTN_SMALL}>
                          Open counter screen
                        </Link>
                        <button
                          type="button"
                          className={BTN_SMALL}
                          onClick={() => {
                            void navigator.clipboard?.writeText(shareUrl);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1600);
                          }}
                        >
                          {copied ? "Copied" : "Copy link"}
                        </button>
                      </div>
                      <p>
                        <Link href="/merchant" className={LINK}>
                          See it on the dashboard
                        </Link>
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </form>

          {/* Live customer preview: a ticket, sticky beside the form on large screens */}
          <aside
            aria-labelledby="preview-heading"
            className="lg:sticky lg:top-6 lg:col-span-5 lg:self-start"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2
                id="preview-heading"
                className={`${DISPLAY} scroll-mt-4 text-[1.5rem] font-semibold leading-tight tracking-[-0.025em]`}
              >
                Customer Preview
              </h2>
              <span className={live ? PILL_PURPLE : PILL_ORANGE}>
                {live ? "Live now" : "Preview"}
              </span>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">
              How your offer will look to customers. Updates as you type.
            </p>

            <article
              aria-label="Customer offer preview"
              className="relative mt-5 overflow-hidden rounded-[20px] border border-[#E6E1D8] bg-white shadow-[0_1px_0_rgba(33,29,40,0.04),0_28px_56px_-28px_rgba(33,29,40,0.32)]"
            >
              <div aria-hidden className={`h-[3px] ${BRAND_HAIRLINE}`} />
              <div className="p-6">
                <div className="flex items-center gap-2.5">
                  <LogoMark className="h-7 w-7 rounded-lg" />
                  <span className={`${DISPLAY} text-sm font-bold tracking-[-0.01em]`}>
                    Wincentive offer
                  </span>
                  <span
                    aria-hidden
                    className="ml-auto h-3.5 w-3.5 rounded-full border-2 border-[#CFC8BC]"
                  />
                </div>

                <h3
                  className={`${DISPLAY} mt-5 break-words text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em]`}
                >
                  {form.itemName.trim() || <span className="italic text-[#5A5463]">Your item</span>}
                </h3>
                <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed text-[#4E4858]">
                  {form.shopName.trim() || (
                    <span className="italic text-[#5A5463]">Your shop name will appear here.</span>
                  )}
                </p>

                <div className="mt-5 flex items-end justify-between gap-4">
                  <p className="text-xs font-medium text-[#5A5463]">Purchase price</p>
                  <div className="text-right">
                    <p
                      className={`${DISPLAY} text-[2.4rem] font-semibold leading-none tracking-[-0.04em] tabular-nums`}
                    >
                      {price ?? <span className="text-[#6B6575]">—</span>}
                    </p>
                    <p className="mt-1 text-xs text-[#5A5463]">test USDC on Arc testnet</p>
                  </div>
                </div>

                <div aria-hidden className="my-5 border-t border-dashed border-[#CFC8BC]" />

                <div>
                  <p className="text-xs font-medium text-[#5A5463]">Refund condition</p>
                  <p className="mt-1 break-words text-[15px] leading-relaxed text-[#211D28]">
                    If{" "}
                    {form.refundTrigger.trim() ? (
                      <strong className="font-semibold">{form.refundTrigger.trim()}</strong>
                    ) : (
                      <span className="italic text-[#5A5463]">your refund trigger happens</span>
                    )}
                    , you receive your purchase amount back.
                  </p>
                  {deadline ? (
                    <p className="mt-2 text-xs text-[#5A5463]">
                      Sales close{" "}
                      {now !== null && deadline - now > 86_400
                        ? dateTime(deadline)
                        : clock(deadline)}
                    </p>
                  ) : null}
                </div>
              </div>

              <p className="border-t border-[#E6E1D8] bg-[#FAF9F6] px-6 py-4 text-xs leading-relaxed text-[#5A5463]">
                {live
                  ? "Published on Arc testnet. Customers pay test USDC by email, and the merchant's Gemini hedge is simulated."
                  : "Not published yet. Customers will pay test USDC on Arc testnet, and the merchant's Gemini hedge is simulated. The refund condition is decided by the market's official final result."}
              </p>
            </article>
          </aside>
        </div>
      </main>

      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "Promotions", href: "/merchant" },
          { label: "Live offers", href: "/discover" },
        ]}
      />
    </>
  );
}
