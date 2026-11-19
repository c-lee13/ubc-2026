"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usd } from "@/lib/format";
import { useRole } from "@/lib/role";
import { useWallet } from "@/lib/wallet/session";
import { AddMoneySheet } from "./add-money";
import { HowItWorks } from "./how-it-works";
import { IconBack, IconChevron, IconCopy, IconInfo, IconSignOut, IconStore } from "./icons";
import { Button, Sheet, Toggle } from "./kit";
import { LoginCard } from "./login-card";

/** Profile: balance and Add money, the Merchant workspace switch, how it works, sign out. */
export function Profile() {
  const w = useWallet();
  const router = useRouter();
  const [role, setRole] = useRole();
  const [mounted, setMounted] = useState(false);
  const [topUp, setTopUp] = useState(false);
  const [how, setHow] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setMounted(true), []);
  const ready = mounted && w.phase === "ready" && w.wallet;
  const merchant = role === "merchant";

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

      {ready ? (
        <>
          <div className="flex items-center gap-4 pt-2">
            <span className="font-display grid h-16 w-16 place-items-center rounded-full bg-ribbon text-[28px] text-white">
              {(w.email?.[0] ?? "").toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="font-title truncate text-[20px]">{w.email}</p>
              <p className="text-[14px] text-ink-soft">{merchant ? "Shop account" : "Customer"}</p>
            </div>
          </div>

          <section className="mt-6 rounded-[28px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
            <p className="text-[14px] text-ink-soft">Balance</p>
            <p className="font-num mt-1 text-[60px]">{usd(w.wallet!.usdcBalance)}</p>
            <Button size="lg" className="mt-4" onClick={() => setTopUp(true)}>
              Add money
            </Button>
            <p className="mt-3 text-center text-[12.5px] text-ink-faint">USDC on Arc testnet</p>
          </section>
        </>
      ) : (
        <section className="rounded-[28px] bg-paper-raised p-5 ring-1 ring-inset ring-rule">
          <p className="font-display text-[30px]">Sign in</p>
          <p className="mb-4 mt-1.5 text-[15px] text-ink-soft">
            Your balance, coupons and order codes, on any phone.
          </p>
          <LoginCard />
        </section>
      )}

      <ul className="mt-5 divide-y divide-rule overflow-hidden rounded-[24px] bg-paper-raised ring-1 ring-inset ring-rule">
        <li className="flex items-center gap-3.5 px-4 py-4">
          <IconStore size={22} className="shrink-0 text-ink-soft" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Merchant workspace</p>
            <p className="text-[13.5px] text-ink-soft">Run promos for your shop</p>
          </div>
          <Toggle
            label="Merchant workspace"
            checked={merchant}
            onChange={(on) => {
              setRole(on ? "merchant" : "customer");
              router.push(on ? "/merchant" : "/");
            }}
          />
        </li>
        {merchant ? (
          <li>
            <Link
              href="/merchant"
              className="flex items-center gap-3.5 px-4 py-4 hover:bg-surface-2"
            >
              <span className="w-[22px]" />
              <span className="flex-1 font-semibold">Open workspace</span>
              <IconChevron size={18} className="text-ink-faint" />
            </Link>
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
                  void navigator.clipboard?.writeText(w.wallet!.address);
                  setCopied(true);
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

      <AddMoneySheet open={topUp} onClose={() => setTopUp(false)} />
      <Sheet open={how} onClose={() => setHow(false)} title="How it works">
        <HowItWorks />
      </Sheet>
    </main>
  );
}
