"use client";

import { useEffect, useState } from "react";
import { publicConfig } from "@/lib/config";
import { onFixtureSheet, type FixtureSheet } from "@/lib/wallet/fixture-bus";
import { Button, INPUT, Wordmark } from "./kit";

/**
 * DEV-ONLY stand-ins for Circle's own screens (email code, approval) in fixture mode
 * (NEXT_PUBLIC_WALLET_FIXTURE=1, never in production builds). The real ones are drawn by Circle's
 * SDK; these match the app so the preview reads like the product, with a one-line preview note.
 */
export function FixtureSheets() {
  const [sheet, setSheet] = useState<FixtureSheet | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => (publicConfig.walletFixture ? onFixtureSheet(setSheet) : undefined), []);
  useEffect(() => setCode(""), [sheet]);
  if (!sheet) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={sheet.kind === "otp" ? "Enter your code" : "Approve"}
    >
      <div className="w-full max-w-[480px] animate-sheet-up rounded-t-[28px] bg-paper-raised px-5 pb-8 pt-5 ring-1 ring-rule sm:rounded-[28px]">
        <div className="mb-4 flex items-center gap-2 text-[12.5px] font-semibold text-ink-soft">
          <Wordmark size={15} />
        </div>
        {sheet.kind === "otp" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sheet.resolve(code);
            }}
            className="space-y-4"
          >
            <div>
              <h2 className="font-display text-[25px]">Enter your code</h2>
              <p className="mt-1.5 text-[13.5px] text-ink-soft">
                We sent 6 digits to {sheet.email}.
              </p>
            </div>
            <input
              id="fixture-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              className={`${INPUT} font-num h-16 text-center text-[26.5px] tracking-[0.35em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
            <Button type="submit" size="lg" disabled={code.length !== 6}>
              Verify
            </Button>
            <button
              type="button"
              onClick={sheet.reject}
              className="w-full text-center text-[13.5px] font-semibold text-ink-soft"
            >
              Cancel
            </button>
            <p className="text-center text-[11px] text-ink-faint">
              Preview mode: any 6 digits work.
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <ApproveSummary what={sheet.what} />
            <Button size="lg" onClick={sheet.resolve} id="fixture-approve">
              Approve
            </Button>
            <button
              type="button"
              onClick={sheet.reject}
              id="fixture-decline"
              className="w-full text-center text-[13.5px] font-semibold text-ink-soft"
            >
              Decline
            </button>
            <p className="text-center text-[11px] text-ink-faint">
              Preview mode: nothing leaves this browser.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Pay $5.00 to Shop for a latte" reads as a payment: the amount big, who and what below. */
function ApproveSummary({ what }: { what: string }) {
  const m = /^Pay (\$[\d,.]+) to (.+?) for (.+)$/.exec(what);
  if (!m) {
    return (
      <div>
        <h2 className="font-display text-[25px]">Approve</h2>
        <p className="mt-2 text-[15px] leading-snug">{what}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[13.5px] text-ink-soft">Confirm payment</p>
      <p className="font-num mt-1 text-[50px]">{m[1]}</p>
      <p className="mt-2 text-[14px] leading-snug">
        To <span className="font-semibold">{m[2]}</span> for {m[3]}
      </p>
    </div>
  );
}
