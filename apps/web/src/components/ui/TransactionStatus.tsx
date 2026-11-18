// Purely presentational transaction status (Zahin's component, reworded for Circle wallets on
// Arc). It renders EXACTLY the state it is given.
//
// - No hooks, no wallet access, no RPC calls, no transaction submission, no timers and no
//   automatic progress. It never changes state by itself; only new props change what it shows.
// - It cannot start, approve, send or confirm anything.
//
// IMPORTANT for integrators: supply `confirmed` ONLY after the transaction has actually been
// confirmed on Arc (for a payment: the promo server's receipt for it exists). Never show
// `confirmed` optimistically, for a fixture, or when the outcome is merely unknown. If the outcome
// is unknown (e.g. a confirmation timeout), keep `confirming` or re-check; do not guess.
//
// How a flow drives it (the parent owns the state):
//   idle -> wallet_required            (not logged in)
//   idle -> awaiting_signature         (Circle's approval window is open)
//   awaiting_signature -> submitted    (the person approved; Circle sends it)
//   submitted -> confirming            (waiting for Arc and the promo server)
//   confirming -> confirmed            (only after real confirmation)
//   any -> failed                      (declined, errored, or confirmed as failed; pass a safe message)

/** Transaction lifecycle state, supplied by the caller. */
export type TransactionState =
  | { status: "idle" }
  | { status: "wallet_required" }
  | { status: "awaiting_signature"; what?: string }
  /** `txHash` must be a REAL Arc transaction hash. Never invent one. */
  | { status: "submitted"; txHash?: string }
  | { status: "confirming"; txHash?: string }
  /** Only after actual confirmation (see the note above). */
  | { status: "confirmed"; txHash?: string }
  /** `message` is shown to the user: pass a short, user-safe reason (no secrets, no raw dumps). */
  | { status: "failed"; message?: string };

type Tone = "stone" | "orange" | "violet" | "green" | "red";
type Indicator = "ring" | "bang" | "spinner" | "dot" | "check" | "cross";

const STATES: Record<
  TransactionState["status"],
  { title: string; body: string; tone: Tone; indicator: Indicator }
> = {
  idle: {
    title: "No transaction started",
    body: "Nothing has been sent to your wallet or to Arc.",
    tone: "stone",
    indicator: "ring",
  },
  wallet_required: {
    title: "Log in needed",
    body: "Log in with your email to continue. Nothing has been sent.",
    tone: "orange",
    indicator: "bang",
  },
  awaiting_signature: {
    title: "Waiting for your approval",
    body: "Review and approve the request in Circle's window. Nothing is sent until you approve.",
    tone: "violet",
    indicator: "spinner",
  },
  submitted: {
    title: "Approved",
    body: "Circle is sending it to Arc. It is not confirmed yet.",
    tone: "violet",
    indicator: "dot",
  },
  confirming: {
    title: "Waiting for confirmation",
    body: "Waiting for Arc to confirm it and the promo server to record it.",
    tone: "violet",
    indicator: "spinner",
  },
  confirmed: {
    title: "Confirmed on Arc",
    body: "The transaction was confirmed on Arc testnet.",
    tone: "green",
    indicator: "check",
  },
  failed: {
    title: "Transaction failed",
    body: "It did not complete. Try again.",
    tone: "red",
    indicator: "cross",
  },
};

const TONES: Record<Tone, { box: string; indicator: string; title: string }> = {
  stone: {
    box: "border-stone-200 bg-stone-50",
    indicator: "border-stone-400 text-stone-500",
    title: "text-stone-900",
  },
  orange: {
    box: "border-orange-200 bg-orange-50",
    indicator: "border-orange-500 bg-orange-100 text-orange-800",
    title: "text-orange-900",
  },
  violet: {
    box: "border-violet-200 bg-violet-50",
    indicator: "border-violet-600 text-violet-700",
    title: "text-violet-900",
  },
  green: {
    box: "border-emerald-200 bg-emerald-50",
    indicator: "border-emerald-600 bg-emerald-100 text-emerald-800",
    title: "text-emerald-900",
  },
  red: {
    box: "border-red-200 bg-red-50",
    indicator: "border-red-600 bg-red-100 text-red-800",
    title: "text-red-900",
  },
};

// An Arc (EVM) transaction hash is 32 bytes: 0x + 64 hex characters. Anything else is NOT shown,
// so a made-up or malformed string can never appear as a transaction.
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_MESSAGE_LENGTH = 200;

function shorten(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function IndicatorIcon({ kind, className }: { kind: Indicator; className: string }) {
  const base = `flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold leading-none ${className}`;
  if (kind === "spinner") {
    // Spins only while waiting; users who prefer reduced motion get a static ring.
    return (
      <span
        aria-hidden
        className={`h-6 w-6 shrink-0 rounded-full border-2 border-t-transparent animate-spin motion-reduce:animate-none ${className}`}
      />
    );
  }
  const glyph = { ring: "", bang: "!", dot: "", check: "✓", cross: "✕" }[kind];
  return (
    <span aria-hidden className={base}>
      {kind === "dot" ? <span className="h-2 w-2 rounded-full bg-current" /> : glyph}
    </span>
  );
}

export function TransactionStatus({
  state,
  explorerTx,
  className = "",
}: {
  state: TransactionState;
  /** Explorer URL for a transaction hash (chain().explorerTx). */
  explorerTx?: (hash: string) => string;
  className?: string;
}) {
  const config = STATES[state.status];
  const tone = TONES[config.tone];

  const rawHash = "txHash" in state ? state.txHash : undefined;
  const txHash = rawHash && TX_HASH_RE.test(rawHash) ? rawHash : undefined;
  const what = state.status === "awaiting_signature" ? state.what : undefined;

  const failureMessage =
    state.status === "failed" ? state.message?.trim().slice(0, MAX_MESSAGE_LENGTH) : undefined;

  return (
    <div
      // Failures are announced assertively; everything else politely.
      role={state.status === "failed" ? "alert" : "status"}
      aria-live={state.status === "failed" ? "assertive" : "polite"}
      className={`flex items-start gap-3 rounded-lg border p-3 sm:p-4 ${tone.box} ${className}`}
    >
      <IndicatorIcon kind={config.indicator} className={tone.indicator} />
      <div className="min-w-0 text-sm">
        <p className={`font-semibold ${tone.title}`}>{config.title}</p>
        {what ? <p className="mt-0.5 font-medium text-stone-800">{what}</p> : null}
        <p className="mt-0.5 leading-relaxed text-stone-700">{config.body}</p>

        {failureMessage && (
          <p className="mt-1.5 break-words leading-relaxed text-red-900">
            <span className="font-medium">Reason:</span> {failureMessage}
          </p>
        )}

        {txHash && (
          <p className="mt-1.5 text-xs text-stone-600">
            <span className="font-medium">Arc transaction:</span>{" "}
            {explorerTx ? (
              <a
                href={explorerTx(txHash)}
                target="_blank"
                rel="noreferrer"
                title={txHash}
                className="font-mono underline underline-offset-2"
              >
                {shorten(txHash)}
              </a>
            ) : (
              <span title={txHash} className="font-mono">
                {shorten(txHash)}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
