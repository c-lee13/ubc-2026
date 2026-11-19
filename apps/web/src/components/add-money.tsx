"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { api } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { usd } from "@/lib/format";
import { useWallet } from "@/lib/wallet/session";
import { IconCheck } from "./icons";
import { Button, Mark, Note, Sheet } from "./kit";

/**
 * Add money to the prepaid balance: pick an amount, then a phone-style pay sheet (double-tap to
 * pay, a face scan, a check). Behind it on testnet: POST /api/wallet/faucet (Circle's test USDC).
 * The real faucet drips a fixed amount; the balance shown afterwards is always the wallet's own.
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
  const lastTap = useRef(0);

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
    const minScan = new Promise((r) => setTimeout(r, 1300));
    try {
      await Promise.all([api.faucet(w.wallet.id, base.toString()), minScan]);
      setStage("done");
      await w.refreshWallet();
      onAdded?.();
      // Circle's testnet drip can land a few seconds later: read the balance again.
      setTimeout(() => void w.refreshWallet().then(() => onAdded?.()), 4000);
      setTimeout(onClose, 1500);
    } catch (err) {
      await minScan;
      setFaucetDown(err instanceof ApiError && err.code === "faucet_unavailable");
      setProblem(describe(err));
      setStage("error");
    }
  }

  /** Double-tap (or double-click) to pay, like the side button on a phone. */
  function tap() {
    const t = Date.now();
    if (t - lastTap.current < 450) {
      lastTap.current = 0;
      void pay();
    } else lastTap.current = t;
  }

  if (stage === "amount") {
    return (
      <Sheet open={open} onClose={onClose} title="Add money">
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
            <p className="text-[15px] font-semibold">Debit card</p>
            <p className="text-[13.5px] text-ink-3">Ending in 4242</p>
          </div>
        </div>
        <Button size="lg" className="mt-5" onClick={() => setStage("pay")}>
          Continue
        </Button>
        <p className="mt-3 text-center text-[12.5px] text-ink-3">
          Your balance pays for promos in one tap. Testnet dollars in this demo.
        </p>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} tone="black" labelledBy="paysheet-title">
      <div className="relative">
        {stage === "pay" ? (
          <span
            aria-hidden
            className="side-hint fixed right-0 top-[26%] z-[60] h-24 w-1.5 rounded-l-full bg-ink"
          />
        ) : null}
        <div className="flex items-center justify-between">
          <span id="paysheet-title" className="flex items-center gap-2 text-[15px] font-semibold">
            <Mark className="h-5" /> Wincentive
          </span>
          {stage === "pay" ? (
            <button
              type="button"
              onClick={() => setStage("amount")}
              className="text-[15px] font-semibold text-ink-2"
            >
              Cancel
            </button>
          ) : null}
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-inset ring-line">
          <CardArt />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Debit card</p>
            <p className="text-[13.5px] text-ink-3">Ending in 4242</p>
          </div>
        </div>
        <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-inset ring-line">
          <span className="text-[15px] text-ink-2">Add to balance</span>
          <span className="font-num text-[30px]">{usd(base)}</span>
        </div>

        <div className="mt-6 grid place-items-center pb-2" aria-live="polite">
          {stage === "pay" ? (
            <button
              type="button"
              onClick={tap}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void pay();
                }
              }}
              className="flex w-full flex-col items-center gap-3 rounded-3xl py-5 transition-colors active:bg-surface"
              aria-label={`Double-tap to pay ${usd(base)}`}
            >
              <FaceGlyph />
              <span className="text-[17px] font-semibold">Double-tap to pay</span>
              <span className="text-[13px] text-ink-3">or double-click the side button</span>
            </button>
          ) : stage === "scan" ? (
            <div className="flex flex-col items-center gap-3 py-5">
              <FaceGlyph scanning />
              <span className="text-[17px] font-semibold">Confirming</span>
              <span className="text-[13px] text-ink-3">Hold still</span>
            </div>
          ) : stage === "done" ? (
            <div className="flex flex-col items-center gap-3 py-5">
              <span className="grid h-[72px] w-[72px] animate-pop place-items-center rounded-full bg-ribbon text-black">
                <IconCheck size={36} />
              </span>
              <span className="text-[17px] font-semibold">Done</span>
              <span className="text-[13px] text-ink-3">{usd(base)} added</span>
            </div>
          ) : (
            <div className="w-full space-y-3 py-2">
              <Note
                tone="error"
                title={
                  faucetDown ? "Top-up limit reached" : (problem?.title ?? "Couldn't add money")
                }
              >
                {faucetDown ? (
                  <>
                    The testnet allows a few top-ups a day. Add more at{" "}
                    <a
                      href="https://faucet.circle.com"
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ink underline underline-offset-4"
                    >
                      faucet.circle.com
                    </a>{" "}
                    (Arc Testnet) with your wallet address.
                    {w.wallet && typeof navigator !== "undefined" && navigator.clipboard ? (
                      <button
                        type="button"
                        className="mt-2 block font-semibold text-chain"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(w.wallet!.address)
                            .then(() => setCopied(true))
                        }
                      >
                        {copied ? "Address copied" : "Copy wallet address"}
                      </button>
                    ) : (
                      <span className="mt-2 block break-all text-[12.5px]">
                        {w.wallet?.address}
                      </span>
                    )}
                  </>
                ) : (
                  problem?.detail
                )}
              </Note>
              <Button size="lg" onClick={() => setStage("pay")}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function CardArt() {
  return (
    <span
      aria-hidden
      className="relative block h-[34px] w-[52px] shrink-0 overflow-hidden rounded-[7px] bg-ribbon"
    >
      <span className="absolute left-[7px] top-[11px] h-[9px] w-[12px] rounded-[2px] bg-amber/80 ring-1 ring-black/20" />
      <span className="absolute bottom-[6px] right-[7px] h-[6px] w-[14px] rounded-full bg-white/70" />
    </span>
  );
}

/** A generic face-scan glyph (corners, eyes, smile); a scan line sweeps while confirming. */
function FaceGlyph({ scanning }: { scanning?: boolean }) {
  return (
    <span className="relative grid h-[72px] w-[72px] place-items-center">
      <svg
        viewBox="0 0 64 64"
        className="h-full w-full"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M6 20V12a6 6 0 0 1 6-6h8M44 6h8a6 6 0 0 1 6 6v8M58 44v8a6 6 0 0 1-6 6h-8M20 58h-8a6 6 0 0 1-6-6v-8" />
        <path d="M23 24v5M41 24v5M32 26v10h-3" />
        <path d="M24 43c4.5 4 11.5 4 16 0" />
      </svg>
      {scanning ? (
        <span
          aria-hidden
          className="scan-line absolute inset-x-2 top-1/2 h-0.5 rounded-full bg-ribbon"
        />
      ) : null}
    </span>
  );
}
