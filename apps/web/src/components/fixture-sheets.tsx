"use client";

import { useEffect, useState } from "react";
import { publicConfig } from "@/lib/config";
import { onFixtureSheet, type FixtureSheet } from "@/lib/wallet/fixture-bus";
import { Button, inputClass } from "./ui";

/**
 * DEV-ONLY stand-ins for Circle's own screens (email code, approval) in fixture mode. They are
 * deliberately plain and labeled as fixtures; the real ones are drawn by Circle's SDK.
 */
export function FixtureSheets() {
  const [sheet, setSheet] = useState<FixtureSheet | null>(null);
  const [code, setCode] = useState("");
  useEffect(() => (publicConfig.walletFixture ? onFixtureSheet(setSheet) : undefined), []);
  useEffect(() => setCode(""), [sheet]);
  if (!sheet) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-ink/50 p-3 sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label={sheet.kind === "otp" ? "Fixture email code" : "Fixture approval"}
    >
      <div className="w-full max-w-sm rounded-2xl bg-paper-raised p-5 shadow-2xl ring-2 ring-stamp/60">
        <p className="mb-3 inline-block rounded bg-stamp-soft px-2 py-0.5 text-[12px] font-bold text-stamp">
          Fixture: stands in for Circle&apos;s screen
        </p>
        {sheet.kind === "otp" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sheet.resolve(code);
            }}
            className="space-y-3"
          >
            <h2 className="font-wide text-[18px] font-bold">Enter the code</h2>
            <p className="text-[14px] text-ink-soft">
              Circle would email a 6-digit code to {sheet.email}. In fixture mode any 6 digits work.
            </p>
            <input
              id="fixture-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={`${inputClass} h-12 text-center font-mono text-[22px] tracking-[0.4em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={code.length !== 6}>
                Verify
              </Button>
              <Button type="button" variant="secondary" onClick={sheet.reject}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <h2 className="font-wide text-[18px] font-bold">Approve</h2>
            <p className="text-[15px]">{sheet.what}</p>
            <p className="text-[13px] text-ink-soft">
              Circle would show this request and ask you to confirm. Nothing is sent in fixture
              mode.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={sheet.resolve} id="fixture-approve">
                Approve
              </Button>
              <Button variant="secondary" onClick={sheet.reject} id="fixture-decline">
                Decline
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
