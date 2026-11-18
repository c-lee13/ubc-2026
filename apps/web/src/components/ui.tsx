import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { publicConfig } from "@/lib/config";
import { shortAddr } from "@/lib/format";

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "ghost" | "note";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink text-paper-raised hover:bg-[#1d3157] active:translate-y-px disabled:bg-ink-faint disabled:text-paper",
  note: "bg-note text-paper-raised hover:bg-[#185a4c] active:translate-y-px disabled:bg-ink-faint",
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
 * A REAL Arc testnet record (transaction or address), opening the Arc explorer. Violet and solid,
 * never used for anything simulated. In the dev-only wallet fixture every record is made up, so
 * the same chip turns grey, says so, and links nowhere.
 */
export function ChainLink({
  href,
  label,
  value,
  network = "Arc testnet",
  compact,
}: {
  href: string;
  /** What it is, e.g. "Payment" or "Escrow". */
  label?: string;
  /** Transaction hash or address, shortened in the UI. */
  value: string;
  network?: string;
  compact?: boolean;
}) {
  if (publicConfig.walletFixture) {
    return (
      <span
        title={`${label ? `${label}: ` : ""}${value} (fixture: not a real ${network} record)`}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-paper-deep px-2 py-0.5 text-[13px] text-ink-soft border border-dashed border-ink/30"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-current" aria-hidden />
        {compact ? null : <span className="font-semibold">{label ?? network}</span>}
        <span className="truncate font-mono text-[12px]">{shortAddr(value, compact ? 4 : 5)}</span>
        <span className="text-[11px] text-stamp">fixture</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`${label ? `${label}: ` : ""}${value} (real ${network} record, opens the Arc explorer)`}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md bg-chain-soft px-2 py-0.5 text-[13px] text-chain ring-1 ring-chain/25 transition-colors hover:bg-chain hover:text-paper-raised"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      {compact ? null : <span className="font-semibold">{label ?? network}</span>}
      <span className="truncate font-mono text-[12px]">{shortAddr(value, compact ? 4 : 5)}</span>
      <OutIcon />
    </a>
  );
}

/** Marks a value as SIMULATED (no Gemini order exists). Hatched ochre, never violet. */
export function SimTag({ children = "Simulated hedge" }: { children?: ReactNode }) {
  return (
    <span className="bg-hatch-soft inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[12px] font-semibold text-sim ring-1 ring-sim/35">
      {children}
    </span>
  );
}

export function ChainTag({ children = "On Arc" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-chain-soft px-1.5 py-px text-[12px] font-semibold text-chain ring-1 ring-chain/25">
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
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
  sub,
  sim,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  sim?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
        {label}
        {sim ? <SimTag /> : null}
      </div>
      <div className="font-wide mt-1 text-[26px] leading-tight font-bold tracking-[-0.01em]">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[13px] text-ink-soft">{sub}</div> : null}
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
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[14px] font-semibold">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[13px] text-ink-soft">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "h-11 w-full rounded-lg bg-paper-raised px-3 text-[15px] ring-1 ring-ink/20 outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-chain";
