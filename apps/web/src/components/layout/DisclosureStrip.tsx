import { publicConfig } from "@/lib/config";

/**
 * Zahin's quiet disclosure strip, on every page (the full disclosure is in the footer). In the
 * dev-only fixture mode a second, loud strip makes sure nobody mistakes it for the real thing.
 */
export function DisclosureStrip() {
  return (
    <>
      <p className="bg-[#EFE9F8] px-4 py-2 text-center text-xs font-medium text-[#3F2A66]">
        Arc testnet demo with valueless test USDC. Hedging is simulated.
      </p>
      {publicConfig.walletFixture ? (
        <p className="border-b-2 border-[#C4372B] bg-[#FCEDEB] px-4 py-2 text-center text-xs font-medium text-[#8A1F16]">
          <strong className="font-bold">Fixture mode, dev only.</strong> Email login, approvals and
          the wallet, checkout and payout responses are mocked in this browser. Nothing reaches
          Circle or Arc; prices and results are live Gemini data.
        </p>
      ) : null}
    </>
  );
}
