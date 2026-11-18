"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { api } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { usd } from "@/lib/format";
import { useWallet } from "@/lib/wallet/session";
import { LoginCard } from "./login-card";
import { Button, Notice } from "./ui";

/** Header account control: "Log in", or the signed-in email with its dollar balance. */
export function AccountButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (w.phase === "ready") setOpen(false);
  }, [w.phase]);

  const ready = mounted && w.phase === "ready" && w.wallet;
  return (
    <div className="relative" ref={ref}>
      {ready ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="max-w-[9rem] truncate">{w.email}</span>
          <strong className="text-note">{usd(w.wallet!.usdcBalance)}</strong>
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Log in
        </Button>
      )}
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(92vw,380px)] rounded-[20px] border border-[#E6E1D8] bg-white p-5 shadow-[0_28px_56px_-28px_rgba(33,29,40,0.32)]">
          {ready ? <AccountMenu onDone={() => setOpen(false)} /> : <LoginCard />}
        </div>
      ) : null}
    </div>
  );
}

function AccountMenu({ onDone }: { onDone: () => void }) {
  const w = useWallet();
  const wallet = w.wallet!;
  return (
    <div className="space-y-3">
      <div>
        <p className="truncate text-[14px] font-semibold text-ink-soft">{w.email}</p>
      </div>
      <p className="font-display text-[34px] leading-none">{usd(wallet.usdcBalance)}</p>
      <AddUsdc compact />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          title={wallet.address}
          onClick={() => void navigator.clipboard?.writeText(wallet.address)}
        >
          Copy wallet address
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onDone();
            w.logout();
          }}
        >
          Log out
        </Button>
      </div>
    </div>
  );
}

/**
 * Test USDC: Circle's faucet through our API; when Circle refuses (about one drip a day per
 * wallet), point to faucet.circle.com with the address ready to paste.
 */
export function AddUsdc({
  compact,
  primary,
  onAdded,
}: {
  compact?: boolean;
  /** The screen's one action: full-width primary button. */
  primary?: boolean;
  onAdded?: () => void;
}) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [fallback, setFallback] = useState(false);
  const [ok, setOk] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!w.wallet) return null;
  const address = w.wallet.address;

  async function drip() {
    setBusy(true);
    setProblem(null);
    setOk(false);
    try {
      await api.faucet(w.wallet!.id);
      setOk(true);
      // Circle's drip lands within seconds; refresh twice to catch it.
      await w.refreshWallet();
      setTimeout(() => void w.refreshWallet().then(() => onAdded?.()), 4000);
    } catch (err) {
      if (err instanceof ApiError && err.code === "faucet_unavailable") setFallback(true);
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button
        size={primary ? "lg" : compact ? "sm" : "md"}
        variant={primary ? "primary" : "secondary"}
        className={primary ? "h-16 w-full text-[19px]" : undefined}
        busy={busy}
        onClick={drip}
      >
        Add free test dollars
      </Button>
      {ok ? <p className="text-[13px] text-note">On its way.</p> : null}
      {problem ? (
        <Notice tone={fallback ? "warn" : "error"} title={problem.title}>
          {fallback ? (
            <>
              <a
                className="font-semibold text-ink underline"
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                title="Pick Arc Testnet and paste your wallet address"
              >
                Use faucet.circle.com
              </a>
              <span className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[12px] break-all text-ink">
                  {address}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard?.writeText(address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </span>
            </>
          ) : (
            problem.detail
          )}
        </Notice>
      ) : null}
    </div>
  );
}
