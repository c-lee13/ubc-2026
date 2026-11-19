"use client";

import { useId, useState } from "react";
import { useWallet } from "@/lib/wallet/session";
import { Button, INPUT, Note, Spinner } from "./kit";

/**
 * Email login (Circle email wallets, docs/FRONTEND-API.md "Login"). Type an email, get a code,
 * done: no app, no seed phrase. Logging in never starts a payment.
 */
export function LoginCard({
  cta = "Continue",
  hint = "We'll email you a code.",
}: {
  cta?: string;
  hint?: string | null;
}) {
  const w = useWallet();
  const [email, setEmail] = useState("");
  const id = useId();
  const busy = w.phase !== "signed-out" && w.phase !== "ready";

  if (!w.available) {
    return (
      <Note tone="warn" title="Sign-in isn't set up on this site">
        It needs NEXT_PUBLIC_CIRCLE_APP_ID.
      </Note>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && email.trim()) void w.login(email);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Email
      </label>
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@email.com"
        className={`${INPUT} h-14`}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
      />
      <Button type="submit" size="lg" busy={busy} disabled={!email.trim()}>
        {busy ? phaseText(w.phase) : cta}
      </Button>
      {busy ? (
        <p
          className="flex items-center justify-center gap-2 text-[14px] text-ink-2"
          aria-live="polite"
        >
          <Spinner /> {phaseDetail(w.phase)}
        </p>
      ) : hint ? (
        <p className="text-center text-[13.5px] text-ink-3">{hint}</p>
      ) : null}
      {w.problem ? (
        <Note tone="error" title={w.problem.title}>
          {w.problem.detail}
        </Note>
      ) : null}
    </form>
  );
}

function phaseText(p: string): string {
  return p === "sending-code"
    ? "Sending code"
    : p === "awaiting-code"
      ? "Check your email"
      : "Setting up";
}

function phaseDetail(p: string): string {
  switch (p) {
    case "sending-code":
      return "Sending your code";
    case "awaiting-code":
      return "Enter the code from your email";
    case "creating-wallet":
      return "Setting up your balance";
    default:
      return "";
  }
}
