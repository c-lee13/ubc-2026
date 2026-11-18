import { band, rosette } from "@/lib/guilloche";
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
  /** Serial printed top right: the promo PDA once it exists. */
  serial?: string | null;
  marketId: string;
  stamp?: { text: string; tone: StampTone } | null;
  /** Tilt for the hero presentation. */
  tilt?: boolean;
  className?: string;
}

const TONES: Record<StampTone, string> = {
  note: "text-note border-note",
  ink: "text-ink border-ink",
  chain: "text-chain border-chain",
  stamp: "text-stamp border-stamp",
  sim: "text-sim border-sim",
};

/**
 * The promo as a security-printed note. It scales like an image (all type in container units) and
 * switches to a portrait layout below 420px of its own width.
 */
export function Voucher(props: VoucherProps) {
  const seed = seedOf(props.seed);
  const ros = rosette(seed, 1);
  const wide = band(seed, 1000, 500, { inset: 14, width: 24, radius: 22, strands: 4 });
  const tall = band(seed, 400, 500, { inset: 9, width: 16, radius: 16, strands: 4 });
  const dollars = usd(props.amount).replace(/\.00$/, "");
  const pat = `gl-${seed.toString(36)}`;
  const micro = Array.from({ length: 8 }, () => props.marketId).join("   ");

  return (
    <figure
      className={`@container w-full ${props.tilt ? "md:-rotate-[2.5deg]" : ""} ${props.className ?? ""}`}
      aria-label={`Promo voucher: your ${dollars} back if ${props.condition}`}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[18px] bg-paper-raised text-ink shadow-[0_1px_0_rgb(255_255_255/0.9)_inset,0_28px_60px_-28px_rgb(19_35_63/0.55),0_2px_6px_-2px_rgb(19_35_63/0.25)] @min-[420px]:aspect-[2/1]">
        {/* Landscape frame */}
        <svg
          aria-hidden
          viewBox="0 0 1000 500"
          className="absolute inset-0 hidden h-full w-full @min-[420px]:block"
        >
          <Background id={`${pat}-w`} w={1000} h={500} />
          <g fill="none" stroke="var(--color-note)" strokeWidth={1.1} opacity={0.85}>
            {wide.strands.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          <g fill="none" stroke="var(--color-ink)" strokeWidth={1.2} opacity={0.7}>
            {wide.edges.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        </svg>
        {/* Portrait frame */}
        <svg
          aria-hidden
          viewBox="0 0 400 500"
          className="absolute inset-0 h-full w-full @min-[420px]:hidden"
        >
          <Background id={`${pat}-t`} w={400} h={500} />
          <g fill="none" stroke="var(--color-note)" strokeWidth={0.8} opacity={0.85}>
            {tall.strands.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          <g fill="none" stroke="var(--color-ink)" strokeWidth={0.8} opacity={0.7}>
            {tall.edges.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        </svg>

        <div className="absolute inset-[9.5cqw] grid grid-rows-[auto_1fr] @min-[420px]:inset-[5.2cqw] @min-[420px]:grid-cols-[34%_1fr] @min-[420px]:grid-rows-1 @min-[420px]:gap-[3.5cqw]">
          {/* Rosette with the denomination */}
          <div className="relative mx-auto aspect-square w-[62%] self-center @min-[420px]:w-full">
            <svg aria-hidden viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full">
              <g fill="none" stroke="var(--color-note)" strokeWidth={0.55}>
                {ros.outer.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </g>
              <g fill="none" stroke="var(--color-ink)" strokeWidth={0.45} opacity={0.75}>
                {ros.inner.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </g>
              <circle r={44} fill="var(--color-paper-raised)" />
              <circle r={44} fill="none" stroke="var(--color-ink)" strokeWidth={0.9} />
              <circle r={40.5} fill="none" stroke="var(--color-note)" strokeWidth={0.5} />
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
              <span className="shrink-0 font-mono text-[2.7cqw] text-ink-faint @min-[420px]:text-[1.25cqw]">
                {props.serial ? `No. ${shortAddr(props.serial, 4)}` : "Draft"}
              </span>
            </div>
            <p className="font-display my-[2.5cqw] text-[8.4cqw] text-balance @min-[420px]:my-0 @min-[420px]:text-[5cqw]">
              Your {dollars} back if {props.condition}.
            </p>
            <div className="space-y-[1.2cqw]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-[3cqw] gap-y-[0.5cqw] border-t border-ink/25 pt-[1.6cqw] text-[3.6cqw] @min-[420px]:pt-[1.1cqw] @min-[420px]:text-[1.7cqw]">
                <span>
                  Pay {dollars} for a {props.itemName.toLowerCase()}
                </span>
                {props.closesLabel ? (
                  <span className="text-ink-soft">{props.closesLabel}</span>
                ) : null}
              </div>
              <div
                aria-hidden
                className="overflow-hidden text-[1.9cqw] leading-none tracking-[0.18em] whitespace-nowrap text-ink-faint/80 @min-[420px]:text-[0.95cqw]"
              >
                {micro}
              </div>
            </div>
          </div>
        </div>

        {props.stamp ? <Stamp key={props.stamp.text} {...props.stamp} /> : null}
      </div>
    </figure>
  );
}

function Background({ id, w, h }: { id: string; w: number; h: number }) {
  return (
    <>
      <defs>
        <pattern id={id} width="36" height="9" patternUnits="userSpaceOnUse">
          <path
            d="M0 4.5 C 9 0.5, 9 0.5, 18 4.5 S 27 8.5, 36 4.5"
            fill="none"
            stroke="var(--color-note)"
            strokeWidth="0.45"
            opacity="0.32"
          />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${id})`} />
    </>
  );
}

/** A rubber stamp. Lands with a short press when it first appears (the state just changed). */
export function Stamp({ text, tone }: { text: string; tone: StampTone }) {
  return (
    <div
      role="status"
      className={`animate-stamp pointer-events-none absolute top-[44cqw] right-[5cqw] rounded-[1.4cqw] border-[0.55cqw] px-[2.2cqw] py-[1cqw] mix-blend-multiply [--stamp-rot:-9deg] @min-[420px]:top-auto @min-[420px]:right-[5cqw] @min-[420px]:bottom-[13cqw] @min-[420px]:border-[0.32cqw] @min-[420px]:px-[1.6cqw] @min-[420px]:py-[0.6cqw] ${TONES[tone]}`}
      style={{ transform: "rotate(var(--stamp-rot))" }}
    >
      <div className="rounded-[0.8cqw] border-[0.3cqw] border-current px-[2cqw] py-[0.7cqw] @min-[420px]:border-[0.18cqw] @min-[420px]:px-[1.4cqw] @min-[420px]:py-[0.4cqw]">
        <span className="font-display block text-[6.4cqw] leading-none tracking-[0.04em] opacity-90 @min-[420px]:text-[3.2cqw]">
          {text}
        </span>
      </div>
    </div>
  );
}

/** A small rosette seal for lists. */
export function Seal({ seed, size = 44, label }: { seed: string; size?: number; label?: string }) {
  const ros = rosette(seedOf(seed), 0.45);
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full">
        <g fill="none" stroke="var(--color-note)" strokeWidth={1.6}>
          {ros.outer.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g fill="none" stroke="var(--color-ink)" strokeWidth={1.2} opacity={0.7}>
          {ros.inner.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <circle r={44} fill="var(--color-paper-raised)" stroke="var(--color-ink)" strokeWidth={2} />
      </svg>
      {label ? (
        <span className="font-display relative text-[11px] leading-none tracking-[-0.03em]">
          {label}
        </span>
      ) : null}
    </span>
  );
}
