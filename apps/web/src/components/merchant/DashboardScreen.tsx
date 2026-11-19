"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { api } from "@/lib/client";
import {
  couponSupply,
  registerCoupons,
  registeredCoupons,
  useCouponRegistry,
  DEFAULT_SELLING_OUT_AT,
} from "@/lib/coupons";
import { describe, type Problem } from "@/lib/errors";
import { usd } from "@/lib/format";
import { useNowSeconds, usePoll, useSeenFor } from "@/lib/hooks";
import { localDrafts, sumStats, type DashboardPromo, type LocalDraft } from "@/lib/merchant";
import { condition, happened, oddsPct, price, sellState, shortCountdown } from "@/lib/promo-view";
import { STUCK_AFTER_SECS } from "@/lib/purchases";
import { useWallet } from "@/lib/wallet/session";
import { IconEdit, IconLock, IconPlus, IconQr } from "../icons";
import { Button, Meter, Note, Sheet, Spinner } from "../kit";
import { LoginCard } from "../login-card";
import { Column, ProfileButton } from "../shell";
import { Seal } from "../voucher";
import { Wordmark } from "../kit";
import { Stepper } from "./CreatePromo";
import { SavedDraftCard } from "./SavedDraftCard";

// The merchant workspace: the shop's promos (live and history), new promo, edit, counter.
// Data: GET /api/merchants/:wallet/dashboard for the signed-in shop (owner view through
// X-User-Token, so max odds and budget are included). Hedge figures there are SIMULATED.

const PHASE_ORDER: Record<string, number> = {
  LIVE: 0,
  PAUSED: 1,
  WAITING_FOR_RESULT: 2,
  RESULT_NO: 3,
  RESULT_YES: 4,
};

export function DashboardScreen({ viewAs }: { viewAs: string | null }) {
  const w = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<"live" | "history">("live");
  const [editing, setEditing] = useState<DashboardPromo | null>(null);
  const now = useNowSeconds();
  useCouponRegistry();
  const mine = mounted && w.phase === "ready" ? (w.wallet?.address.toLowerCase() ?? null) : null;
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
  const live = active.filter(
    (p) =>
      p.live?.phase === "LIVE" ||
      p.live?.phase === "PAUSED" ||
      p.live?.phase === "WAITING_FOR_RESULT",
  );
  const history = active.filter(
    (p) => p.live?.phase === "RESULT_YES" || p.live?.phase === "RESULT_NO",
  );
  const drafts = promos.filter((p) => p.status === "DRAFT");
  const totals = sumStats(active);
  const sales = active.reduce((a, p) => a + BigInt(p.stats.hedgedSales), 0n);

  const [local, setLocal] = useState<LocalDraft[]>([]);
  useEffect(() => {
    if (shop) setLocal(localDrafts(shop));
  }, [shop, dash.data]);

  const shopName = dash.data?.merchant?.shopName ?? promos[0]?.shop.name ?? null;
  const shown = tab === "live" ? live : history;

  return (
    <>
      <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur-md">
        <Column className="flex h-[60px] items-center justify-between px-4">
          <Link href="/merchant" className="flex items-center gap-2.5">
            <Wordmark />
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[12px] font-semibold text-ink-soft">
              Shop
            </span>
          </Link>
          <ProfileButton />
        </Column>
      </header>

      <main className="pb-16">
        <Column className="px-4">
          {!shop ? (
            <div className="pt-6">
              <h1 className="font-display text-[40px] leading-[0.95]">
                Run a promo for your shop.
              </h1>
              <p className="mt-3 text-[16px] text-ink-soft">
                Pick a game, set the price, and your customers get it free if the underdog wins. You
                never cover the loss.
              </p>
              <div className="mt-6 rounded-[24px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
                <p className="font-title mb-3 text-[18px]">Sign in with your shop&apos;s email</p>
                <LoginCard />
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3 pt-4">
                <div className="min-w-0">
                  <p className="text-[14px] text-ink-soft">{readOnly ? "Viewing" : "Your shop"}</p>
                  <h1 className="font-display line-clamp-2 text-[28px] leading-[1.02]">
                    {shopName ?? "Workspace"}
                  </h1>
                </div>
              </div>

              {readOnly && mine ? (
                <div className="mt-3">
                  <Note title="Read-only view">
                    This is another shop&apos;s workspace. Sign in with its email to make changes.
                  </Note>
                </div>
              ) : null}

              <div className="mt-5 grid grid-cols-3 gap-2.5">
                <Stat value={String(totals.hedged)} label="coupons sold" />
                <Stat value={compactUsd(sales)} label="in sales" />
                <Stat
                  value={String(totals.open)}
                  label={totals.open === 1 ? "live promo" : "live promos"}
                  accent
                />
              </div>

              {canAct ? (
                <Link
                  href="/merchant/new"
                  className="mt-5 flex h-[58px] items-center justify-center gap-2 rounded-[18px] bg-ink text-[17px] font-semibold text-black"
                >
                  <IconPlus size={20} /> New promo
                </Link>
              ) : null}

              {dash.data === undefined && !dash.error ? (
                <div className="grid place-items-center py-16 text-ink-soft">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : notFound || (dash.data && promos.length === 0) ? (
                <div className="mt-6 rounded-[24px] bg-paper-raised px-6 py-10 text-center ring-1 ring-inset ring-rule">
                  <p className="font-title text-[20px]">No promos yet</p>
                  <p className="mt-1.5 text-[15px] text-ink-soft">
                    Your first one takes about a minute.
                  </p>
                </div>
              ) : dash.error && !dash.data ? (
                <div className="mt-6">
                  <Note tone="error" title={describe(dash.error).title}>
                    {describe(dash.error).detail}
                  </Note>
                </div>
              ) : (
                <>
                  {drafts.length > 0 ? (
                    <div className="mt-6 space-y-3">
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
                    </div>
                  ) : null}

                  <div
                    role="tablist"
                    aria-label="Promos"
                    className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-rule"
                  >
                    {(
                      [
                        ["live", `Live (${live.length})`],
                        ["history", `History (${history.length})`],
                      ] as const
                    ).map(([t, label]) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className={`h-10 rounded-full text-[14.5px] font-semibold transition-colors ${tab === t ? "bg-ink text-black" : "text-ink-soft hover:text-ink"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 space-y-3">
                    {shown.length === 0 ? (
                      <p className="py-8 text-center text-[15px] text-ink-soft">
                        {tab === "live" ? "Nothing live right now." : "Finished promos land here."}
                      </p>
                    ) : (
                      shown.map((p) => (
                        <PromoRow
                          key={p.id}
                          p={p}
                          now={now}
                          canAct={canAct}
                          onEdit={() => setEditing(p)}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </Column>
      </main>

      <EditSheet promo={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** "$98", "$1.2k": whole dollars for the stat tiles. */
function compactUsd(base: bigint): string {
  const d = Number(base) / 1_000_000;
  return d >= 1000 ? `$${(d / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${Math.round(d)}`;
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[20px] bg-paper-raised px-3.5 py-3.5 ring-1 ring-inset ring-rule">
      <p className={`font-num truncate text-[28px] ${accent ? "text-note" : ""}`}>{value}</p>
      <p className="mt-1.5 text-[12.5px] leading-tight text-ink-soft">{label}</p>
    </div>
  );
}

function statusLine(
  p: DashboardPromo,
  now: number | null,
): { text: string; tone: "live" | "warn" | "quiet" | "win" } {
  const st = sellState(p, now);
  const cond = condition(p);
  switch (st.kind) {
    case "selling":
      return {
        text: `Selling, ${now !== null ? shortCountdown(p.depositDeadline - now) : ""} left`,
        tone: "live",
      };
    case "soldout":
      return { text: "Sold out", tone: "warn" };
    case "paused":
      return {
        text:
          p.live?.pauseReason === "NO_LIVE_PRICE"
            ? "Paused: no live odds"
            : "Paused: odds above your max",
        tone: "warn",
      };
    case "closed":
      return { text: "Sales closed, game on", tone: "quiet" };
    case "won":
      return { text: `${happened(cond)}. Customers paid back`, tone: "win" };
    case "done":
      return { text: "Over. Sales are yours", tone: "quiet" };
    default:
      return { text: "Draft", tone: "quiet" };
  }
}

function PromoRow({
  p,
  now,
  canAct,
  onEdit,
}: {
  p: DashboardPromo;
  now: number | null;
  canAct: boolean;
  onEdit: () => void;
}) {
  const s = statusLine(p, now);
  const supply = couponSupply(p, p.stats.hedged);
  const odds = oddsPct(p.live?.liveAskMicroUsd);
  const max =
    p.live?.thresholdBps !== undefined
      ? p.live.thresholdBps / 100
      : p.maxYesPriceMicroUsd
        ? Number(p.maxYesPriceMicroUsd) / 10_000
        : null;
  const selling = p.live?.phase === "LIVE" || p.live?.phase === "PAUSED";
  return (
    <article className="rounded-[24px] bg-paper-raised p-4 ring-1 ring-inset ring-rule">
      <div className="flex items-start gap-3.5">
        <Seal seed={p.promoPda ?? p.id} size={50} label={price(p.offerAmount)} />
        <div className="min-w-0 flex-1">
          <p className="font-title truncate text-[19px]">{p.itemName}</p>
          <p className="truncate text-[14px] text-ink-soft">Free if {condition(p)}</p>
          <p
            className={`mt-1 text-[13.5px] font-semibold ${s.tone === "live" ? "text-note" : s.tone === "warn" ? "text-orange" : s.tone === "win" ? "text-ink" : "text-ink-soft"}`}
          >
            {s.tone === "live" ? (
              <span
                className="mr-1.5 inline-block h-2 w-2 animate-pulse-dot rounded-full bg-note align-middle"
                aria-hidden
              />
            ) : null}
            {s.text}
          </p>
        </div>
        {selling ? (
          <div className="shrink-0 text-right">
            <p className="font-num text-[26px] text-note">
              {odds === null ? "–" : `${Math.round(odds)}%`}
            </p>
            <p className="text-[11.5px] text-ink-faint">
              {max !== null ? `max ${Math.round(max)}%` : "chance"}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] text-ink-soft">
            <span className="font-semibold text-ink">{p.stats.hedged}</span>
            {supply ? ` of ${supply.total} sold` : " sold"}
            {supply && selling && supply.sellingOut ? (
              <span className="font-semibold text-orange">, selling out</span>
            ) : null}
          </p>
          {supply ? (
            <Meter
              value={supply.sold}
              max={supply.total}
              hot={supply.sellingOut}
              className="mt-2 max-w-[160px]"
            />
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {p.live?.phase !== "RESULT_YES" && p.live?.phase !== "RESULT_NO" ? (
            <Link
              href={`/counter/${p.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-3 px-3.5 text-[14px] font-semibold ring-1 ring-inset ring-line-strong"
            >
              <IconQr size={16} /> Counter
            </Link>
          ) : null}
          {canAct ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-3 px-3.5 text-[14px] font-semibold ring-1 ring-inset ring-line-strong"
            >
              <IconEdit size={15} /> Edit
            </button>
          ) : null}
        </div>
      </div>
      {p.live?.phase === "RESULT_NO" && canAct ? <Collect promo={p} /> : null}
    </article>
  );
}

/**
 * Escrow v2 pays the shop automatically after a NO result. Only a payment stuck for a few minutes
 * (or escrow v1) shows a Collect button: POST /api/purchases/claim-merchant, one approval each.
 */
function Collect({ promo }: { promo: DashboardPromo }) {
  const w = useWallet();
  const list = usePoll(() => api.promotionPurchases(promo.id), 15_000, [promo.id]);
  const due = (list.data?.purchases ?? []).filter((r) => r.onChainState === "Hedged");
  const seenFor = useSeenFor(due.map((r) => `${r.purchasePda}:collect`));
  const ready = due
    .filter((r) => !r.autoPayout || seenFor(`${r.purchasePda}:collect`) >= STUCK_AFTER_SECS)
    .slice(0, 20);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  if (ready.length === 0 || !w.wallet) return null;
  const amount = ready.reduce((a, r) => a + BigInt(r.amount), 0n);

  async function collect() {
    if (!w.wallet) return;
    setBusy(true);
    setProblem(null);
    try {
      const { challenges } = await api.claimMerchant(
        ready.map((r) => r.purchasePda),
        w.wallet.id,
      );
      for (const [i, ch] of challenges.entries()) {
        await w.execute(
          ch.challengeId,
          `Collect order #${ch.purchaseKey.slice(-4).toUpperCase()} (${i + 1} of ${challenges.length})`,
        );
      }
      list.refresh();
      void w.refreshWallet();
    } catch (err) {
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-rule pt-3">
      <Button size="md" className="w-full" busy={busy} onClick={collect}>
        Collect {usd(amount)}
      </Button>
      {problem ? (
        <Note tone="error" title={problem.title}>
          {problem.detail}
        </Note>
      ) : null}
    </div>
  );
}

/**
 * Edit a live promo. The coupon count and the selling-out threshold are this app's own (kept in
 * this browser until the API stores them); item, price, game and max odds are fixed on Arc once
 * the promo is live.
 */
function EditSheet({ promo, onClose }: { promo: DashboardPromo | null; onClose: () => void }) {
  const [total, setTotal] = useState(25);
  const [at, setAt] = useState(DEFAULT_SELLING_OUT_AT);
  useEffect(() => {
    if (!promo) return;
    const reg = registeredCoupons(promo.id);
    const server = (
      promo as DashboardPromo & { coupons?: { total: number; sellingOutAt?: number } | null }
    ).coupons;
    setTotal(reg?.total ?? server?.total ?? Math.max(25, promo.stats.hedged + 10));
    setAt(reg?.sellingOutAt ?? server?.sellingOutAt ?? DEFAULT_SELLING_OUT_AT);
  }, [promo]);
  if (!promo) return null;
  const max =
    promo.live?.thresholdBps !== undefined
      ? `${Math.round(promo.live.thresholdBps / 100)}%`
      : promo.maxYesPriceMicroUsd
        ? `${Math.round(Number(promo.maxYesPriceMicroUsd) / 10_000)}%`
        : "–";
  return (
    <Sheet open onClose={onClose} title={`Edit ${promo.itemName}`}>
      <div className="space-y-3">
        <Stepper
          label="Coupons"
          value={total}
          min={Math.max(1, promo.stats.hedged)}
          max={1000}
          onChange={setTotal}
        />
        <Stepper
          label="“Selling out” at"
          value={at}
          min={1}
          max={Math.max(1, total)}
          onChange={setAt}
          suffix="left"
        />
        <ul className="divide-y divide-rule rounded-[18px] bg-paper ring-1 ring-inset ring-rule">
          {[
            ["Item and price", `${promo.itemName}, ${price(promo.offerAmount)}`],
            ["Free if", condition(promo)],
            ["Max odds", max],
          ].map(([k, v]) => (
            <li key={k} className="flex items-center gap-3 px-4 py-3 text-[14.5px]">
              <IconLock size={16} className="shrink-0 text-ink-faint" />
              <span className="text-ink-soft">{k}</span>
              <span className="ml-auto truncate font-semibold">{v}</span>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-ink-faint">
          Item, price, game and max odds are locked once a promo is live. Start a new promo to
          change them.
        </p>
        <Button
          size="lg"
          onClick={() => {
            registerCoupons(promo.id, total, at);
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}
