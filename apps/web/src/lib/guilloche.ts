/**
 * Guilloche (the fine woven line-work on banknotes and cheques), generated deterministically from a
 * seed such as the promo's on-chain address, so every promo prints its own note. Pure math, no DOM:
 * output is SVG path data. Coordinates are rounded to 0.1 and use implicit line-to after "M" to
 * keep the markup small.
 */

type Pt = readonly [number, number];

const r1 = (n: number) => (Math.round(n * 10) / 10).toString();

function toPath(pts: Pt[], close = true): string {
  if (pts.length === 0) return "";
  let d = `M${r1(pts[0]![0])} ${r1(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) d += ` ${r1(pts[i]![0])} ${r1(pts[i]![1])}`;
  return close ? `${d}Z` : d;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rosette {
  /** Outer lobed ring curves. */
  outer: string[];
  /** Inner counter-phased ring curves. */
  inner: string[];
}

/**
 * A rosette centred on (0,0), radius ~100 (viewBox -100 -100 200 200). `detail` 1 = full banknote
 * density, 0.5 = for small seals.
 */
export function rosette(seed: number, detail = 1): Rosette {
  const rand = rng(seed);
  const n1 = [16, 18, 20, 22][Math.floor(rand() * 4)]!;
  const n2 = [9, 10, 11, 12][Math.floor(rand() * 4)]!;
  const k1 = Math.max(5, Math.round(12 * detail));
  const k2 = Math.max(4, Math.round(9 * detail));
  const a1 = 7 + rand() * 3;
  const a2 = 8 + rand() * 4;
  const wobble = 1.5 + rand() * 1.5;

  const ring = (
    k: number,
    n: number,
    base: number,
    amp: number,
    dir: 1 | -1,
    harmonic: number,
  ): string[] => {
    const out: string[] = [];
    const steps = Math.round(n * 11 * Math.max(detail, 0.6));
    for (let c = 0; c < k; c++) {
      const phase = (2 * Math.PI * c) / k;
      const pts: Pt[] = [];
      for (let i = 0; i < steps; i++) {
        const t = (2 * Math.PI * i) / steps;
        const r =
          base + amp * Math.sin(n * t + dir * phase) + wobble * Math.sin(harmonic * t + phase);
        pts.push([r * Math.cos(t), r * Math.sin(t)]);
      }
      out.push(toPath(pts));
    }
    return out;
  };

  return {
    outer: ring(k1, n1, 86, a1, 1, 3),
    inner: ring(k2, n2, 60, a2, -1, 2),
  };
}

/** Point and outward normal at arc length `s` along a rounded rectangle (clockwise from top-left). */
function roundedRectAt(
  s: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): { p: Pt; n: Pt } {
  const top = w - 2 * r;
  const side = h - 2 * r;
  const arc = (Math.PI * r) / 2;
  const segs: [number, (u: number) => { p: Pt; n: Pt }][] = [
    [top, (u) => ({ p: [x + r + u, y], n: [0, -1] })],
    [arc, (u) => corner(x + w - r, y + r, -Math.PI / 2 + u / r)],
    [side, (u) => ({ p: [x + w, y + r + u], n: [1, 0] })],
    [arc, (u) => corner(x + w - r, y + h - r, u / r)],
    [top, (u) => ({ p: [x + w - r - u, y + h], n: [0, 1] })],
    [arc, (u) => corner(x + r, y + h - r, Math.PI / 2 + u / r)],
    [side, (u) => ({ p: [x, y + h - r - u], n: [-1, 0] })],
    [arc, (u) => corner(x + r, y + r, Math.PI + u / r)],
  ];
  function corner(cx: number, cy: number, a: number): { p: Pt; n: Pt } {
    return { p: [cx + r * Math.cos(a), cy + r * Math.sin(a)], n: [Math.cos(a), Math.sin(a)] };
  }
  let rest = s;
  for (const [len, at] of segs) {
    if (rest <= len) return at(rest);
    rest -= len;
  }
  return segs[0]![1](0);
}

export interface Band {
  strands: string[];
  edges: string[];
}

/**
 * A woven border band inside a w×h note: `strands` sinusoids braided around a rounded-rect centre
 * line, plus the two edge rules. The wave count is an integer so every strand closes cleanly.
 */
export function band(
  seed: number,
  w: number,
  h: number,
  opts: { inset?: number; width?: number; radius?: number; strands?: number } = {},
): Band {
  const rand = rng(seed ^ 0x9e3779b9);
  const inset = opts.inset ?? 12;
  const bw = opts.width ?? 22;
  const radius = opts.radius ?? 18;
  const k = opts.strands ?? 4;
  const cx = inset + bw / 2;
  const cw = w - 2 * cx;
  const ch = h - 2 * cx;
  const amp = (bw / 2) * 0.9;
  // Keep the centre-line corner radius above the wave amplitude, or strands loop at the corners.
  const cr = Math.max(amp + 6, radius - bw / 2);
  const perimeter = 2 * (cw - 2 * cr) + 2 * (ch - 2 * cr) + 2 * Math.PI * cr;
  const wavelength = 26 + rand() * 10;
  const waves = Math.max(8, Math.round(perimeter / wavelength));
  const step = 4;
  const count = Math.ceil(perimeter / step);

  const strands: string[] = [];
  for (let c = 0; c < k; c++) {
    const phase = (Math.PI * c) / (k / 2);
    const pts: Pt[] = [];
    for (let i = 0; i < count; i++) {
      const s = (perimeter * i) / count;
      const { p, n } = roundedRectAt(s, cx, cx, cw, ch, cr);
      const off = amp * Math.sin((2 * Math.PI * waves * s) / perimeter + phase);
      pts.push([p[0] + n[0] * off, p[1] + n[1] * off]);
    }
    strands.push(toPath(pts));
  }
  const edge = (off: number) => {
    const x = cx - off;
    const ww = cw + 2 * off;
    const hh = ch + 2 * off;
    const rr = Math.max(2, cr + off);
    return `M${r1(x + rr)} ${r1(x)}H${r1(x + ww - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x + ww)} ${r1(x + rr)}V${r1(x + hh - rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x + ww - rr)} ${r1(x + hh)}H${r1(x + rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x)} ${r1(x + hh - rr)}V${r1(x + rr)}A${r1(rr)} ${r1(rr)} 0 0 1 ${r1(x + rr)} ${r1(x)}Z`;
  };
  return { strands, edges: [edge(bw / 2 + 1.5), edge(-bw / 2 - 1.5)] };
}
