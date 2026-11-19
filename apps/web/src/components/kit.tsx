"use client";

import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose, IconInfo } from "./icons";

/* ---------- brand ---------- */

/** The bare logo mark (no box). The PNG has a black ground; `screen` drops it on any dark surface. */
export function Mark({ className = "h-7" }: { className?: string }) {
  return (
    <img
      src="/wincentive-mark.png"
      alt=""
      aria-hidden
      className={`w-auto shrink-0 select-none object-contain mix-blend-screen ${className}`}
      draggable={false}
    />
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark className="h-[26px]" />
      <span className="font-title text-[19px] tracking-[-0.03em]">Wincentive</span>
    </span>
  );
}

/* ---------- buttons ---------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-ink text-black hover:bg-white active:bg-[#e8e0f0] disabled:bg-surface-3 disabled:text-ink-3",
  secondary:
    "bg-surface-2 text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-3 disabled:text-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2 disabled:text-ink-3",
  danger: "bg-danger/15 text-danger ring-1 ring-inset ring-danger/30 hover:bg-danger/20",
};
const SIZE: Record<Size, string> = {
  sm: "h-9 rounded-full px-3.5 text-[14px] gap-1.5",
  md: "h-11 rounded-full px-5 text-[15px] gap-2",
  lg: "h-[58px] w-full rounded-[18px] px-6 text-[17px] gap-2.5",
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
  size?: Size;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex shrink-0 select-none items-center justify-center font-semibold transition-[background-color,transform,color] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- notes ---------- */

export function Note({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "error";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const color = tone === "error" ? "text-danger" : tone === "warn" ? "text-sim" : "text-ink-2";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex gap-3 rounded-2xl bg-surface-2 px-4 py-3.5 ring-1 ring-inset ring-line"
    >
      <IconInfo size={18} className={`mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1 text-[14px] leading-snug">
        <p className="font-semibold text-ink">{title}</p>
        {children ? <div className="mt-0.5 text-ink-2">{children}</div> : null}
        {action ? <div className="mt-2.5">{action}</div> : null}
      </div>
    </div>
  );
}

/* ---------- bottom sheet ---------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  tone = "surface",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  tone?: "surface" | "black";
  labelledBy?: string;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  if (!open || !host) return null;
  // Portaled to <body>: an animated (transformed) ancestor would otherwise trap `position: fixed`.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy ?? (title ? id : undefined)}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/70 backdrop-blur-[2px]"
      />
      <div
        className={`relative max-h-[92dvh] w-full max-w-[480px] animate-sheet-up overflow-y-auto rounded-t-[28px] pb-safe ring-1 ring-line ${tone === "black" ? "bg-black" : "bg-surface"}`}
      >
        <div className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-line-strong" />
        </div>
        {title ? (
          <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-1">
            <h2 id={id} className="font-title text-[20px]">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <IconClose />
            </IconButton>
          </div>
        ) : null}
        <div className="px-5 pb-6 pt-2">{children}</div>
      </div>
    </div>,
    host,
  );
}

/* ---------- odds: the big pink percentage from Dylan's prototype ---------- */

export function Odds({
  pct,
  size = 30,
  label = "chance it's free",
  align = "right",
  className = "",
}: {
  pct: number | null;
  size?: number;
  label?: string | null;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const a =
    align === "right"
      ? "items-end text-right"
      : align === "center"
        ? "items-center text-center"
        : "items-start";
  return (
    <div className={`flex flex-col ${a} ${className}`}>
      <span className="font-num text-note" style={{ fontSize: size }}>
        {pct === null ? "–" : `${Math.round(pct)}%`}
      </span>
      {label ? (
        <span className="mt-1 text-[12.5px] font-medium leading-tight text-ink-soft">{label}</span>
      ) : null}
    </div>
  );
}

/* ---------- coupons left meter ---------- */

export function Meter({
  value,
  max,
  hot,
  className = "",
}: {
  value: number;
  max: number;
  hot?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span
      className={`block h-1.5 overflow-hidden rounded-full bg-surface-3 ${className}`}
      aria-hidden
    >
      <span
        className={`block h-full rounded-full transition-[width] duration-500 ${hot ? "bg-orange" : "bg-ink-2"}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

/* ---------- toggle and stepper ---------- */

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors ${checked ? "bg-ribbon" : "bg-surface-3"}`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-[3px] h-6 w-6 rounded-full bg-ink shadow transition-transform duration-200 ${checked ? "translate-x-[23px]" : "translate-x-[3px]"}`}
      />
    </button>
  );
}

/* ---------- the coupon perforation (Dylan's voucher motif, simplified) ---------- */

/** A dashed tear line with a notch cut into each edge of the card. Place inside a `relative` card. */
export function Perforation({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`relative ${className}`}>
      <span className="absolute -left-[26px] top-1/2 h-[20px] w-[20px] -translate-y-1/2 rounded-full bg-bg ring-1 ring-line [clip-path:inset(0_0_0_50%)]" />
      <span className="absolute -right-[26px] top-1/2 h-[20px] w-[20px] -translate-y-1/2 rounded-full bg-bg ring-1 ring-line [clip-path:inset(0_50%_0_0)]" />
      <div className="border-t-2 border-dashed border-line" />
    </div>
  );
}

/* ---------- small layout pieces ---------- */

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-title text-[19px]">{children}</h2>
      {aside ? <div className="text-[13.5px] text-ink-3">{aside}</div> : null}
    </div>
  );
}

export const INPUT =
  "block w-full rounded-[14px] bg-surface-2 px-4 text-[16px] text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-chain disabled:opacity-60";
