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
  return (
    <div className="relative rounded-[22px] bg-paper p-4 ring-1 ring-rule">
      <svg viewBox="0 0 320 132" className="block w-full" aria-hidden>
        <defs>
          <linearGradient id="split-r" x1="0" x2="1">
            <stop offset="0" stopColor="#7a2bff" />
            <stop offset="0.5" stopColor="#e93fd0" />
            <stop offset="1" stopColor="#ff4fb0" />
          </linearGradient>
        </defs>
        <path
          d="M44 66 H110 C140 66 140 28 170 28 H210"
          stroke="#6f6481"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M110 66 C140 66 140 104 170 104 H210"
          stroke="url(#split-r)"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="34" cy="66" r="26" fill="#15101d" stroke="#3c3149" />
        <circle cx="216" cy="28" r="6" fill="#a99db9" />
        <circle cx="216" cy="104" r="7" fill="#ff4fb0" />
      </svg>
      <span className="font-num absolute left-4 top-1/2 w-[60px] -translate-y-1/2 text-center text-[22px]">
        {price}
      </span>
      <div className="absolute right-4 top-[14%] w-[40%] text-[13.5px] leading-tight">
        <p className="font-semibold text-ink">Your {item}, now</p>
        <p className="text-ink-3">Yours either way</p>
      </div>
      <div className="absolute bottom-[12%] right-4 w-[40%] text-[13.5px] leading-tight">
        <p className="font-semibold text-note">{price} back</p>
        <p className="text-ink-2">if {cond}</p>
      </div>
    </div>
  );
}

const STEPS: { title: string; body: string }[] = [
  { title: "Buy it now", body: "Full price, served right away." },
  { title: "Watch the game", body: "Stay, sip, root for the underdog." },
  { title: "Win and it's free", body: "The money lands back in your balance right after." },
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
            <span className="font-num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-[16px]">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-ink">{s.title}</p>
              <p className="text-[14.5px] text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[13.5px] leading-snug text-ink-3">
        Underdogs only: every promo is under 50%, so you beat the odds when it hits. The shop has it
        covered, and nothing extra is ever charged.
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
