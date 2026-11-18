"use client";

import { chain } from "@/lib/client";
import { useWallet } from "@/lib/wallet/session";

// Network status, in the place and style of Zahin's DevnetNetworkNotice. On Arc there is nothing
// for the person to set: Circle creates the email wallet on Arc testnet, and the wallet record our
// API returns names its chain (`blockchain`). So this shows the app's network (from config) and the
// signed-in wallet's chain as Circle reports it. Read-only: it checks nothing on its own.

const PILL =
  "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset";

export function NetworkNote() {
  const w = useWallet();
  const c = chain();
  const blockchain = w.phase === "ready" ? (w.wallet?.blockchain ?? null) : null;
  const onArc = blockchain ? /^ARC/i.test(blockchain) : null;

  return (
    <section
      aria-label="Network status"
      className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5"
    >
      <dl className="space-y-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="font-medium text-stone-700">App network</dt>
          <dd>
            <span className={`${PILL} bg-violet-100 text-violet-900 ring-violet-300`}>
              {c.networkLabel}
            </span>
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <dt className="font-medium text-stone-700">Your wallet</dt>
          <dd className="flex flex-wrap items-center gap-x-2 gap-y-1" role="status">
            {blockchain === null ? (
              <span className={`${PILL} bg-stone-100 text-stone-700 ring-stone-300`}>
                Not signed in
              </span>
            ) : onArc ? (
              <span className={`${PILL} bg-emerald-100 text-emerald-900 ring-emerald-300`}>
                {blockchain} (from Circle)
              </span>
            ) : (
              <>
                <span className={`${PILL} bg-amber-100 text-amber-900 ring-amber-300`}>
                  Warning: {blockchain}
                </span>
                <span className="font-medium text-amber-900">Not Arc. Do not pay.</span>
              </>
            )}
          </dd>
        </div>
      </dl>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-violet-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500">
          About the network
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-stone-600">
          Wincentive runs on {c.networkLabel} (chain {c.chainId}). Logging in with your email makes
          a Circle wallet there for you: no app, no seed phrase, no network to switch. Test USDC has
          no value. Every payment is approved by you in Circle&apos;s window; our server never signs
          for you.
        </p>
      </details>
    </section>
  );
}
