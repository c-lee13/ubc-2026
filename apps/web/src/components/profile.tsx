"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usd } from "@/lib/format";
import { NEIGHBORHOODS } from "@/lib/places";
import { createShopAccount, hasShopAccount, useRole } from "@/lib/role";
import { useWallet } from "@/lib/wallet/session";
import { AddMoneySheet } from "./add-money";
import { HowItWorks } from "./how-it-works";
import { IconBack, IconChevron, IconCopy, IconInfo, IconSignOut, IconStore } from "./icons";
import { Button, INPUT, Sheet } from "./kit";
import { LoginCard } from "./login-card";

/** Profile: the Customer / Merchant switch (or shop setup), balance and Add money, how it works, sign out. */
export function Profile() {
  const w = useWallet();
  const router = useRouter();
  const [role, setRole] = useRole();
  const [mounted, setMounted] = useState(false);
  const [topUp, setTopUp] = useState(false);
  const [how, setHow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [setup, setSetup] = useState(false);
  const [shopName, setShopName] = useState("");
  const [hood, setHood] = useState(NEIGHBORHOODS[0]!.name);
  useEffect(() => setMounted(true), []);
  const ready = mounted && w.phase === "ready" && w.wallet;
  const merchant = role === "merchant";
  const hasShop = mounted && (merchant || hasShopAccount());
  const switchTo = (r: "customer" | "merchant") => {
    if (r === role) return;
    setRole(r);
    router.push(r === "merchant" ? "/merchant" : "/");
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-4 pb-12">
      <header className="flex h-[60px] items-center">
        <button
          type="button"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push(merchant ? "/merchant" : "/")
          }
          aria-label="Back"
          className="-ml-2 grid h-10 w-10 place-items-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink"
        >
          <IconBack size={22} />
        </button>
      </header>

      {hasShop ? (
        <div
          role="tablist"
          aria-label="Mode"
          className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-rule"
        >
          {(
            [
              ["customer", "Customer"],
              ["merchant", "Merchant"],
            ] as const
          ).map(([r, label]) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={(role ?? "customer") === r}
              onClick={() => switchTo(r)}
              className={`h-10 rounded-full text-[13.5px] font-semibold transition-colors ${(role ?? "customer") === r ? "bg-ink text-black" : "text-ink-soft hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {ready ? (
        <>
          <div className="flex items-center gap-4 pt-2">
            <span className="font-display grid h-16 w-16 place-items-center rounded-full bg-ribbon text-[25px] text-white">
              {(w.email?.[0] ?? "").toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="font-title truncate text-[18px]">{w.email}</p>
              <p className="text-[12.5px] text-ink-soft">
                {merchant ? "Shop account" : "Customer"}
              </p>
            </div>
          </div>

          <section className="mt-6 rounded-[28px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
            <p className="text-[12.5px] text-ink-soft">Balance</p>
            <p className="font-num mt-1 text-[53.5px]">{usd(w.wallet!.usdcBalance)}</p>
            <Button size="lg" className="mt-4" onClick={() => setTopUp(true)}>
              Add money
            </Button>
          </section>
        </>
      ) : (
        <section className="rounded-[28px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
          <p className="font-display text-[26.5px]">Sign in</p>
          <p className="mb-4 mt-1.5 text-[13.5px] text-ink-soft">
            Your balance, coupons and order codes, on any phone.
          </p>
          <LoginCard />
        </section>
      )}

      <ul className="mt-5 divide-y divide-rule overflow-hidden rounded-[24px] bg-paper-raised ring-1 ring-inset ring-rule">
        {mounted && !hasShop ? (
          <li>
            <button
              type="button"
              onClick={() => setSetup(true)}
              className="flex w-full items-center gap-3.5 px-4 py-4 text-left hover:bg-surface-2"
            >
              <IconStore size={22} className="shrink-0 text-ink-soft" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Set up a shop account</p>
                <p className="text-[12px] text-ink-soft">Run promos for your shop</p>
              </div>
              <IconChevron size={18} className="text-ink-faint" />
            </button>
          </li>
        ) : null}
        <li>
          <button
            type="button"
            onClick={() => setHow(true)}
            className="flex w-full items-center gap-3.5 px-4 py-4 text-left hover:bg-surface-2"
          >
            <IconInfo size={22} className="text-ink-soft" />
            <span className="flex-1 font-semibold">How it works</span>
            <IconChevron size={18} className="text-ink-faint" />
          </button>
        </li>
        {ready ? (
          <>
            <li>
              <button
                type="button"
                onClick={() => {
                  if (!navigator.clipboard) return;
                  void navigator.clipboard.writeText(w.wallet!.address).then(() => setCopied(true));
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex w-full items-center gap-3.5 px-4 py-4 text-left hover:bg-surface-2"
              >
                <IconCopy size={22} className="text-ink-soft" />
                <span className="flex-1 font-semibold">
                  {copied ? "Copied" : "Copy wallet address"}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => w.logout()}
                className="flex w-full items-center gap-3.5 px-4 py-4 text-left hover:bg-surface-2"
              >
                <IconSignOut size={22} className="text-ink-soft" />
                <span className="flex-1 font-semibold">Sign out</span>
              </button>
            </li>
          </>
        ) : null}
      </ul>
      <p className="mt-6 text-center text-[11px] text-ink-faint">
        Payments by Circle on Arc. Test mode.
      </p>

      <AddMoneySheet open={topUp} onClose={() => setTopUp(false)} />
      <Sheet open={setup} onClose={() => setSetup(false)} title="Set up your shop">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!shopName.trim()) return;
            createShopAccount(shopName.trim(), hood);
            setSetup(false);
            router.push("/merchant");
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">Shop name</span>
            <input
              className={`${INPUT} h-12`}
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              maxLength={80}
              placeholder="Barton Springs Coffee Co."
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink-soft">Neighborhood</span>
            <select
              className={`${INPUT} h-12 appearance-none`}
              value={hood}
              onChange={(e) => setHood(e.target.value)}
            >
              {NEIGHBORHOODS.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}, Austin
                </option>
              ))}
            </select>
          </label>
          <Button size="lg" type="submit" disabled={!shopName.trim()}>
            Create shop account
          </Button>
          <p className="text-center text-[12px] text-ink-soft">
            Same login. Switch between Customer and Merchant anytime.
          </p>
        </form>
      </Sheet>
      <Sheet open={how} onClose={() => setHow(false)} title="How it works">
        <HowItWorks />
      </Sheet>
    </main>
  );
}
