// Zahin's class fragments, shared by every page (full class names, so Tailwind can see them).
// Each page used to repeat these; the values are unchanged.

export const DISPLAY = "font-[family-name:var(--font-display)]";

export const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7] focus-visible:rounded-sm";

export const BRAND_HAIRLINE = "bg-[linear-gradient(90deg,#6133A7,#B13BD8_38%,#F5539C_62%,#F58C38)]";

/** Small uppercase label with the orange rule, above each page headline. */
export const EYEBROW =
  "flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-[#6133A7]";
export const EYEBROW_RULE = "h-[3px] w-8 rounded-full bg-[#F58C38]";

/** Page headline (clamp sizes vary per page, so pages add their own text size). */
export const H1 = `${DISPLAY} font-semibold leading-[0.95] tracking-[-0.045em]`;

export const BTN_PRIMARY =
  "inline-flex items-center justify-center rounded-full bg-[#6133A7] px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#4E2890] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]";
export const BTN_SECONDARY =
  "inline-flex items-center justify-center rounded-full border border-[#211D28]/30 px-7 py-3.5 text-base font-semibold text-[#211D28] transition-colors hover:border-[#211D28] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]";
export const BTN_SMALL =
  "inline-flex items-center justify-center rounded-full border border-[#211D28]/30 px-5 py-2.5 text-sm font-semibold transition-colors hover:border-[#211D28] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7]";
/** The one big action in a panel (Pay, Claim): full width. Disabled = Zahin's grey pill. */
export const BTN_BLOCK =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#6133A7] px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-[#4E2890] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6133A7] disabled:cursor-not-allowed disabled:bg-[#E6E1D8] disabled:text-[#5A5463]";

export const LINK = `font-semibold text-[#6133A7] underline underline-offset-4 hover:text-[#4E2890] ${FOCUS}`;
export const BACK_LINK = `-my-3 inline-flex min-h-11 items-center text-sm font-medium text-[#6133A7] underline-offset-4 hover:underline ${FOCUS}`;

/** Pills: orange = illustrative / simulated / waiting, purple = live, grey = not connected. */
export const PILL_ORANGE = "rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]";
export const PILL_PURPLE = "rounded-full bg-[#6133A7] px-3 py-1 text-xs font-bold text-white";
export const PILL_GREY = "rounded-full bg-[#ECE8E0] px-3 py-1 text-xs font-bold text-[#4E4858]";
export const PILL_GREEN = "rounded-full bg-[#EAF6F0] px-3 py-1 text-xs font-bold text-[#14513A]";

/** White card with Zahin's long soft shadow (offer tickets, receipts). */
export const TICKET =
  "relative overflow-hidden rounded-[20px] border border-[#E6E1D8] bg-white shadow-[0_1px_0_rgba(33,29,40,0.04),0_28px_56px_-32px_rgba(33,29,40,0.3)]";
/** Plain white panel (checkout and claim columns). */
export const PANEL = "rounded-[20px] border border-[#E6E1D8] bg-white p-5 sm:p-7";
