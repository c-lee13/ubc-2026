import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { publicConfig } from "@/lib/config";

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "ghost" | "note";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-white active:translate-y-px disabled:opacity-40",
  note: "bg-ribbon text-white hover:brightness-110 active:translate-y-px disabled:opacity-40",
  secondary:
    "bg-paper-raised text-ink ring-1 ring-ink/25 hover:ring-ink/60 active:translate-y-px disabled:text-ink-faint",
  ghost: "text-ink hover:bg-ink/5 disabled:text-ink-faint",
};

export function Button({
  variant = "primary",
  size = "md",
  busy,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}) {
  const sizes = {
    sm: "h-9 px-3.5 text-sm rounded-md",
    md: "h-11 px-5 text-[15px] rounded-lg",
    lg: "h-14 px-7 text-[17px] rounded-xl",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  const sizes = {
    sm: "h-9 px-3.5 text-sm rounded-md",
    md: "h-11 px-5 text-[15px] rounded-lg",
    lg: "h-14 px-7 text-[17px] rounded-xl",
  };
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 animate-spin ${className}`} aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- Real on-chain vs simulated ---------- */

function OutIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
      <path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * A REAL Arc testnet record (transaction or address) as a plain violet link to the Arc explorer;
 * the full hash is in the tooltip. Never used for anything simulated. In the dev-only fixture every
 * record is made up, so the link turns grey and goes nowhere.
 */
export function ChainLink({
  href,
  label = "View on Arc",
  value,
  network = "Arc testnet",
}: {
  href: string;
  /** What it is, e.g. "Payment". */
  label?: string;
  /** Transaction hash or address (shown in the tooltip). */
  value: string;
  network?: string;
  compact?: boolean;
}) {
  if (publicConfig.walletFixture) {
    return (
      <span
        title={`${value} (fixture: not a real ${network} record)`}
        className="text-[13px] font-semibold text-ink-faint line-through decoration-ink-faint/50"
      >
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`${value} (real ${network} record)`}
      className="inline-flex items-center gap-1 text-[13px] font-semibold text-chain underline decoration-chain/40 underline-offset-2 hover:decoration-chain"
    >
      {label}
      <OutIcon />
    </a>
  );
}

/** Marks a number as a SIMULATED hedge (no Gemini order exists). Ochre, dashed, never violet. */
export function SimTag({ children = "Simulated hedge" }: { children?: ReactNode }) {
  return (
    <span
      title="Priced from Gemini's live order book. No order is placed."
      className="text-[12px] font-semibold whitespace-nowrap text-sim underline decoration-sim/60 decoration-dashed underline-offset-[3px]"
    >
      {children}
    </span>
  );
}

export function ChainTag({ children = "On Arc" }: { children?: ReactNode }) {
  return (
    <span title="Real record on Arc testnet" className="text-[12px] font-semibold text-chain">
      {children}
    </span>
  );
}

/** A panel of simulated figures: dashed ochre edge, hatched heading strip. */
export function SimPanel({
  title,
  note,
  children,
  className = "",
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-xl border border-dashed border-sim/60 bg-paper-raised ${className}`}
    >
      <header className="bg-hatch-soft flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-sim/50 px-4 py-2">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <SimTag />
      </header>
      <div className="px-4 py-3">{children}</div>
      {note ? <p className="px-4 pb-3 text-[12.5px] text-ink-soft">{note}</p> : null}
    </section>
  );
}

/* ---------- Messages ---------- */

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "error" | "ok";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "bg-paper-raised ring-ink/15 [--bar:var(--color-ink)]",
    warn: "bg-sim-soft/70 ring-sim/30 [--bar:var(--color-sim)]",
    error: "bg-stamp-soft/70 ring-stamp/30 [--bar:var(--color-stamp)]",
    ok: "bg-note-soft/70 ring-note/30 [--bar:var(--color-note)]",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`relative overflow-hidden rounded-lg py-3 pr-4 pl-5 ring-1 ${tones[tone]}`}
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[var(--bar)]" aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          {children ? <div className="mt-0.5 text-[14px] text-ink-soft">{children}</div> : null}
        </div>
        {action}
      </div>
    </div>
  );
}

/* ---------- Layout bits ---------- */

export function Stat({
  label,
  value,
  tag,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  /** "Simulated hedge" or "On Arc", shown under the number. */
  tag?: ReactNode;
  /** Detail on hover. */
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[13px] text-ink-soft">{label}</div>
      <div className="font-display mt-1.5 text-[40px] leading-none">{value}</div>
      {tag ? <div className="mt-1.5">{tag}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  /** Shown on hover, not inline. */
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[14px] font-semibold">
        {label}
        {hint ? <Info text={hint} /> : null}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Edge-case detail lives here: a small "i" with the text in its tooltip. */
export function Info({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      className="inline-grid h-4 w-4 cursor-help place-items-center rounded-full text-[10px] font-bold text-ink-soft ring-1 ring-ink/30"
    >
      i
    </span>
  );
}

export const inputClass =
  "h-11 w-full rounded-lg bg-paper-raised px-3 text-[15px] ring-1 ring-ink/20 outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-chain";
