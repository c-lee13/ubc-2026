"use client";

import { useState, type ReactNode } from "react";
import { IconInfo } from "./icons";
import { Sheet } from "./kit";

/**
 * "How it works", upside only: one purchase line that splits into what you get now and what
 * comes back if it happens. Opened from the info icons.
 */
export function SplitVisual({
  item = "latte",
  price = "$5",
  cond = "Texas wins",
}: {
  item?: string;
  price?: string;
  cond?: string;
}) {
  // A row: the price, a fork that splits in two, and what each branch means. Fixed geometry, so
  // the line ends always meet their labels.
  return (
    <div className="flex items-center gap-0 rounded-[22px] bg-paper px-4 py-5 ring-1 ring-rule">
      <span className="font-num grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-paper-raised text-[18.5px] ring-1 ring-line-strong">
        {price}
      </span>
      <svg width="84" height="120" viewBox="0 0 84 120" className="shrink-0" aria-hidden>
        <defs>
          <linearGradient id="split-r" x1="0" x2="1">
            <stop offset="0" stopColor="#7a2bff" />
            <stop offset="0.55" stopColor="#e93fd0" />
            <stop offset="1" stopColor="#ff4fb0" />
          </linearGradient>
        </defs>
        <path
          d="M0 60 H22 C44 60 44 18 66 18 H76"
          stroke="#6f6481"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M22 60 C44 60 44 102 66 102 H76"
          stroke="url(#split-r)"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="78" cy="18" r="5" fill="#a99db9" />
        <circle cx="78" cy="102" r="6" fill="#ff4fb0" />
      </svg>
      <div className="flex h-[120px] min-w-0 flex-1 flex-col justify-between pl-2 text-[12.5px] leading-tight">
        <div className="-mt-1">
          <p className="font-semibold text-ink">Your {item}, now</p>
          <p className="text-ink-faint">Yours either way</p>
        </div>
        <div className="-mb-1">
          <p className="font-semibold text-note">{price} back</p>
          <p className="text-ink-soft">if {cond}</p>
        </div>
      </div>
    </div>
  );
}

const STEPS: { title: string; body: string }[] = [
  { title: "Buy it now", body: "Full price, served right away." },
  { title: "Watch the game", body: "Stay, sip, root for the underdog." },
  { title: "Win and it's free", body: "Your money comes back right after the game." },
];

export function HowItWorks({
  item,
  price,
  cond,
}: {
  item?: string;
  price?: string;
  cond?: string;
}) {
  return (
    <div className="space-y-5">
      <SplitVisual item={item} price={price} cond={cond} />
      <ol className="space-y-3.5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3.5">
            <span className="font-num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-[14px]">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-ink">{s.title}</p>
              <p className="text-[13px] text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[12px] leading-snug text-ink-3">
        Every promo is an underdog, under 50%. Nothing extra is ever charged.
      </p>
    </div>
  );
}

/** An info button that opens How it works. */
export function HowItWorksButton({
  item,
  price,
  cond,
  children,
  className = "",
}: {
  item?: string;
  price?: string;
  cond?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="How it works"
        className={`inline-flex items-center gap-1.5 text-ink-3 transition-colors hover:text-ink ${className}`}
      >
        <IconInfo size={17} />
        {children}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="How it works">
        <HowItWorks item={item} price={price} cond={cond} />
      </Sheet>
    </>
  );
}
