"use client";

import { useState, type ReactNode } from "react";
import { ApiError, type DashboardDto, type PromotionDto, type PurchaseReceiptDto } from "@/lib/api";
import { api, chain } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { cents, clock, conditionText, countdown, dateTime, shortAddr, usd } from "@/lib/format";
import { store, useNowSeconds, useOrigin, usePoll } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet/session";
import { Button, ButtonLink, ChainLink, ChainTag, Notice, SimTag, Spinner, Stat } from "../ui";
import { Seal } from "../voucher";
import { confirmWithRetry, draftKey, removeDraft, saveDraft, type LocalDraft } from "./composer";

type Promo = DashboardDto["promotions"][number];

/** Escrow states where the purchase's money is still inside the escrow. */
const HELD = new Set(["Deposited", "Hedged", "Cancelled"]);

const PHASE_ORDER: Record<string, number> = {
  LIVE: 0,
  PAUSED: 1,
  WAITING_FOR_RESULT: 2,
  RESULT_NO: 3,
  RESULT_YES: 4,
};

interface PurchaseList {
  rows: PurchaseReceiptDto[];
  /** Where the list came from, for the honest footnote. */
  source: "api" | "chain";
}

/**
 * A promo's purchases. Preferred: GET /api/promotions/:id/purchases (PROPOSED, not in apps/api
 * yet). Fallback: read the purchase keys from the Arc escrow (needs NEXT_PUBLIC_ARC_ESCROW_ADDRESS)
 * and fetch each receipt. Null when neither is available.
 */
async function loadPurchases(p: Promo): Promise<PurchaseList | null> {
  try {
    return { rows: (await api.promotionPurchases(p.id)).purchases, source: "api" };
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
  const reads = chain().reads;
  if (!reads || !p.promoPda) return null;
  const onChain = await reads.purchasesOf(p.promoPda);
  const rows = await Promise.all(onChain.map((c) => api.purchase(c.purchasePda).catch(() => null)));
  return { rows: rows.filter((r): r is PurchaseReceiptDto => r !== null), source: "chain" };
}

export function Ledger({
  merchant,
  canAct,
  refreshKey,
}: {
  merchant: string;
  /** True when the signed-in wallet is this shop. */
  canAct: boolean;
  refreshKey: number;
}) {
  const dash = usePoll(() => api.dashboard(merchant), 10_000, [merchant, refreshKey]);
  const active = (dash.data?.promotions ?? []).filter((p) => p.status === "ACTIVE" && p.promoPda);
  const drafts = (dash.data?.promotions ?? []).filter((p) => p.status === "DRAFT");
  const ids = active.map((p) => p.id).join(",");

  const lists = usePoll<Record<string, PurchaseList | null>>(
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
  if (!dash.data) {
    if (notFound) {
      return (
        <EmptyLedger>
          No promos from this shop yet. Publish the first one below and it shows up here with its
          sales, escrow and cover.
        </EmptyLedger>
      );
    }
    if (dash.error) {
      const p = describe(dash.error);
      return (
        <Notice
          tone="error"
          title={p.title}
          action={
            <Button size="sm" variant="secondary" onClick={dash.refresh}>
              Retry
            </Button>
          }
        >
          {p.detail}
        </Notice>
      );
    }
    return (
      <p className="flex items-center gap-2 py-6 text-ink-soft">
        <Spinner /> Loading your promos…
      </p>
    );
  }

  const sorted = [...active].sort(
    (a, b) =>
      (PHASE_ORDER[a.live?.phase ?? "RESULT_YES"] ?? 9) -
        (PHASE_ORDER[b.live?.phase ?? "RESULT_YES"] ?? 9) || b.depositDeadline - a.depositDeadline,
  );
  const totals = sumStats(active);
  const known = Object.values(lists.data ?? {}).filter((l): l is PurchaseList => l !== null);
  const escrowHeld = known
    .flatMap((l) => l.rows)
    .filter((r) => HELD.has(r.onChainState))
    .reduce((s, r) => s + BigInt(r.amount), 0n);
  const noList = lists.data && Object.values(lists.data).some((l) => l === null);

  return (
    <div className="space-y-6">
      {dash.error ? (
        <Notice tone="warn" title={describe(dash.error).title}>
          Showing the last data received. {describe(dash.error).detail}
        </Notice>
      ) : null}
      {lists.error ? (
        <Notice tone="warn" title={describe(lists.error).title}>
          {describe(lists.error).detail}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-2xl bg-paper-raised p-5 ring-1 ring-ink/10 md:grid-cols-4 md:p-6">
        <Stat
          label={
            <>
              Held in escrow <ChainTag />
            </>
          }
          value={lists.data && !noList ? usd(escrowHeld) : "–"}
          sub="Owed to buyers or to you, by the result"
        />
        <Stat
          label="Sales"
          value={totals.purchases}
          sub={`${totals.hedged} covered, ${totals.refunded} refunded`}
        />
        <Stat
          label="Cost so far"
          value={usd(totals.premium)}
          sub={`${totals.contracts} YES contracts`}
          sim
        />
        <Stat
          label="Owed if it happens"
          value={usd(totals.hedgedSales)}
          sub={`Covered by ${usd(BigInt(Math.round(Number(totals.contracts) * 100)) * 10_000n)} of contracts`}
          sim
        />
      </div>

      {noList ? (
        <Notice tone="warn" title="Purchase list not available">
          The promo server has no purchase list route yet (GET /api/promotions/:id/purchases) and
          this site has no escrow address to read Arc directly (NEXT_PUBLIC_ARC_ESCROW_ADDRESS).
          Totals above still come from the server.
        </Notice>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyLedger>No live promos. Publish one below.</EmptyLedger>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-paper-raised ring-1 ring-ink/10">
          <div className="hidden grid-cols-[minmax(0,2.1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] gap-4 border-b border-ink/10 px-5 py-2.5 text-[12.5px] text-ink-soft xl:grid">
            <span>Promo</span>
            <span>Status</span>
            <span>Sales</span>
            <span>In escrow</span>
            <span>Cost so far</span>
            <span>You keep</span>
          </div>
          {sorted.map((p) => (
            <PromoRow
              key={p.id}
              promo={p}
              list={lists.data?.[p.id]}
              canAct={canAct}
              onChange={() => {
                dash.refresh();
                lists.refresh();
              }}
            />
          ))}
        </div>
      )}

      {drafts.length > 0 ? (
        <Drafts merchant={merchant} drafts={drafts} canAct={canAct} onChange={dash.refresh} />
      ) : null}
    </div>
  );
}

function EmptyLedger({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink/25 px-6 py-10 text-center text-ink-soft">
      {children}
    </div>
  );
}

function sumStats(promos: Promo[]) {
  let purchases = 0,
    hedged = 0,
    refunded = 0,
    premium = 0n,
    hedgedSales = 0n,
    contracts = 0;
  for (const p of promos) {
    purchases += p.stats.purchases;
    hedged += p.stats.hedged;
    refunded += p.stats.refundedOrCancelled;
    premium += BigInt(p.stats.premium);
    // Sales of hedged purchases still waiting for the result are the open refund liability.
    if (p.onChainState === "Active") hedgedSales += BigInt(p.stats.hedgedSales);
    contracts += Number(p.stats.contracts);
  }
  return { purchases, hedged, refunded, premium, hedgedSales, contracts: contracts.toFixed(2) };
}

/* ---------- one promo ---------- */

function PromoRow({
  promo,
  list,
  canAct,
  onChange,
}: {
  promo: Promo;
  list: PurchaseList | null | undefined;
  canAct: boolean;
  onChange: () => void;
}) {
  const w = useWallet();
  const now = useNowSeconds();
  const origin = useOrigin();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const rows = list?.rows ?? [];
  const collectable =
    promo.onChainState === "ResolvedNo" ? rows.filter((r) => r.onChainState === "Hedged") : [];
  const collectAmount = collectable.reduce((s, r) => s + BigInt(r.amount), 0n);
  const held = rows
    .filter((r) => HELD.has(r.onChainState))
    .reduce((s, r) => s + BigInt(r.amount), 0n);
  const link = `${origin}/checkout/${promo.id}`;
  const cond = conditionText(promo.outcomeLabel, promo.geminiMarketId);

  async function collect() {
    if (!w.wallet) return;
    setCollecting(true);
    setProblem(null);
    try {
      const ch = await api.claimMerchant(
        collectable.map((r) => r.purchasePda),
        w.wallet.id,
      );
      await w.execute(
        ch.challengeId,
        `Collect ${usd(collectAmount)} from ${collectable.length} covered sale${collectable.length === 1 ? "" : "s"}`,
      );
      setCollected(true);
      onChange();
      void w.refreshWallet();
    } catch (err) {
      setProblem(describe(err));
    } finally {
      setCollecting(false);
    }
  }

  return (
    <div className="border-b border-ink/10 last:border-b-0">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] xl:items-center">
        <div className="col-span-2 flex min-w-0 items-center gap-3 xl:col-span-1">
          <Seal
            seed={promo.promoPda ?? promo.id}
            size={46}
            label={usd(promo.offerAmount).replace(/\.00$/, "")}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {promo.itemName}, {usd(promo.offerAmount)}
            </p>
            <p className="truncate text-[13.5px] text-ink-soft">Back if {cond}</p>
          </div>
        </div>

        <Cell label="Status" wide>
          <PhaseBadge
            promo={promo}
            now={now}
            toCollect={collectable.length}
            collected={rows.filter((r) => r.onChainState === "ClaimedByMerchant").length}
          />
        </Cell>

        <Cell label="Sales">
          <p className="font-semibold">{promo.stats.purchases} sold</p>
          <p className="text-[13px] text-ink-soft">
            {promo.stats.hedged} covered
            {promo.stats.refundedOrCancelled ? `, ${promo.stats.refundedOrCancelled} refunded` : ""}
          </p>
        </Cell>

        <Cell label="In escrow">
          <p className="font-semibold">{list ? usd(held) : "–"}</p>
          <p className="truncate font-mono text-[12px] text-ink-faint" title={promo.promoPda ?? ""}>
            {shortAddr(promo.promoPda, 6)}
          </p>
        </Cell>

        <Cell label="Cost so far">
          <p className="font-semibold">{usd(promo.stats.premium)}</p>
          <p className="text-[13px] text-ink-soft">
            {promo.stats.contracts} contracts
            {promo.live ? `, budget left ${usd(promo.live.budgetRemaining)}` : ""}
          </p>
          <SimTag />
        </Cell>

        <Cell label="You keep">
          <p className="text-[13.5px]">
            If yes <strong>{usd(promo.stats.ifYes)}</strong>
          </p>
          <p className="text-[13.5px]">
            If no <strong>{usd(promo.stats.ifNo)}</strong>
          </p>
          <SimTag />
        </Cell>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
        {collectable.length > 0 ? (
          canAct ? (
            <Button size="sm" variant="note" busy={collecting} onClick={collect}>
              Collect {usd(collectAmount)} ({collectable.length})
            </Button>
          ) : (
            <span className="text-[13px] text-ink-soft">
              {usd(collectAmount)} to collect. Log in as this shop to collect it.
            </span>
          )
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy checkout link"}
        </Button>
        <ButtonLink size="sm" variant="ghost" href={`/checkout/${promo.id}`}>
          Open checkout
        </ButtonLink>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide purchases" : `Purchases (${list ? rows.length : promo.stats.purchases})`}
        </Button>
      </div>

      {problem ? (
        <div className="px-5 pb-4">
          <Notice tone="error" title={problem.title}>
            {problem.detail}
          </Notice>
        </div>
      ) : null}
      {collected ? (
        <div className="px-5 pb-4">
          <Notice tone="ok" title="Collected">
            The covered sales are on their way to your wallet.
          </Notice>
        </div>
      ) : null}

      {open ? <Purchases promo={promo} list={list} /> : null}
    </div>
  );
}

function Cell({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2 xl:col-span-1" : ""}`}>
      <p className="mb-0.5 text-[12px] text-ink-faint xl:hidden">{label}</p>
      {children}
    </div>
  );
}

function PhaseBadge({
  promo,
  now,
  toCollect,
  collected,
}: {
  promo: PromotionDto;
  now: number | null;
  toCollect: number;
  collected: number;
}) {
  const live = promo.live;
  const left = now === null ? null : promo.depositDeadline - now;
  const until =
    left !== null && left > 0
      ? left > 86_400
        ? dateTime(promo.depositDeadline)
        : `in ${countdown(left)}`
      : null;
  const badge = (cls: string, text: string, pulse?: boolean) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${cls}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? "animate-pulse-dot" : ""}`}
        aria-hidden
      />
      {text}
    </span>
  );
  switch (live?.phase) {
    case "LIVE":
      return (
        <div>
          {badge("bg-note-soft text-note", "Selling", true)}
          <p className="mt-1 text-[13px] text-ink-soft">
            At {cents(live.liveAskMicroUsd)}. Sales close {until ?? clock(promo.depositDeadline)}
          </p>
        </div>
      );
    case "PAUSED":
      return (
        <div>
          {badge("bg-sim-soft text-sim", "Paused")}
          <p className="mt-1 text-[13px] text-ink-soft">
            {live.pauseReason === "PRICE_ABOVE_THRESHOLD"
              ? `Market ${cents(live.liveAskMicroUsd)} is over your ${cents(promo.maxYesPriceMicroUsd)} limit`
              : live.pauseReason === "BUDGET_USED"
                ? "Cover budget used up"
                : "No live price on Gemini"}
          </p>
        </div>
      );
    case "WAITING_FOR_RESULT":
      return (
        <div>
          {badge("bg-ink/[0.07] text-ink", "Waiting for result")}
          <p className="mt-1 text-[13px] text-ink-soft">
            Sales closed {clock(promo.depositDeadline)}
          </p>
        </div>
      );
    case "RESULT_YES":
      return (
        <div>
          {badge("bg-chain-soft text-chain", "It happened")}
          <p className="mt-1 text-[13px] text-ink-soft">
            Buyers claim refunds; your cover paid out
          </p>
        </div>
      );
    case "RESULT_NO":
      return (
        <div>
          {badge("bg-ink text-paper-raised", "Didn't happen")}
          <p className="mt-1 text-[13px] text-ink-soft">
            {toCollect > 0
              ? `${toCollect} covered sale${toCollect === 1 ? "" : "s"} to collect`
              : collected > 0
                ? `Collected ${collected} sale${collected === 1 ? "" : "s"}`
                : "No covered sales to collect"}
          </p>
        </div>
      );
    default:
      return badge("bg-ink/[0.07] text-ink", promo.onChainState);
  }
}

/* ---------- purchases of one promo ---------- */

const STATE_TEXT: Record<PurchaseReceiptDto["onChainState"], string> = {
  Deposited: "Paid, not covered yet",
  Hedged: "Covered",
  Cancelled: "Refund ready",
  Refunded: "Refunded",
  ClaimedByCustomer: "Paid back to buyer",
  ClaimedByMerchant: "Collected by you",
};

function Purchases({ promo, list }: { promo: Promo; list: PurchaseList | null | undefined }) {
  if (list === undefined) {
    return (
      <p className="flex items-center gap-2 border-t border-ink/10 bg-paper/60 px-5 py-4 text-[14px] text-ink-soft">
        <Spinner /> Loading purchases…
      </p>
    );
  }
  if (list === null) {
    return (
      <p className="border-t border-ink/10 bg-paper/60 px-5 py-4 text-[14px] text-ink-soft">
        The purchase list isn&apos;t available from this server yet.
      </p>
    );
  }
  if (list.rows.length === 0) {
    return (
      <p className="border-t border-ink/10 bg-paper/60 px-5 py-4 text-[14px] text-ink-soft">
        No purchases yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto border-t border-ink/10 bg-paper/60">
      <table className="w-full min-w-[760px] text-left text-[13.5px]">
        <thead className="text-[12px] text-ink-soft">
          <tr>
            <th className="px-5 py-2 font-normal">Buyer</th>
            <th className="px-3 py-2 font-normal">Payment</th>
            <th className="px-3 py-2 font-normal">Escrow state</th>
            <th className="px-3 py-2 font-normal">Cover</th>
            <th className="px-3 py-2 font-normal">Hand over?</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((r) => {
            const h = r.hedge;
            return (
              <tr key={r.purchasePda} className="border-t border-ink/5 align-top">
                <td className="px-5 py-2.5">
                  <span className="font-mono text-[12.5px]">{shortAddr(r.customer)}</span>
                  <p className="mt-0.5">
                    <a
                      className="text-[12px] text-ink-soft underline"
                      href={`/counter/${r.purchasePda}`}
                    >
                      Counter screen
                    </a>
                  </p>
                </td>
                <td className="px-3 py-2.5">
                  {r.transactions.deposit ? (
                    <ChainLink
                      compact
                      href={chain().explorerTx(r.transactions.deposit)}
                      value={r.transactions.deposit}
                    />
                  ) : (
                    <span className="text-ink-faint">–</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-chain">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                    {STATE_TEXT[r.onChainState]}
                  </span>
                  {r.transactions.markHedged ? (
                    <div className="mt-1">
                      <ChainLink
                        compact
                        href={chain().explorerTx(r.transactions.markHedged)}
                        value={r.transactions.markHedged}
                      />
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  {h ? (
                    <div className="bg-hatch-soft inline-block rounded-md px-2 py-1 ring-1 ring-sim/30">
                      <p className="font-semibold text-ink">
                        {h.status === "FAILED" || h.status === "VOIDED"
                          ? `${h.status === "FAILED" ? "Failed" : "Voided"}${h.failureReason ? `: ${failureText(h.failureReason)}` : ""}`
                          : `${h.contracts} at ${cents(h.avgFillPriceMicroUsd)} = ${usd(h.premium)}`}
                      </p>
                      <p className="text-[11.5px] text-sim">Simulated, no order placed</p>
                    </div>
                  ) : (
                    <span className="text-ink-soft">Pricing…</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.canServe ? (
                    <span className="font-semibold text-note">Yes</span>
                  ) : (
                    <span className="text-ink-soft">Not yet</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-5 py-2 text-[12px] text-ink-faint">
        {list.source === "chain"
          ? "Purchases read from the Arc escrow; statuses from the promo server."
          : "Purchases and statuses from the promo server."}{" "}
        Hand over the {promo.itemName.toLowerCase()} only once a sale is covered.
      </p>
    </div>
  );
}

export function failureText(reason: string): string {
  return (
    {
      QUOTE_OVER_CAP: "price over the shop's limit",
      QUOTE_STALE: "price too old",
      QUOTE_UNAVAILABLE: "no live price",
      INSUFFICIENT_LIQUIDITY: "not enough on sale",
      PARTIAL_FILL: "only partly fillable",
      BUDGET_EXCEEDED: "budget used up",
      MARK_HEDGED_FAILED: "couldn't confirm on chain in time",
    }[reason] ?? reason
  );
}

/* ---------- drafts ---------- */

function Drafts({
  merchant,
  drafts,
  canAct,
  onChange,
}: {
  merchant: string;
  drafts: PromotionDto[];
  canAct: boolean;
  onChange: () => void;
}) {
  const local = store.get<LocalDraft[]>(draftKey(merchant)) ?? [];
  const resumable = drafts.filter((d) => local.some((l) => l.promotionId === d.id));
  return (
    <details className="rounded-2xl bg-paper-raised/60 px-5 py-3 ring-1 ring-ink/10">
      <summary className="cursor-pointer text-[14px] font-semibold text-ink-soft">
        Drafts not published ({drafts.length})
        {resumable.length ? `, ${resumable.length} can be finished here` : ""}
      </summary>
      <p className="mt-2 text-[13px] text-ink-soft">
        A draft does nothing until the shop approves it in its wallet, so unpublished drafts are
        safe to ignore.
      </p>
      <ul className="mt-3 space-y-2">
        {drafts.slice(0, 20).map((d) => (
          <DraftRow
            key={d.id}
            merchant={merchant}
            draft={d}
            local={local.find((l) => l.promotionId === d.id) ?? null}
            canAct={canAct}
            onChange={onChange}
          />
        ))}
      </ul>
    </details>
  );
}

function DraftRow({
  merchant,
  draft,
  local,
  canAct,
  onChange,
}: {
  merchant: string;
  draft: PromotionDto;
  local: LocalDraft | null;
  canAct: boolean;
  onChange: () => void;
}) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const now = useNowSeconds();
  const expired = now !== null && draft.depositDeadline <= now + 90;

  async function finish() {
    if (!w.wallet || !local) return;
    setBusy(true);
    setProblem(null);
    try {
      let promoId = local.promoId;
      if (!promoId) {
        const ch = await api.initializePromo(draft.id, w.wallet.id);
        await w.execute(
          ch.challengeId,
          `Create the promo: ${draft.itemName}, ${usd(draft.offerAmount)}`,
        );
        promoId = ch.promoId;
        saveDraft(merchant, { ...local, promoId });
      }
      await confirmWithRetry(draft.id, promoId);
      removeDraft(merchant, draft.id);
      onChange();
    } catch (err) {
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/5 pt-2 text-[14px]">
      <span className="min-w-0">
        <span className="font-semibold">{draft.itemName}</span>{" "}
        <span className="text-ink-soft">
          back if {conditionText(draft.outcomeLabel, draft.geminiMarketId)}, sales close{" "}
          {dateTime(draft.depositDeadline)}
        </span>
      </span>
      {local && canAct && !expired ? (
        <Button size="sm" variant="secondary" busy={busy} onClick={finish}>
          {local.promoId ? "Finish publishing" : "Approve and publish"}
        </Button>
      ) : (
        <span className="text-[13px] text-ink-faint">
          {expired ? "Deadline passed" : "Unpublished"}
        </span>
      )}
      {problem ? (
        <p className="w-full text-[13px] text-stamp">
          {problem.title}: {problem.detail}
        </p>
      ) : null}
    </li>
  );
}
