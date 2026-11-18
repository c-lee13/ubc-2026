import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { publicConfig } from "@/lib/config";

/* ---------- Buttons (Zahin's pill buttons) ---------- */

type Variant = "primary" | "secondary" | "ghost" | "note";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[#6133A7] text-white hover:bg-[#4E2890] disabled:bg-[#E6E1D8] disabled:text-[#5A5463]",
  note: "bg-ribbon text-white hover:brightness-110 disabled:opacity-40",
  secondary:
    "border border-[#211D28]/30 text-[#211D28] hover:border-[#211D28] hover:bg-white disabled:text-ink-faint",
  ghost: "text-[#6133A7] hover:bg-[#6133A7]/[0.06] disabled:text-ink-faint",
};

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]";

const SIZES = {
  sm: "h-9 px-4 text-sm rounded-full",
  md: "h-11 px-6 text-[15px] rounded-full",
  lg: "min-h-12 px-7 text-base rounded-full",
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
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${FOCUS_RING} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
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
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors ${FOCUS_RING} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
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
  // Zahin's message blocks: a 3px left rule on a tinted ground.
  const tones = {
    info: "border-[#211D28]/40 bg-white text-[#211D28]",
    warn: "border-[#F58C38] bg-[#FDEBD9]/60 text-[#211D28]",
    error: "border-[#C4372B] bg-[#FCEDEB] text-[#8A1F16]",
    ok: "border-[#1E8A5A] bg-[#EAF6F0] text-[#14513A]",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`border-l-[3px] p-4 text-sm leading-relaxed ${tones[tone]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          {children ? <div className="mt-1 text-[#4E4858]">{children}</div> : null}
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

/** Zahin's input: 16px on phones (no iOS focus zoom), 14px from sm up. */
export const inputClass =
  "block h-11 w-full rounded-[10px] border border-[#CFC8BC] bg-white px-3.5 text-base text-[#211D28] placeholder:text-[#6B6575] focus:border-[#6133A7] focus:outline-none focus:ring-2 focus:ring-[#6133A7]/20 sm:text-sm";
