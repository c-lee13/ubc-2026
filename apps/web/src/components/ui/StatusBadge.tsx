import type { PurchaseStatus } from "@hedged/shared";

/**
 * Label + colors for every PurchaseStatus. Typed as a Record so TypeScript errors here if the
 * shared status list changes and this table is not updated.
 *
 * Palette: muted purple for normal progress, with restrained green / amber / red / slate accents.
 * "Hedge simulated" keeps the simulation wording: no real Gemini order is ever placed.
 */
const STATUS_STYLES: Record<PurchaseStatus, { label: string; classes: string }> = {
  DEPOSITED: { label: "Deposited", classes: "bg-violet-100 text-violet-900 ring-violet-300" },
  PENDING_HEDGE: { label: "Pending hedge", classes: "bg-amber-100 text-amber-900 ring-amber-300" },
  HEDGE_SIMULATED: {
    label: "Hedge simulated",
    classes: "bg-indigo-100 text-indigo-900 ring-indigo-300",
  },
  HEDGED: { label: "Hedged", classes: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  HEDGE_FAILED: { label: "Hedge failed", classes: "bg-rose-100 text-rose-900 ring-rose-300" },
  CANCEL_PENDING: {
    label: "Cancel pending",
    classes: "bg-amber-100 text-amber-900 ring-amber-300",
  },
  CANCELLED: { label: "Cancelled", classes: "bg-slate-100 text-slate-800 ring-slate-300" },
  REFUNDED: { label: "Refunded", classes: "bg-slate-100 text-slate-800 ring-slate-300" },
  RESOLVED: { label: "Resolved", classes: "bg-purple-100 text-purple-900 ring-purple-300" },
  CLAIMED: { label: "Claimed", classes: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
};

export function StatusBadge({ status }: { status: PurchaseStatus }) {
  const { label, classes } = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${classes}`}
    >
      {label}
    </span>
  );
}
