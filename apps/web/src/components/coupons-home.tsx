"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { useCouponRegistry } from "@/lib/coupons";
import { describe } from "@/lib/errors";
import { useNowSeconds, usePoll, type Polled } from "@/lib/hooks";
import { HERO_WORDS } from "@/lib/items";
import { condition, happened, price } from "@/lib/promo-view";
import { useRole } from "@/lib/role";
import { HowItWorksButton } from "./how-it-works";
import { Button, Mark, Note, SectionTitle } from "./kit";
import { PromoCard, type Promo } from "./promo-card";
import { PromoMap } from "./promo-map";
import { RolePick } from "./role-pick";
import { CustomerShell } from "./shell";
import { Seal } from "./voucher";

/** The hero's catchy line; the item rotates (coffee, beer, tacos...). */
function Hero() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % HERO_WORDS.length), 2300);
    return () => clearInterval(t);
  }, []);
  const word = HERO_WORDS[i]!;
  return (
    <section className="pb-7 pt-3">
      <h1 className="font-display text-[39px] leading-[0.95]">
        Win and your
        <br />
        <span className="inline-block min-w-[3ch]" aria-live="polite">
          <span key={word} className="word-in text-ribbon pb-1">
            {word}
          </span>
        </span>
        <br />
        is free.
      </h1>
      <div className="mt-3.5 flex items-center gap-2">
        <p className="text-[14.5px] text-ink-soft">Underdogs only. Money back after the game.</p>
        <HowItWorksButton />
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((k) => (
        <div key={k} className="h-[176px] animate-pulse rounded-[24px] bg-paper-raised" />
      ))}
    </div>
  );
}

export function CouponsHome() {
  const [role, setRole] = useRole();
  const router = useRouter();
  const params = useSearchParams();
  const asCustomer = params.get("as") === "customer";

  useEffect(() => {
    if (role === "merchant" && !asCustomer) router.replace("/merchant");
  }, [role, asCustomer, router]);

  if (role === undefined) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Mark className="h-12 animate-pulse self-center" />
      </div>
    );
  }
  if (role === null) {
    return (
      <RolePick
        onPick={(r) => {
          setRole(r);
          if (r === "merchant") router.push("/merchant");
        }}
      />
    );
  }
  if (role === "merchant" && !asCustomer) return null;
  return <CustomerCoupons />;
}

/** List or map of the same promos (one poll); the choice lives in the URL (?view=map). */
function CustomerCoupons() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") === "map" ? "map" : "list";
  const res = usePoll(() => api.promotions(), 15_000);
  const now = useNowSeconds();
  useCouponRegistry();
  const promos = useMemo(() => (res.data?.promotions ?? []) as Promo[], [res.data]);
  const open = useMemo(
    () =>
      promos.filter(
        (p) =>
          (p.live?.phase === "LIVE" || p.live?.phase === "PAUSED") &&
          (now === null || p.depositDeadline > now),
      ),
    [promos, now],
  );
  const setView = (v: "list" | "map") => {
    const q = new URLSearchParams(params.toString());
    if (v === "map") q.set("view", "map");
    else q.delete("view");
    const s = q.toString();
    router.replace(s ? `/?${s}` : "/", { scroll: false });
  };
  return (
    <CustomerShell flush={view === "map"}>
      <div className="flex items-center justify-between pb-1 pt-3">
        <div
          role="tablist"
          aria-label="View"
          className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-rule"
        >
          {(
            [
              ["list", "List"],
              ["map", "Map"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`h-8 rounded-full px-4 text-[12.5px] font-semibold transition-colors ${view === v ? "bg-ink text-black" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "map" ? <span className="text-[12.5px] text-ink-soft">Austin</span> : null}
      </div>
      {view === "map" ? (
        res.data ? (
          <PromoMap promos={open} now={now} />
        ) : (
          <Skeleton />
        )
      ) : (
        <>
          <Hero />
          <PromoLists res={res} now={now} />
        </>
      )}
    </CustomerShell>
  );
}

function PromoLists({
  res,
  now,
}: {
  res: Polled<{ promotions: PromotionDto[] }>;
  now: number | null;
}) {
  const promos = (res.data?.promotions ?? []) as Promo[];

  const { endingSoon, byShop, paidOut } = useMemo(() => {
    const t = now ?? 0;
    const open = promos.filter(
      (p) => (p.live?.phase === "LIVE" || p.live?.phase === "PAUSED") && p.depositDeadline > t,
    );
    const selling = open
      .filter((p) => p.live?.phase === "LIVE")
      .sort((a, b) => a.depositDeadline - b.depositDeadline);
    const groups = new Map<string, Promo[]>();
    for (const p of [...open].sort((a, b) => Number(b.live?.canBuy) - Number(a.live?.canBuy))) {
      const k = p.shop.merchant;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    return {
      endingSoon: selling.slice(0, 5),
      byShop: [...groups.values()],
      paidOut: promos.filter((p) => p.live?.phase === "RESULT_YES").slice(0, 4),
    };
  }, [promos, now]);

  if (!res.data) {
    return res.error ? (
      <Note
        tone="error"
        title={describe(res.error).title}
        action={
          <Button size="sm" variant="secondary" onClick={res.refresh}>
            Try again
          </Button>
        }
      >
        {describe(res.error).detail}
      </Note>
    ) : (
      <Skeleton />
    );
  }

  if (byShop.length === 0 && paidOut.length === 0) {
    return (
      <div className="rounded-[24px] bg-paper-raised px-6 py-10 text-center ring-1 ring-inset ring-rule">
        <p className="font-title text-[18px]">No promos running right now</p>
        <p className="mt-1.5 text-[13.5px] text-ink-soft">
          Shops post them before big games. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-9">
      {endingSoon.length > 1 ? (
        <section aria-labelledby="ending-soon">
          <SectionTitle>
            <span id="ending-soon">Ending soon</span>
          </SectionTitle>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-1">
            {endingSoon.map((p) => (
              <PromoCard key={p.id} p={p} now={now} variant="compact" />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="by-shop" className="space-y-7">
        <SectionTitle>
          <span id="by-shop">By shop</span>
        </SectionTitle>
        {byShop.map((group) => {
          const shop = group[0]!.shop;
          return (
            <div key={shop.merchant} className="-mt-3 space-y-3">
              <div className="flex items-center gap-3 px-1">
                <span className="font-title grid h-9 w-9 place-items-center rounded-full bg-paper-deep text-[12.5px] ring-1 ring-inset ring-line-strong">
                  {shop.name.charAt(0)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold">{shop.name}</p>
                  {shop.location ? (
                    <p className="truncate text-[11.5px] text-ink-faint">{shop.location}</p>
                  ) : null}
                </div>
              </div>
              {group.map((p) => (
                <PromoCard key={p.id} p={p} now={now} sub="kickoff" />
              ))}
            </div>
          );
        })}
      </section>

      {paidOut.length > 0 ? (
        <section aria-labelledby="paid-out">
          <SectionTitle>
            <span id="paid-out">Just went free</span>
          </SectionTitle>
          <ul className="divide-y divide-rule overflow-hidden rounded-[22px] bg-paper-raised ring-1 ring-inset ring-rule">
            {paidOut.map((p) => (
              <li key={p.id}>
                <Link href={`/checkout/${p.id}`} className="flex items-center gap-3.5 px-4 py-3.5">
                  <Seal seed={p.promoPda ?? p.id} size={42} label={price(p.offerAmount)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold">
                      {p.itemName} at {p.shop.name}
                    </p>
                    <p className="truncate text-[12px] text-ink-soft">{happened(condition(p))}</p>
                  </div>
                  <span className="font-num text-ribbon shrink-0 text-[17px]">Free</span>
                  <span className="sr-only">, {price(p.offerAmount)} back</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
