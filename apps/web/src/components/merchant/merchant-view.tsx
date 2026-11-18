"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet/session";
import { shortAddr } from "@/lib/format";
import { LoginCard } from "../login-card";
import { Composer } from "./composer";
import { Ledger } from "./ledger";

/**
 * Merchant dashboard. The ledger shows the connected wallet's promos; `?merchant=<pubkey>` opens
 * any shop's dashboard read-only (the API serves it without login: all of it is public chain data
 * and public Gemini prices). Signing actions always need the shop's own wallet.
 * With a shop known, its promos come first and the composer follows; otherwise the composer leads.
 */
export function MerchantView({ viewAs }: { viewAs: string | null }) {
  const wallet = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);
  const mine = wallet.phase === "ready" ? (wallet.wallet?.address.toLowerCase() ?? null) : null;
  const readOnly = Boolean(viewAs && viewAs.toLowerCase() !== mine);
  const shown = readOnly ? viewAs : (mine ?? viewAs);

  const ledger = (
    <section aria-labelledby="ledger" className="space-y-5">
      <div>
        <h2 id="ledger" className="font-display text-[34px] md:text-[44px]">
          {readOnly ? "Shop promos" : "Your promos"}
        </h2>
        {shown ? (
          <p className="mt-1 text-[14px] text-ink-soft">
            {!readOnly && wallet.email ? `${wallet.email}, wallet ` : "Shop wallet "}
            <span className="font-mono">{shortAddr(shown, 6)}</span>
            {readOnly ? ", read-only view" : ""}
          </p>
        ) : null}
      </div>

      {shown ? (
        <Ledger merchant={shown} canAct={!readOnly && Boolean(mine)} refreshKey={refreshKey} />
      ) : (
        <div className="max-w-xl rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10">
          <LoginCard title="Log in as the shop" />
        </div>
      )}
    </section>
  );
  const composer = <Composer onPublished={() => setRefreshKey((k) => k + 1)} />;

  return (
    <div className="space-y-16">
      {shown ? ledger : composer}
      <div className="border-t border-ink/15 pt-10">{shown ? composer : ledger}</div>
    </div>
  );
}
