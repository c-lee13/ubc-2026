"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { api } from "@/lib/client";
import { describe } from "@/lib/errors";
import { shortAddr, usd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { localDrafts, sumStats, type DashboardPromo, type LocalDraft } from "@/lib/merchant";
import { useWallet } from "@/lib/wallet/session";
import { BTN_PRIMARY, BTN_SECONDARY, DISPLAY, EYEBROW, EYEBROW_RULE, LINK } from "../layout/styles";
import { LoginCard } from "../login-card";
import { Button, Notice, Spinner } from "../ui";
import { PromotionRecord } from "./PromotionRecord";
import { SavedDraftCard } from "./SavedDraftCard";

// Merchant dashboard, Zahin's layout. Data: GET /api/merchants/:wallet/dashboard for the signed-in
// shop (owner view through X-User-Token) or the `?merchant=` wallet (public view). Live figures
// are sums of the dashboard's per-promo stats; hedge costs there are SIMULATED.

const PHASE_ORDER: Record<string, number> = {
  LIVE: 0,
  PAUSED: 1,
  WAITING_FOR_RESULT: 2,
  RESULT_NO: 3,
  RESULT_YES: 4,
};

// Merchant lifecycle. Every stage runs here; two of them need promo-server routes (see below).
const LIFECYCLE = [
  {
    title: "Draft",
    body: "Pick a Gemini market, set the price, the refund condition and the hedge limits. The promo server checks the deadline against the market and saves a draft.",
    note: "Promo server",
  },
  {
    title: "Publish",
    body: "Approve creating the promo in Circle's window with your shop's email wallet. The server reads it back from Arc and turns it on.",
    note: "Circle approval, on Arc",
  },
  {
    title: "Go live",
    body: "Customers scan your QR code and pay test USDC by email while the hedge is simulated.",
    note: "Customers pay by email",
  },
  {
    title: "Claim",
    body: "Once the market's official outcome is final, customers claim refunds, or you collect the escrowed USDC on the Claims page.",
    note: "Circle approval, on Arc",
  },
];

export function DashboardScreen({ viewAs }: { viewAs: string | null }) {
  const w = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);
  const mine = w.phase === "ready" ? (w.wallet?.address.toLowerCase() ?? null) : null;
  const readOnly = Boolean(viewAs && viewAs.toLowerCase() !== mine);
  const shop = readOnly ? viewAs : (mine ?? viewAs);
  const canAct = !readOnly && Boolean(mine);

  const dash = usePoll(shop ? () => api.dashboard(shop) : null, 10_000, [shop, refreshKey]);
  const notFound = dash.error instanceof ApiError && dash.error.code === "merchant_not_found";
  const promos = dash.data?.promotions ?? [];
  const active = promos
    .filter((p) => p.status === "ACTIVE" && p.promoPda)
    .sort(
      (a, b) =>
        (PHASE_ORDER[a.live?.phase ?? "RESULT_YES"] ?? 9) -
          (PHASE_ORDER[b.live?.phase ?? "RESULT_YES"] ?? 9) ||
        b.depositDeadline - a.depositDeadline,
    );
  const drafts = promos.filter((p) => p.status === "DRAFT");
  const totals = sumStats(active);

  // Unfinished publishes this browser can finish (read after mount: localStorage).
  const [local, setLocal] = useState<LocalDraft[]>([]);
  useEffect(() => {
    if (shop) setLocal(localDrafts(shop));
  }, [shop, dash.data]);

  const figure = (v: string) => (shop && dash.data ? v : shop ? "…" : "Log in to see");
  const FIGURES: [string, string][] = [
    ["Total sales", figure(String(totals.purchases))],
    ["Active promotions", figure(String(totals.open))],
    ["Simulated hedge costs", figure(usd(totals.premium))],
  ];

  return (
    <>
      {/* Intro: headline and actions on the left, the live figures on the right */}
      <section className="mx-auto grid max-w-[1240px] gap-10 px-5 pb-12 pt-8 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:pb-14 lg:pt-12">
        <div className="lg:col-span-8">
          <p className={EYEBROW}>
            <span aria-hidden className={EYEBROW_RULE} />
            Merchant workspace
          </p>
          <h1
            className={`${DISPLAY} mt-6 text-[clamp(2.7rem,5.4vw,4.4rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
          >
            Make every offer an event.
          </h1>
          <p className="mt-6 max-w-[38rem] text-lg leading-relaxed text-[#5A5463]">
            Create outcome-based refund offers, watch them sell, and collect when the outcome is
            final. Everything here runs on Arc testnet with test USDC, and hedging is simulated.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/merchant/new" className={BTN_PRIMARY}>
              Create promotion
            </Link>
            <Link href="/merchant/claims" className={BTN_SECONDARY}>
              View claims
            </Link>
          </div>
        </div>

        <section aria-labelledby="figures-heading" className="lg:col-span-4 lg:self-end">
          <h2 id="figures-heading" className="text-sm font-semibold">
            Live figures
          </h2>
          <dl className="mt-3 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
            {FIGURES.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[#5A5463]">{label}</dt>
                <dd className="font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-[#5A5463]">
            {shop
              ? "Published promotions only. Hedge costs are simulated from Gemini's live prices; no order is placed."
              : "Log in as the shop to see your totals."}
          </p>
        </section>
      </section>

      <div aria-hidden className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="border-t border-[#E6E1D8]" />
      </div>

      {/* Promotion workspace (primary focus) + lifecycle (secondary) */}
      <section
        aria-labelledby="workspace-heading"
        className="mx-auto grid max-w-[1240px] gap-14 px-5 py-14 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:py-16"
      >
        <div className="lg:col-span-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h2
              id="workspace-heading"
              className={`${DISPLAY} text-[clamp(2rem,4vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]`}
            >
              {readOnly ? "Shop promotions" : "Your promotions"}
            </h2>
            <Link href="/merchant/new" className={`text-sm ${LINK}`}>
              Create promotion
            </Link>
          </div>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
            {shop ? (
              <>
                {!readOnly && w.email ? `${w.email}, wallet ` : "Shop wallet "}
                <span className="font-mono">{shortAddr(shop, 6)}</span>
                {readOnly ? ", read-only view." : "."} Live from the promo server and Arc.
              </>
            ) : (
              "Log in with the shop's email to see its promotions. Customers never need to."
            )}
          </p>

          <div className="mt-8 border-t-2 border-[#211D28]">
            {!shop ? (
              <div className="max-w-xl border-b border-[#E6E1D8] py-8">
                <LoginCard title="Log in as the shop" />
              </div>
            ) : !dash.data ? (
              notFound ? (
                <Empty>
                  No promotions yet.{" "}
                  <Link href="/merchant/new" className={LINK}>
                    Create your first one
                  </Link>
                  .
                </Empty>
              ) : dash.error ? (
                <div className="py-8">
                  <Notice
                    tone="error"
                    title={describe(dash.error).title}
                    action={
                      <Button size="sm" variant="secondary" onClick={dash.refresh}>
                        Retry
                      </Button>
                    }
                  >
                    {describe(dash.error).detail}
                  </Notice>
                </div>
              ) : (
                <p className="flex items-center gap-2 border-b border-[#E6E1D8] py-8 text-[#5A5463]">
                  <Spinner /> Loading promotions…
                </p>
              )
            ) : (
              <>
                {dash.error ? (
                  <div className="py-5">
                    <Notice tone="warn" title={describe(dash.error).title}>
                      Showing the last data received. {describe(dash.error).detail}
                    </Notice>
                  </div>
                ) : null}
                {drafts.map((d) => (
                  <SavedDraftCard
                    key={d.id}
                    merchant={shop}
                    draft={d}
                    local={local.find((l) => l.promotionId === d.id) ?? null}
                    canAct={canAct}
                    onChange={() => setRefreshKey((k) => k + 1)}
                  />
                ))}
                {active.length === 0 && drafts.length === 0 ? (
                  <Empty>
                    No promotions yet.{" "}
                    <Link href="/merchant/new" className={LINK}>
                      Create your first one
                    </Link>
                    .
                  </Empty>
                ) : null}
                {active.map((p: DashboardPromo) => (
                  <PromotionRecord key={p.id} promo={p} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Secondary: what happens next (a sequence, so it is numbered by a rail of nodes) */}
        <aside aria-labelledby="next-heading" className="lg:col-span-4 lg:pl-6">
          <h2
            id="next-heading"
            className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
          >
            What happens next
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">
            A promotion moves through four stages.
          </p>
          <ol className="mt-7">
            {LIFECYCLE.map((step) => (
              <li
                key={step.title}
                className="relative ml-1 border-l border-[#CFC8BC] pb-8 pl-7 last:border-l-transparent last:pb-0"
              >
                <span
                  aria-hidden
                  className="absolute -left-[5px] top-[7px] h-[9px] w-[9px] rounded-full bg-[#6133A7]"
                />
                <h3 className={`${DISPLAY} text-lg font-semibold leading-snug tracking-[-0.015em]`}>
                  {step.title}
                </h3>
                <p className="mt-1 text-[15px] leading-relaxed text-[#5A5463]">{step.body}</p>
                <p className="mt-2 text-xs font-semibold text-[#6133A7]">{step.note}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 border-t border-[#E6E1D8] pt-4 text-xs leading-relaxed text-[#5A5463]">
            Publishing and claiming from an email wallet use promo-server routes that may not be
            deployed yet (POST /api/promotions/:id/initialize and the claim routes). If one is
            missing, that step says so and nothing is sent.
          </p>
        </aside>
      </section>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border-b border-[#E6E1D8] py-10 text-[15px] text-[#5A5463]">{children}</p>;
}
