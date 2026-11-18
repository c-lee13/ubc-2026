"use client";

import { useId, useState } from "react";
import { useWallet } from "@/lib/wallet/session";
import { Button, inputClass, Notice, Spinner } from "./ui";

/**
 * Email login. The person types an email, Circle emails a code, and that's the whole wallet setup:
 * no app, no seed phrase, no network switch.
 */
export function LoginCard({
  title = "Log in with your email",
  lead,
  compact,
}: {
  title?: string;
  lead?: string;
  compact?: boolean;
}) {
  const w = useWallet();
  const [email, setEmail] = useState("");
  const id = useId();
  const busy = w.phase !== "signed-out" && w.phase !== "ready";

  if (!w.available) {
    return (
      <Notice tone="warn" title="Email login isn't set up">
        Missing NEXT_PUBLIC_CIRCLE_APP_ID.
      </Notice>
    );
  }

  return (
    <form
      className={compact ? "space-y-3" : "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && email.trim()) void w.login(email);
      }}
    >
      {compact ? null : (
        <div>
          <h3 className="font-wide text-[19px] font-bold">{title}</h3>
          {lead ? <p className="mt-1 text-[14.5px] text-ink-soft">{lead}</p> : null}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor={id}>
          Email
        </label>
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className={`${inputClass} h-12 text-[16px]`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <Button
          type="submit"
          size="lg"
          className="h-12 shrink-0"
          busy={busy}
          disabled={!email.trim()}
        >
          {busy ? phaseText(w.phase) : "Email me a code"}
        </Button>
      </div>
      {busy ? (
        <p className="flex items-center gap-2 text-[13.5px] text-ink-soft" aria-live="polite">
          <Spinner /> {phaseDetail(w.phase)}
        </p>
      ) : null}
      {w.problem ? (
        <Notice tone="error" title={w.problem.title}>
          {w.problem.detail}
        </Notice>
      ) : null}
    </form>
  );
}

function phaseText(p: string): string {
  return p === "sending-code"
    ? "Sending…"
    : p === "awaiting-code"
      ? "Check your email"
      : "Setting up…";
}

function phaseDetail(p: string): string {
  switch (p) {
    case "sending-code":
      return "Sending your code…";
    case "awaiting-code":
      return "Enter the code from your email.";
    case "creating-wallet":
      return "Creating your dollar wallet…";
    default:
      return "";
  }
}
