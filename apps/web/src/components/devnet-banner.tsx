import { publicConfig } from "@/lib/config";

/** Always on top: a testnet demo with valueless test dollars (testnet USDC) and simulated hedges. */
export function DevnetBanner() {
  return (
    <>
      <div className="bg-paper-deep px-4 py-2 text-center text-[13px] text-ink-soft">
        <span className="font-semibold text-ink">Arc testnet demo.</span>{" "}
        <span className="sm:hidden">Test money. Hedges simulated.</span>
        <span className="max-sm:hidden">
          Every dollar here is test money with no value, and every hedge is{" "}
          <span className="bg-hatch rounded px-1 font-semibold text-sim">simulated</span>: no Gemini
          order is ever placed.
        </span>
      </div>
      {publicConfig.walletFixture ? <FixtureBanner /> : null}
    </>
  );
}

/** Dev-only fixture mode must be impossible to mistake for the real thing. */
function FixtureBanner() {
  return (
    <div className="border-b-2 border-stamp bg-stamp-soft px-4 py-2 text-center text-[13px] text-stamp">
      <span className="font-bold">Fixture mode, dev only.</span> Email login, approvals and the
      wallet, checkout and payout responses are mocked in this browser. Nothing reaches Circle or
      Arc; prices and results are live Gemini data.
    </div>
  );
}
