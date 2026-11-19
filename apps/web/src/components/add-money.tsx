"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import { api } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { usd } from "@/lib/format";
import { useWallet } from "@/lib/wallet/session";
import { Button, Sheet } from "./kit";

/**
 * Add money to the prepaid balance: pick an amount, then a phone payment sheet modeled on iOS's
 * (floating dark sheet, system font, merchant line, card row, total, the side-button prompt with
 * its pulsing pill, a Face ID style scan that morphs into a check, "Done"). Built from scratch to
 * match; no third-party code or assets. Deliberately NOT Apple Pay: no Apple logo, no "Apple Pay"
 * words, a neutral "Pay" glyph and a test card, so nobody mistakes it for a real Apple Pay
 * integration. Behind it on testnet: POST /api/wallet/faucet (Circle's test USDC). The real faucet
 * drips a fixed amount; the balance shown afterwards is always the wallet's own.
 */
const AMOUNTS = [10, 20, 50];
type Stage = "amount" | "pay" | "scan" | "done" | "error";

export function AddMoneySheet({
  open,
  onClose,
  onAdded,
  need,
}: {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
  /** Base units still missing for a purchase: preselects the smallest amount that covers it. */
  need?: bigint;
}) {
  const w = useWallet();
  const [amount, setAmount] = useState(20);
  const [stage, setStage] = useState<Stage>("amount");
  const [problem, setProblem] = useState<Problem | null>(null);
  // Circle's testnet faucet limits drips; then the fallback is faucet.circle.com with the address.
  const [faucetDown, setFaucetDown] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset only when the sheet opens (the balance, and so `need`, changes while it is open).
  const needRef = useRef(need);
  needRef.current = need;
  useEffect(() => {
    if (!open) return;
    setStage("amount");
    setProblem(null);
    const n = needRef.current;
    if (n && n > 0n) {
      const pick = AMOUNTS.find((a) => BigInt(a) * 1_000_000n >= n) ?? AMOUNTS[AMOUNTS.length - 1]!;
      setAmount(pick);
    }
  }, [open]);

  const balance = BigInt(w.wallet?.usdcBalance ?? "0");
  const base = BigInt(amount) * 1_000_000n;

  async function pay() {
    if (!w.wallet || stage !== "pay") return;
    setStage("scan");
    const minScan = new Promise((r) => setTimeout(r, 1500));
    try {
      await Promise.all([api.faucet(w.wallet.id, base.toString()), minScan]);
      setStage("done");
      await w.refreshWallet();
      onAdded?.();
      // Circle's testnet drip can land a few seconds later: read the balance again.
      setTimeout(() => void w.refreshWallet().then(() => onAdded?.()), 4000);
      setTimeout(onClose, 1600);
    } catch (err) {
      await minScan;
      setFaucetDown(err instanceof ApiError && err.code === "faucet_unavailable");
      setProblem(describe(err));
      setStage("error");
    }
  }

  if (!open) return null;

  if (stage === "amount") {
    return (
      <Sheet open onClose={onClose} title="Add money">
        <div className="pt-2 text-center">
          <p className="font-num text-[76px] leading-none">${amount}</p>
          <p className="mt-2 text-[14.5px] text-ink-2">
            Balance after <span className="font-semibold text-ink">{usd(balance + base)}</span>
          </p>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Amount">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={a === amount}
              onClick={() => setAmount(a)}
              className={`font-num h-14 rounded-2xl text-[24px] transition-colors ${a === amount ? "bg-ink text-black" : "bg-surface-2 text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-3"}`}
            >
              ${a}
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-inset ring-line">
          <CardArt />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Wincentive test card</p>
            <p className="text-[13.5px] text-ink-3">···· 4242</p>
          </div>
        </div>
        <Button size="lg" className="mt-5" onClick={() => setStage("pay")}>
          Add ${amount}
        </Button>
        <p className="mt-3 text-center text-[12.5px] text-ink-3">Pays for any promo in one tap.</p>
      </Sheet>
    );
  }

  return (
    <PaySheet
      stage={stage}
      total={usd(base)}
      onPay={() => void pay()}
      onCancel={() => setStage("amount")}
      error={
        stage === "error" ? (
          <div className="space-y-3 text-[15px] leading-snug">
            <p className="font-semibold text-white">
              {faucetDown ? "Top-up limit reached" : (problem?.title ?? "Payment not completed")}
            </p>
            <p className="text-[#98989f]">
              {faucetDown ? (
                <>
                  The testnet allows a few top-ups a day. Add more at{" "}
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-white underline underline-offset-4"
                  >
                    faucet.circle.com
                  </a>{" "}
                  (Arc Testnet) with your wallet address.
                </>
              ) : (
                problem?.detail
              )}
            </p>
            {faucetDown && w.wallet ? (
              typeof navigator !== "undefined" && navigator.clipboard ? (
                <button
                  type="button"
                  className="font-semibold text-white"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(w.wallet!.address)
                      .then(() => setCopied(true))
                  }
                >
                  {copied ? "Address copied" : "Copy wallet address"}
                </button>
              ) : (
                <p className="break-all text-[12.5px] text-[#98989f]">{w.wallet.address}</p>
              )
            ) : null}
            <button
              type="button"
              onClick={() => setStage("pay")}
              className="h-[50px] w-full rounded-[12px] bg-[#2c2c2e] text-[17px] font-semibold text-white"
            >
              Try Again
            </button>
          </div>
        ) : null
      }
    />
  );
}

/* ---------- the phone payment sheet ---------- */

const SF =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, "Helvetica Neue", sans-serif';

function PaySheet({
  stage,
  total,
  onPay,
  onCancel,
  error,
}: {
  stage: Stage;
  total: string;
  onPay: () => void;
  onCancel: () => void;
  error: React.ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const lastTap = useRef(0);
  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage === "pay") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [stage, onCancel]);
  if (!host) return null;

  /** A double-click (or double-tap) confirms, like the side button. */
  function tap() {
    if (stage !== "pay") return;
    const t = Date.now();
    if (t - lastTap.current < 450) {
      lastTap.current = 0;
      onPay();
    } else lastTap.current = t;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      style={{ fontFamily: SF }}
      role="dialog"
      aria-modal="true"
      aria-label={`Pay ${total}`}
    >
      <div className="ios-dim absolute inset-0 bg-black/70" />

      {stage === "pay" ? (
        <>
          {/* Side-button prompt, at the height of a phone's side button. */}
          <div className="pointer-events-none fixed right-4 top-[19%] text-right text-[17px] font-semibold leading-[1.15] text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.8)]">
            Double-Click
            <br />
            to Pay
          </div>
          <span
            aria-hidden
            className="ios-side-pill pointer-events-none fixed right-0 top-[calc(19%-14px)] h-[72px] w-[5px] rounded-l-full bg-white"
          />
        </>
      ) : null}

      <div className="ios-sheet absolute inset-x-2 bottom-2 mx-auto max-w-[464px] overflow-hidden rounded-[38px] bg-[#1c1c1e] text-white pb-[max(env(safe-area-inset-bottom),12px)]">
        {/* Header: neutral pay glyph, close */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <span className="inline-flex items-center gap-1.5 text-[20px] font-semibold tracking-[-0.02em]">
            <PayGlyph /> Pay
          </span>
          {stage === "pay" ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel"
              className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#3a3a3c] text-[#aeaeb2]"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                <path
                  d="M1.5 1.5l9 9M10.5 1.5l-9 9"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : (
            <span className="h-[30px] w-[30px]" />
          )}
        </div>

        {/* Card row */}
        <div className="mx-4 flex items-center gap-3 border-b border-[#38383a] py-3">
          <CardArt small />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] leading-tight">Wincentive test card</p>
            <p className="text-[15px] leading-tight text-[#98989f]">···· 4242</p>
          </div>
          <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden className="text-[#5a5a5f]">
            <path
              d="M1.5 1.5l5 5-5 5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Total */}
        <div className="mx-4 flex items-baseline justify-between py-3.5">
          <span className="text-[17px] text-[#98989f]">Pay Wincentive</span>
          <span className="text-[22px] font-semibold tracking-[-0.01em]">{total}</span>
        </div>

        {/* Confirm area */}
        <div aria-live="polite" className="px-4 pb-3 pt-1">
          {stage === "error" ? (
            <div className="pb-2 pt-1">{error}</div>
          ) : (
            <button
              type="button"
              onClick={tap}
              onKeyDown={(e) => {
                if (stage === "pay" && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onPay();
                }
              }}
              aria-label={
                stage === "pay"
                  ? `Double-tap to pay ${total}`
                  : stage === "scan"
                    ? "Confirming"
                    : "Done"
              }
              className="flex h-[132px] w-full flex-col items-center justify-center gap-2.5 rounded-[22px] outline-none"
            >
              {stage === "pay" ? (
                <>
                  <SideButtonGlyph />
                  <span className="text-[15px] text-[#98989f]">Confirm with Side Button</span>
                </>
              ) : (
                <>
                  <FaceCheck done={stage === "done"} />
                  <span className="text-[15px] font-semibold text-white">
                    {stage === "done" ? "Done" : " "}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}

/** The scan: corner brackets and a face that turns; on success the brackets close into a circle and the face becomes a check. */
function FaceCheck({ done }: { done: boolean }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      aria-hidden
      className="text-white"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g className={done ? "ios-brackets-out" : "ios-brackets"} strokeWidth="3">
        <path d="M6 20V13a7 7 0 0 1 7-7h7M44 6h7a7 7 0 0 1 7 7v7M58 44v7a7 7 0 0 1-7 7h-7M20 58h-7a7 7 0 0 1-7-7v-7" />
      </g>
      <g className={done ? "ios-face-out" : "ios-face"} strokeWidth="3">
        <path d="M23 24v5M41 24v5M32 25v11h-3" />
        <path d="M24 43c4.5 4 11.5 4 16 0" />
      </g>
      {done ? (
        <>
          <circle className="ios-ring" cx="32" cy="32" r="27" strokeWidth="3" pathLength={100} />
          <path className="ios-check" d="M21 33l7.5 7.5L44 25" strokeWidth="3.6" pathLength={100} />
        </>
      ) : null}
    </svg>
  );
}

/** The side-button hint: a phone edge with its button lit. */
function SideButtonGlyph() {
  return (
    <svg width="34" height="44" viewBox="0 0 34 44" aria-hidden className="text-[#98989f]">
      <rect
        x="2"
        y="2"
        width="22"
        height="40"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <rect
        x="26.5"
        y="9"
        width="3.5"
        height="13"
        rx="1.75"
        fill="#ffffff"
        className="ios-side-dot"
      />
    </svg>
  );
}

/** Neutral pay glyph: a card with a contactless mark (not any company's logo). */
function PayGlyph() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden>
      <rect
        x="1"
        y="1"
        width="20"
        height="14"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M1.5 5.5h19" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 10.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CardArt({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative block shrink-0 overflow-hidden rounded-[5px] bg-ribbon ${small ? "h-[30px] w-[46px]" : "h-[34px] w-[52px]"}`}
    >
      <span className="absolute left-[6px] top-[9px] h-[8px] w-[11px] rounded-[2px] bg-amber/80 ring-1 ring-black/20" />
      <span className="absolute bottom-[5px] right-[6px] h-[5px] w-[13px] rounded-full bg-white/70" />
    </span>
  );
}
