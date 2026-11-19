"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, type PurchaseSummaryDto } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { describe } from "@/lib/errors";
import { conditionText, orderNumber, usd } from "@/lib/format";
import { usePoll, useSeenFor } from "@/lib/hooks";
import { loadPurchases, type DashboardPromo, type PurchaseList } from "@/lib/merchant";
import { ESCROW_STATE_TEXT, STUCK_AFTER_SECS } from "@/lib/purchases";
import { useWallet } from "@/lib/wallet/session";
import {
  BACK_LINK,
  BTN_BLOCK,
  DISPLAY,
  EYEBROW,
  EYEBROW_RULE,
  FOCUS,
  PILL_GREEN,
  PILL_GREY,
  PILL_PURPLE,
} from "../layout/styles";
import { LoginCard } from "../login-card";
import { StatusBadge } from "../ui/StatusBadge";
import { TransactionStatus, type TransactionState } from "../ui/TransactionStatus";
import { Button, Notice, Spinner } from "../ui";
import { NetworkNote } from "../wallet/NetworkNote";

// Merchant claims, Zahin's layout. Data: the shop's dashboard (GET /api/merchants/:wallet/
// dashboard) and each promo's purchases (GET /api/promotions/:id/purchases). Claim eligibility
// comes ONLY from the on-chain escrow state plus the promo's official on-chain resolution, never
// from the off-chain status. On escrow v2 (`autoPayout`) the shop is paid automatically after a NO
// result; POST /api/purchases/claim-merchant (one Circle approval per purchase) is then only the
// fallback for payments still uncollected a few minutes after this page first saw them due.

type Row = { r: PurchaseSummaryDto; promo: DashboardPromo };

const SHOWN = 25;

/** The shop can collect: the purchase is Hedged and its promo resolved NO, both read from Arc. */
function canCollect(row: Row): boolean {
  return row.r.onChainState === "Hedged" && row.promo.onChainState === "ResolvedNo";
}

function outcomeText(promo: DashboardPromo): { text: string; note: string } {
  switch (promo.onChainState) {
    case "ResolvedYes":
      return { text: "It happened", note: "Official, recorded on Arc" };
    case "ResolvedNo":
      return { text: "Didn't happen", note: "Official, recorded on Arc" };
    default:
      return { text: "Not final yet", note: "Waiting for the official result" };
  }
}

function eligibility(row: Row): { pill: string; text: string; note: string; rule: string } {
  const s = row.r.onChainState;
  if (canCollect(row)) {
    return row.r.autoPayout
      ? {
          pill: PILL_PURPLE,
          text: "Paying out",
          note: "Covered sale, official outcome no: the escrow pays it to you automatically",
          rule: "border-l-[#6133A7]",
        }
      : {
          pill: PILL_PURPLE,
          text: "Eligible",
          note: "Covered sale, official outcome no: you can collect it",
          rule: "border-l-[#6133A7]",
        };
  }
  if (s === "ClaimedByMerchant") {
    return {
      pill: PILL_GREEN,
      text: "Collected",
      note: "Paid to your wallet",
      rule: "border-l-[#1E8A5A]",
    };
  }
  if (s === "Cancelled" || s === "Refunded" || s === "ClaimedByCustomer") {
    return {
      pill: PILL_GREY,
      text: "Not eligible",
      note: "This payment goes back to the customer",
      rule: "border-l-[#CFC8BC]",
    };
  }
  if (s === "Deposited") {
    return {
      pill: PILL_GREY,
      text: "Not yet",
      note: "Not covered yet",
      rule: "border-l-[#CFC8BC]",
    };
  }
  return {
    pill: PILL_GREY,
    text: "Not yet",
    note: "Waiting for the official result",
    rule: "border-l-[#F58C38]",
  };
}

export function ClaimsScreen() {
  const w = useWallet();
  const shop = w.phase === "ready" ? (w.wallet?.address.toLowerCase() ?? null) : null;
  const [refreshKey, setRefreshKey] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [tx, setTx] = useState<TransactionState>({ status: "idle" });
  /** Purchase keys of the claim in flight: it is confirmed once Arc shows them all collected. */
  const [claiming, setClaiming] = useState<string[]>([]);

  const dash = usePoll(shop ? () => api.dashboard(shop) : null, 10_000, [shop, refreshKey]);
  const active = (dash.data?.promotions ?? []).filter((p) => p.status === "ACTIVE" && p.promoPda);
  const ids = active.map((p) => p.id).join(",");
  const lists = usePoll<Record<string, PurchaseList>>(
    ids
      ? async () =>
          Object.fromEntries(
            await Promise.all(active.map(async (p) => [p.id, await loadPurchases(p)] as const)),
          )
      : null,
    8_000,
    [ids, refreshKey],
  );
  const notFound = dash.error instanceof ApiError && dash.error.code === "merchant_not_found";

  const rows: Row[] = active.flatMap((promo) =>
    (lists.data?.[promo.id]?.rows ?? []).map((r) => ({ r, promo })),
  );
  const order = (row: Row) =>
    canCollect(row)
      ? 0
      : row.r.onChainState === "Hedged"
        ? 1
        : row.r.onChainState === "ClaimedByMerchant"
          ? 2
          : 3;
  rows.sort((a, b) => order(a) - order(b));
  const due = rows.filter((row) => canCollect(row));
  // Escrow v2 pays the shop automatically; the button only collects payments stuck for minutes.
  const auto = rows.some((row) => row.r.autoPayout);
  const seenFor = useSeenFor(due.map((row) => `${row.r.purchasePda}:collect`));
  const claimable = due
    .filter(
      (row) => !row.r.autoPayout || seenFor(`${row.r.purchasePda}:collect`) >= STUCK_AFTER_SECS,
    )
    .slice(0, 20);
  const claimAmount = claimable.reduce((s, row) => s + BigInt(row.r.amount), 0n);
  const dueAmount = due.reduce((s, row) => s + BigInt(row.r.amount), 0n);
  const awaiting = rows.filter(
    (row) => row.r.onChainState === "Hedged" && row.promo.onChainState === "Active",
  );
  const collected = rows.filter((row) => row.r.onChainState === "ClaimedByMerchant");
  const sum = (xs: Row[]) => usd(xs.reduce((s, row) => s + BigInt(row.r.amount), 0n));
  const known = Boolean(shop && lists.data);

  const OVERVIEW = [
    {
      label: "Awaiting resolution",
      hint: "Covered purchases whose market outcome is not final yet",
      value: known ? `${awaiting.length} · ${sum(awaiting)}` : "–",
    },
    {
      label: auto ? "Being paid to you" : "Claimable now",
      hint: auto
        ? "Official outcome no, verified on Arc: the escrow is sending these automatically"
        : "Verified from the escrow state on Arc",
      value: known ? `${due.length} · ${usd(dueAmount)}` : "–",
    },
    {
      label: auto ? "Paid to you" : "Completed claims",
      hint: auto ? "Payments to the shop confirmed on Arc" : "Merchant claims confirmed on Arc",
      value: known ? `${collected.length} · ${sum(collected)}` : "–",
    },
  ];

  async function collect() {
    if (!w.wallet || claimable.length === 0) return;
    const keys = claimable.map((row) => row.r.purchasePda);
    setTx({
      status: "awaiting_signature",
      what: `Collect ${usd(claimAmount)} from ${claimable.length} covered sale${claimable.length === 1 ? "" : "s"}`,
    });
    try {
      // Every key is checked by the server before any challenge exists; then one approval each.
      const { challenges } = await api.claimMerchant(keys, w.wallet.id);
      for (const [i, ch] of challenges.entries()) {
        const row = claimable.find((x) => x.r.purchasePda === ch.purchaseKey);
        const what = `Collect ${row ? usd(row.r.amount) : "a sale"} for order ${orderNumber(ch.purchaseKey)} (${i + 1} of ${challenges.length})`;
        setTx({ status: "awaiting_signature", what });
        await w.execute(ch.challengeId, what);
      }
      setClaiming(keys);
      setTx({ status: "confirming" });
      setRefreshKey((k) => k + 1);
      void w.refreshWallet();
    } catch (err) {
      const p = describe(err);
      setTx({ status: "failed", message: `${p.title}. ${p.detail}` });
    }
  }

  const visible = showAll ? rows : rows.slice(0, SHOWN);
  // Only the escrow state on Arc turns "confirming" into "confirmed".
  const landed =
    tx.status === "confirming" &&
    claiming.length > 0 &&
    claiming.every(
      (k) => rows.find((row) => row.r.purchasePda === k)?.r.onChainState === "ClaimedByMerchant",
    );
  const shownTx: TransactionState = landed ? { status: "confirmed" } : tx;

  return (
    <div className="mx-auto grid max-w-[1240px] gap-y-9 px-5 pb-10 pt-3 sm:px-8 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-0 lg:pb-16 lg:pt-6">
      <div className="lg:col-span-7 lg:col-start-1 lg:row-start-1 lg:pb-12">
        <Link href="/merchant" className={BACK_LINK}>
          ← Back to Merchant Dashboard
        </Link>

        <p className={`mt-5 lg:mt-6 ${EYEBROW}`}>
          <span aria-hidden className={EYEBROW_RULE} />
          Settlements &amp; claims
        </p>
        <h1
          className={`${DISPLAY} mt-4 text-[clamp(2.5rem,5vw,4.1rem)] font-semibold leading-[0.95] tracking-[-0.045em]`}
        >
          Every outcome, accounted for.
        </h1>
        <p className="mt-4 max-w-[34rem] text-base leading-relaxed text-[#5A5463] sm:text-lg">
          Review promotion outcomes and see when merchant funds become eligible to claim.
        </p>
      </div>

      <div
        aria-hidden
        className="hidden border-t border-[#E6E1D8] lg:col-span-12 lg:row-start-2 lg:mb-16 lg:block"
      />

      {/* The settlement workspace: the main focus */}
      <section
        aria-labelledby="settlements-heading"
        className="lg:col-span-7 lg:col-start-1 lg:row-start-3"
      >
        <h2
          id="settlements-heading"
          className={`${DISPLAY} text-[clamp(2rem,4vw,2.9rem)] font-semibold leading-none tracking-[-0.035em]`}
        >
          Purchase Settlements
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#5A5463]">
          {shop
            ? "Every purchase of your published promotions, live from the promo server and the escrow on Arc."
            : "Log in as the shop to see its purchases."}
        </p>

        <div className="mt-6 border-t-2 border-[#211D28]">
          {!shop ? (
            <div className="max-w-xl border-b border-[#E6E1D8] py-8">
              <LoginCard title="Log in as the shop" />
            </div>
          ) : notFound ? (
            <p className="border-b border-[#E6E1D8] py-10 text-[15px] text-[#5A5463]">
              No promotions yet, so nothing to settle.
            </p>
          ) : dash.error && !dash.data ? (
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
          ) : !dash.data || (ids && !lists.data && !lists.error) ? (
            <p className="flex items-center gap-2 border-b border-[#E6E1D8] py-8 text-[#5A5463]">
              <Spinner /> Loading purchases…
            </p>
          ) : (
            <>
              {lists.error ? (
                <div className="py-5">
                  <Notice tone="warn" title={describe(lists.error).title}>
                    {describe(lists.error).detail}
                  </Notice>
                </div>
              ) : null}
              {rows.length === 0 ? (
                <p className="border-b border-[#E6E1D8] py-10 text-[15px] text-[#5A5463]">
                  No purchases yet.
                </p>
              ) : null}
              {visible.map((row) => (
                <SettlementRecord key={row.r.purchasePda} row={row} />
              ))}
              {rows.length > SHOWN ? (
                <div className="py-5">
                  <Button size="sm" variant="secondary" onClick={() => setShowAll((s) => !s)}>
                    {showAll ? "Show fewer" : `Show all ${rows.length}`}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      {/* Utility area: the shop's login and network. Logging in never enables a claim by itself. */}
      <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:self-end lg:pb-12">
        <p className="text-sm font-semibold">Wallet and network</p>
        <p className="mt-1 text-xs leading-relaxed text-[#5A5463]">
          {shop
            ? `Logged in as ${w.email}. Claims go to this shop's email wallet.`
            : "Merchants claim with the shop's email wallet. Logging in does not enable any claim on its own."}
        </p>
        <NetworkNote />
      </div>

      {/* Supporting column: the claim action, then the quiet overview */}
      <aside className="lg:col-span-5 lg:col-start-8 lg:row-start-3">
        <section
          aria-labelledby="claim-heading"
          className="rounded-[20px] border border-[#E6E1D8] bg-white p-5 sm:p-7"
        >
          <h2
            id="claim-heading"
            className={`${DISPLAY} text-[1.6rem] font-semibold leading-tight tracking-[-0.03em]`}
          >
            Merchant Claim
          </h2>
          <ul className="mt-4 space-y-2.5 text-[14px] leading-relaxed text-[#4E4858]">
            <li>Customers pay test USDC into the escrow on Arc when they purchase.</li>
            <li>Gemini provides the officially finalized prediction-market outcome.</li>
            <li>
              {auto
                ? "If the refund condition does not occur, the escrow pays you each covered purchase automatically. This button is only a fallback for a payment still missing after a few minutes."
                : "If the refund condition does not occur, you can claim the escrowed USDC for each covered purchase."}
            </li>
            <li>
              Eligibility is read from the escrow state on Arc. A status shown by the app is not
              enough on its own.
            </li>
            <li>
              The simulated Gemini hedge ledger is separate from the real escrow on Arc. No funds
              move between them.
            </li>
            <li>
              A claim is approved by the promotion&apos;s merchant in Circle&apos;s window, one
              approval per purchase.
            </li>
          </ul>
          <button
            type="button"
            disabled={
              claimable.length === 0 ||
              !shop ||
              tx.status === "awaiting_signature" ||
              shownTx.status === "confirming"
            }
            onClick={collect}
            className={`mt-6 ${BTN_BLOCK}`}
          >
            {tx.status === "awaiting_signature" ? <Spinner /> : null}
            {claimable.length > 0
              ? `${auto ? "Collect manually: " : "Claim "}${usd(claimAmount)}`
              : "Claim Funds"}
          </button>
          <p className="mt-3 text-[13px] leading-relaxed text-[#5A5463]">
            {!shop
              ? "Log in as the shop to claim."
              : claimable.length > 0
                ? `${claimable.length} covered sale${claimable.length === 1 ? "" : "s"} with an official "no" outcome${auto ? " still unpaid after a few minutes" : ""}. One approval each in Circle's window.`
                : auto && due.length > 0
                  ? `${due.length} payment${due.length === 1 ? " is" : "s are"} on the way to your wallet automatically. Nothing to do.`
                  : auto
                    ? "Payments come to your wallet automatically, so there is nothing to claim."
                    : "Nothing is claimable right now, so this button is disabled."}
          </p>
          {tx.status !== "idle" ? (
            <TransactionStatus state={shownTx} explorerTx={chain().explorerTx} className="mt-4" />
          ) : null}
        </section>

        {/* Settlement overview: quiet totals from the escrow states. */}
        <section aria-labelledby="overview-heading" className="mt-10">
          <h2 id="overview-heading" className="text-sm font-semibold">
            Settlement Overview
          </h2>
          <dl className="mt-3 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-sm">
            {OVERVIEW.map((item) => (
              <div key={item.label} className="py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="font-medium">{item.label}</dt>
                  <dd className="text-right tabular-nums text-[#211D28]">{item.value}</dd>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-[#5A5463]">{item.hint}</p>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-[#5A5463]">Count · amount, test USDC.</p>
        </section>
      </aside>
    </div>
  );
}

function SettlementRecord({ row }: { row: Row }) {
  const { r, promo } = row;
  const out = outcomeText(promo);
  const el = eligibility(row);
  return (
    <article
      aria-label={`Settlement ${orderNumber(r.purchasePda)}`}
      className={`border-b border-l-[3px] border-b-[#E6E1D8] py-8 pl-5 sm:pl-7 ${el.rule}`}
    >
      <span className={`inline-block ${el.pill}`}>{el.text}</span>
      <dl>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <dt className="text-xs text-[#5A5463]">Promotion</dt>
            <dd
              className={`${DISPLAY} mt-1 break-words text-[1.7rem] font-semibold leading-tight tracking-[-0.025em]`}
            >
              {promo.itemName}, free if {conditionText(promo.outcomeLabel, promo.geminiMarketId)}
            </dd>
          </div>
          <div className="shrink-0 sm:text-right">
            <dt className="text-xs text-[#5A5463]">Purchase amount</dt>
            <dd
              className={`${DISPLAY} mt-1 text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums`}
            >
              {usd(r.amount)}
            </dd>
            <dd className="mt-1.5 text-xs text-[#5A5463]">test USDC</dd>
          </div>
        </div>

        <div className="mt-6 border-t border-[#E6E1D8] pt-5">
          <dt className="text-xs text-[#5A5463]">Purchase reference</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span>
              <span className="font-semibold">{orderNumber(r.purchasePda)}</span>{" "}
              <span className="font-mono text-[#5A5463]">
                {r.purchasePda.slice(0, 10)}…{r.purchasePda.slice(-6)}
              </span>
            </span>
            <Link
              href={`/purchases/${r.purchasePda}`}
              className={`font-semibold text-[#6133A7] underline underline-offset-4 hover:text-[#4E2890] ${FOCUS}`}
            >
              View receipt
            </Link>
          </dd>
        </div>

        {/* The three states that must never be confused */}
        <div className="mt-6 grid gap-x-8 gap-y-6 border-t border-[#E6E1D8] pt-5 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-[#5A5463]">Market outcome</dt>
            <dd className="mt-1 font-medium">{out.text}</dd>
            <dd className="mt-1.5 text-xs font-semibold text-[#5A5463]">{out.note}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[#5A5463]">Purchase status</dt>
            <dd className="mt-1">
              <StatusBadge status={r.status} />
            </dd>
            <dd className="mt-1.5 text-xs font-semibold text-[#3F2A66]">
              Escrow: {ESCROW_STATE_TEXT[r.onChainState]}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-[#5A5463]">Claim eligibility</dt>
            <dd className="mt-1 font-medium">{el.text}</dd>
            <dd className="mt-1.5 text-xs font-semibold text-[#5A5463]">{el.note}</dd>
          </div>
        </div>
      </dl>
    </article>
  );
}
