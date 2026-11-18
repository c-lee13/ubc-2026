import type { ReactNode } from "react";
import { Spinner } from "./ui";

export type StepState = "todo" | "doing" | "done" | "error" | "skipped";

export interface ProgressStep {
  key: string;
  label: ReactNode;
  state: StepState;
  detail?: ReactNode;
}

/** A short ordered checklist for multi-step actions (save, sign, confirm, verify). */
export function Progress({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s) => (
        <li key={s.key} className="flex gap-3">
          <Dot state={s.state} />
          <div className="min-w-0 pt-px">
            <p
              className={`text-[14.5px] ${s.state === "todo" || s.state === "skipped" ? "text-ink-faint" : "font-semibold"}`}
            >
              {s.label}
            </p>
            {s.detail ? <div className="mt-0.5 text-[13px] text-ink-soft">{s.detail}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Dot({ state }: { state: StepState }) {
  if (state === "doing") {
    return (
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-chain">
        <Spinner />
      </span>
    );
  }
  const cls = {
    todo: "ring-1 ring-ink/25",
    skipped: "ring-1 ring-ink/15",
    done: "bg-note text-paper-raised",
    error: "bg-stamp text-paper-raised",
  }[state];
  return (
    <span
      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${cls}`}
      aria-hidden
    >
      {state === "done" ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : state === "error" ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3">
          <path d="M3 3l6 6M9 3 3 9" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : null}
    </span>
  );
}
