import { rosette } from "@/lib/guilloche";
import { seedOf, shortAddr, usd } from "@/lib/format";

export type StampTone = "note" | "ink" | "chain" | "stamp" | "sim";

export interface VoucherProps {
  /** Seeds the guilloche, usually the promo's on-chain address. */
  seed: string;
  shopName: string;
  itemName: string;
  /** Base units of the refund (= price). */
  amount: string;
  /** Clause after "if", e.g. "SOL closes up". */
  condition: string;
  /** Right-hand terms line, e.g. "Sales close 2:55 AM". */
  closesLabel?: string | null;
  /** Serial printed top right: the promo id once it exists. */
  serial?: string | null;
  /** An illustration, not a real promo: printed as "Sample" in the serial slot. */
  sample?: boolean;
  marketId: string;
  stamp?: { text: string; tone: StampTone } | null;
  /** Tilt for the hero presentation. */
  tilt?: boolean;
  /** On phones, keep the short landscape layout (laid out at 125% and scaled to 80%) instead of portrait. */
  compact?: boolean;
  /** Customer view: no serial number and no market-id microprint (the redesign's quieter tag). */
  plain?: boolean;
  /** Replaces the default "Your $5 back if ..." headline. */
  headline?: string;
  /** Replaces the default "Pay $5 for a latte" terms line. */
  terms?: string;
  className?: string;
}

const TONES: Record<StampTone, string> = {
  note: "text-note border-note",
  ink: "text-ink border-ink",
  chain: "text-chain border-chain",
  stamp: "text-stamp border-stamp",
  sim: "text-sim border-sim",
};

// The tag outline, point and punched hole (evenodd), in each layout's own viewBox.
const WIDE = {
  w: 1000,
  h: 500,
  d: "M104 4H974Q996 4 996 26V474Q996 496 974 496H104Q90 496 82 486L10 264Q5 250 10 236L82 14Q90 4 104 4ZM46 250a17 17 0 1 0 34 0a17 17 0 1 0 -34 0Z",
};
const TALL = {
  w: 400,
  h: 540,
  d: "M4 116Q4 102 16 95L186 9Q200 2 214 9L384 95Q396 102 396 116V516Q396 536 376 536H24Q4 536 4 516ZM186 66a14 14 0 1 0 28 0a14 14 0 1 0 -28 0Z",
};

/**
 * The promo as a price tag, the end of the Wincentive ribbon. Scales like an image (all type in
 * container units) and switches to a portrait tag below 420px of its own width.
 */
export function Voucher(props: VoucherProps) {
  const seed = seedOf(props.seed);
  const ros = rosette(seed, 1);
  const dollars = usd(props.amount).replace(/\.00$/, "");
  const id = `tg-${seed.toString(36)}`;
  const micro = Array.from({ length: 8 }, () => props.marketId).join("   ");

  return (
    <figure
      className={`@container ${props.compact ? "w-full max-sm:mb-[-12.5%] max-sm:w-[125%] max-sm:origin-top-left max-sm:scale-[0.8]" : "w-full"} ${props.tilt ? "md:-rotate-[2.5deg]" : ""} ${props.className ?? ""}`}
      aria-label={`Promo tag: your ${dollars} back if ${props.condition}`}
    >
      <div
        className={`relative aspect-[400/540] text-ink drop-shadow-[0_26px_44px_rgba(122,43,255,0.3)] @min-[420px]:aspect-[2/1] ${props.compact ? "max-sm:drop-shadow-none" : ""}`}
      >
        <TagShape id={`${id}-w`} shape={WIDE} className="hidden @min-[420px]:block" />
        <TagShape id={`${id}-t`} shape={TALL} className="@min-[420px]:hidden" />

        <div className="absolute inset-x-[8cqw] top-[27cqw] bottom-[8cqw] grid grid-rows-[auto_1fr] @min-[420px]:inset-y-[5.2cqw] @min-[420px]:right-[5.2cqw] @min-[420px]:left-[11.5cqw] @min-[420px]:grid-cols-[34%_1fr] @min-[420px]:grid-rows-1 @min-[420px]:gap-[3.5cqw]">
          {/* Rosette with the denomination: drawn from the promo id, so every promo's differs */}
          <div className="relative mx-auto aspect-square w-[56%] self-center @min-[420px]:w-full">
            <svg aria-hidden viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full">
              <defs>
                <Ribbon id={`${id}-r`} />
              </defs>
              <g fill="none" stroke={`url(#${id}-r)`} strokeWidth={0.6}>
                {ros.outer.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </g>
              <g fill="none" stroke="var(--color-ink)" strokeWidth={0.4} opacity={0.35}>
                {ros.inner.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </g>
              <circle r={44} fill="var(--color-paper-raised)" />
              <circle r={44} fill="none" stroke={`url(#${id}-r)`} strokeWidth={1.4} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-[12.5cqw] leading-none tracking-[-0.04em] @min-[420px]:text-[6.6cqw]">
                {dollars}
              </span>
              <span className="mt-[0.6cqw] text-[3.1cqw] font-semibold text-note @min-[420px]:text-[1.55cqw]">
                back
              </span>
            </div>
          </div>

          {/* Terms */}
          <div className="flex min-w-0 flex-col justify-between pt-[3cqw] @min-[420px]:pt-[0.4cqw]">
            <div className="flex items-baseline justify-between gap-[2cqw]">
              <span className="font-wide truncate text-[3.9cqw] font-bold text-ink-soft @min-[420px]:text-[2.05cqw]">
                {props.shopName}
              </span>
              {props.plain ? null : (
                <span className="shrink-0 font-mono text-[2.7cqw] text-ink-faint @min-[420px]:text-[1.25cqw]">
                  {props.sample
                    ? "Sample"
                    : props.serial
                      ? `No. ${shortAddr(props.serial, 4)}`
                      : "Draft"}
                </span>
              )}
            </div>
            <p className="font-display my-[2.5cqw] text-[8.4cqw] text-balance @min-[420px]:my-0 @min-[420px]:text-[5cqw]">
              {props.headline ?? `Your ${dollars} back if ${props.condition}.`}
            </p>
            <div className="space-y-[1.2cqw]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-[3cqw] gap-y-[0.5cqw] border-t border-ink/20 pt-[1.6cqw] text-[3.6cqw] @min-[420px]:pt-[1.1cqw] @min-[420px]:text-[1.7cqw]">
                <span>{props.terms ?? `Pay ${dollars} for a ${props.itemName.toLowerCase()}`}</span>
                {props.closesLabel ? (
                  <span className="text-ink-soft">{props.closesLabel}</span>
                ) : null}
              </div>
              {props.plain ? null : (
                <div
                  aria-hidden
                  className="overflow-hidden text-[1.9cqw] leading-none tracking-[0.18em] whitespace-nowrap text-ink-faint/70 @min-[420px]:text-[0.95cqw]"
                >
                  {micro}
                </div>
              )}
            </div>
          </div>
        </div>

        {props.stamp ? <Stamp key={props.stamp.text} {...props.stamp} /> : null}
      </div>
    </figure>
  );
}

/** The logo's ribbon as an SVG gradient (violet, magenta, pink, orange, amber). */
function Ribbon({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor="var(--color-ribbon-violet)" />
      <stop offset="0.4" stopColor="var(--color-ribbon-magenta)" />
      <stop offset="0.65" stopColor="var(--color-ribbon-pink)" />
      <stop offset="0.85" stopColor="var(--color-ribbon-orange)" />
      <stop offset="1" stopColor="var(--color-ribbon-amber)" />
    </linearGradient>
  );
}

function TagShape({
  id,
  shape,
  className,
}: {
  id: string;
  shape: { w: number; h: number; d: string };
  className: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${shape.w} ${shape.h}`}
      className={`absolute inset-0 h-full w-full ${className}`}
    >
      <defs>
        <Ribbon id={`${id}-g`} />
        <pattern id={`${id}-p`} width="36" height="9" patternUnits="userSpaceOnUse">
          <path
            d="M0 4.5 C 9 0.5, 9 0.5, 18 4.5 S 27 8.5, 36 4.5"
            fill="none"
            stroke="var(--color-ribbon-violet)"
            strokeWidth="0.5"
            opacity="0.45"
          />
        </pattern>
      </defs>
      <path d={shape.d} fillRule="evenodd" fill="var(--color-paper-raised)" />
      <path d={shape.d} fillRule="evenodd" fill={`url(#${id}-p)`} />
      <path
        d={shape.d}
        fillRule="evenodd"
        fill="none"
        stroke={`url(#${id}-g)`}
        strokeWidth={shape.w > 500 ? 5 : 4}
      />
    </svg>
  );
}

/** A rubber stamp. Lands with a short press when it first appears (the state just changed). */
export function Stamp({ text, tone }: { text: string; tone: StampTone }) {
  return (
    <div
      role="status"
      className={`animate-stamp pointer-events-none absolute top-[29cqw] right-[3cqw] rounded-[1.4cqw] border-[0.55cqw] bg-paper-raised/80 px-[2.2cqw] py-[1cqw] [--stamp-rot:-9deg] @min-[420px]:top-auto @min-[420px]:right-[5cqw] @min-[420px]:bottom-[13cqw] @min-[420px]:border-[0.32cqw] @min-[420px]:px-[1.6cqw] @min-[420px]:py-[0.6cqw] ${TONES[tone]}`}
      style={{ transform: "rotate(var(--stamp-rot))" }}
    >
      <div className="rounded-[0.8cqw] border-[0.3cqw] border-current px-[2cqw] py-[0.7cqw] @min-[420px]:border-[0.18cqw] @min-[420px]:px-[1.4cqw] @min-[420px]:py-[0.4cqw]">
        <span className="font-display block text-[5.2cqw] leading-none tracking-[0.04em] opacity-90 @min-[420px]:text-[3.2cqw]">
          {text}
        </span>
      </div>
    </div>
  );
}

/** A small rosette seal for lists. */
export function Seal({ seed, size = 44, label }: { seed: string; size?: number; label?: string }) {
  const n = seedOf(seed);
  const ros = rosette(n, 0.45);
  const gid = `sl-${n.toString(36)}`;
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full">
        <defs>
          <Ribbon id={gid} />
        </defs>
        <g fill="none" stroke={`url(#${gid})`} strokeWidth={1.8}>
          {ros.outer.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g fill="none" stroke="var(--color-ink)" strokeWidth={1.2} opacity={0.3}>
          {ros.inner.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <circle r={44} fill="var(--color-paper-raised)" stroke={`url(#${gid})`} strokeWidth={3} />
      </svg>
      {label ? (
        <span
          className="font-display relative leading-none tracking-[-0.03em]"
          style={{ fontSize: Math.round(size * (label.length > 3 ? 0.2 : 0.25)) }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
