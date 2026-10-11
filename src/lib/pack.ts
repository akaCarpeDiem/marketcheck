/**
 * Circle packing for the bubble map. Pure maths, no DOM, so it can be tested
 * on its own (scripts/test/pack.test.mjs).
 *
 * The bubbles have fixed relative sizes; the job is to find the largest scale
 * at which they all fit in a w × h box without overlapping, and where to put
 * them. It works the way a crowd fills a room:
 *   1. Start small and spread out.
 *   2. Push apart any two that overlap, and push anything outside back in,
 *      until nothing overlaps.
 *   3. Grow everyone a little and repeat. When they can no longer be untangled,
 *      go back to the last size that worked.
 *   4. Let individual bubbles swell slightly into any gap left beside them.
 * The walls are the box itself, so the result fills a wide strip, a tall
 * column or a square equally well.
 */

type Disc = { x: number; y: number; r: number; s: number };

/** Space kept between bubbles and at the edge of the box, in pixels. */
export const GAP = 3;
export const WALL = 4;
/** The smallest bubble is never less than this share of the largest one's radius. */
export const MIN_REL = 0.34;
/** How far a single bubble may swell beyond its true size to close a gap. */
const MAX_SWELL = 1.16;
/** Overlap (pixels, inside the gap) accepted while searching, and relaxation passes per try. */
const TOLERANCE = 0.45;
const PASSES = 170;
/** Time allowed for extra starting scatters on a first layout, in milliseconds. */
const FRESH_BUDGET_MS = 70;

/** A repeatable number in [0, 1) from a string. */
export function hashUnit(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** One pass of pushing overlapping discs apart and back inside the walls. Returns the worst overlap seen. */
function relax(discs: Disc[], w: number, h: number): number {
  let worst = 0;
  const n = discs.length;
  for (let i = 0; i < n; i++) {
    const a = discs[i]!;
    for (let j = i + 1; j < n; j++) {
      const b = discs[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const min = a.r + b.r + GAP;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      let d = Math.sqrt(d2);
      if (d < 0.001) {
        // Exactly on top of each other: pick a repeatable direction.
        const ang = ((i * 37 + j * 91) % 360) * (Math.PI / 180);
        dx = Math.cos(ang);
        dy = Math.sin(ang);
        d = 1;
      }
      const overlap = min - d;
      if (overlap > worst) worst = overlap;
      // The smaller disc gives way more.
      const ma = a.r * a.r;
      const mb = b.r * b.r;
      const ta = mb / (ma + mb);
      const ux = dx / d;
      const uy = dy / d;
      a.x -= ux * overlap * ta;
      a.y -= uy * overlap * ta;
      b.x += ux * overlap * (1 - ta);
      b.y += uy * overlap * (1 - ta);
    }
  }
  for (const c of discs) {
    const lo = c.r + WALL;
    if (c.x < lo) c.x = lo;
    else if (c.x > w - lo) c.x = Math.max(lo, w - lo);
    if (c.y < lo) c.y = lo;
    else if (c.y > h - lo) c.y = Math.max(lo, h - lo);
  }
  return worst;
}

/** Relax until nothing overlaps by more than `tolerance`, or `passes` run out. Returns the last worst overlap. */
function settle(discs: Disc[], w: number, h: number, passes: number, tolerance: number): number {
  let worst = Infinity;
  for (let i = 0; i < passes; i++) {
    worst = relax(discs, w, h);
    if (worst <= tolerance) break;
  }
  return worst;
}

/** The largest overlap between any two discs or a disc and a wall, after the fact. */
function worstOverlap(discs: { x: number; y: number; r: number }[], w: number, h: number): number {
  let worst = 0;
  for (let i = 0; i < discs.length; i++) {
    const a = discs[i]!;
    worst = Math.max(worst, a.r + WALL - a.x, a.r + WALL - a.y, a.x + a.r + WALL - w, a.y + a.r + WALL - h);
    for (let j = i + 1; j < discs.length; j++) {
      const b = discs[j]!;
      worst = Math.max(worst, a.r + b.r + GAP - Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  return worst;
}

/** Small repeatable random generator, so the same input always packs the same way. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Placed = { x: number; y: number; r: number };

/**
 * Grow the discs from `start` until they jam. Returns the last layout that
 * fitted and its scale (pixels per unit of share).
 */
function grow(
  shares: number[],
  start: { x: number; y: number }[],
  w: number,
  h: number,
  random: () => number,
): { layout: Placed[]; k: number } {
  const sumSq = shares.reduce((s, v) => s + v * v, 0);
  const scaleFor = (fill: number) => Math.sqrt((fill * w * h) / (Math.PI * sumSq));
  // No bubble may be wider than the box.
  const cap = (Math.min(w, h) - 2 * WALL) / 2 / Math.max(...shares);

  let k = Math.min(scaleFor(0.4), cap);
  const discs: Disc[] = shares.map((s, i) => ({ x: start[i]!.x, y: start[i]!.y, r: s * k, s }));
  settle(discs, w, h, 800, 0.05);
  const snapshot = (): Placed[] => discs.map((d) => ({ x: d.x, y: d.y, r: d.r }));
  let best = snapshot();
  let bestK = k;

  /** Try to fit at scale `next`; on a tangle, shake the discs a little and try again. */
  const fits = (next: number): boolean => {
    for (const d of discs) d.r = d.s * next;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (settle(discs, w, h, PASSES, TOLERANCE) <= TOLERANCE) return true;
      const amount = 0.12 / (attempt + 1);
      for (const d of discs) {
        d.x += (random() - 0.5) * d.r * amount;
        d.y += (random() - 0.5) * d.r * amount;
      }
    }
    return settle(discs, w, h, PASSES, TOLERANCE) <= TOLERANCE;
  };

  // Coarse steps first, then finer ones from the last layout that fitted.
  for (const step of [0.035, 0.012, 0.004]) {
    discs.forEach((d, i) => {
      d.x = best[i]!.x;
      d.y = best[i]!.y;
    });
    let f = (Math.PI * sumSq * bestK * bestK) / (w * h);
    while (f < 0.9 && bestK < cap) {
      f += step;
      k = Math.min(scaleFor(f), cap);
      if (!fits(k)) break;
      best = snapshot();
      bestK = k;
    }
  }
  return { layout: best, k: bestK };
}

/**
 * Pack discs into a w × h box. `shares` are relative radii (0..1). `start`
 * gives starting positions (where the bubbles were before, if they were on
 * screen); `fresh` asks for a few extra random starts so a first layout does
 * not depend on one unlucky scatter. Returns positions and radii in pixels,
 * in the same order as `shares`.
 */
export function packBubbles(
  shares: number[],
  start: { x: number; y: number }[],
  w: number,
  h: number,
  fresh = false,
): Placed[] {
  const n = shares.length;
  if (!n || w < 20 || h < 20) return [];
  const random = rng(n * 7919 + Math.round(w) * 31 + Math.round(h));

  const began = typeof performance !== 'undefined' ? performance.now() : 0;
  const elapsed = () => (typeof performance !== 'undefined' ? performance.now() - began : 0);
  let { layout: best, k: bestK } = grow(shares, start, w, h, random);
  if (fresh) {
    for (let attempt = 0; attempt < 4 && elapsed() < FRESH_BUDGET_MS; attempt++) {
      const scatter = shares.map(() => ({ x: WALL + random() * (w - 2 * WALL), y: WALL + random() * (h - 2 * WALL) }));
      const next = grow(shares, scatter, w, h, random);
      if (next.k > bestK * 1.004) {
        best = next.layout;
        bestK = next.k;
      }
    }
  }

  // Let each bubble swell a little into free space beside it.
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < n; i++) {
      const a = best[i]!;
      let room = Math.min(a.x - WALL, a.y - WALL, w - WALL - a.x, h - WALL - a.y);
      for (let j = 0; j < n && room > a.r; j++) {
        if (j === i) continue;
        const b = best[j]!;
        room = Math.min(room, Math.hypot(b.x - a.x, b.y - a.y) - b.r - GAP);
      }
      const limit = shares[i]! * bestK * MAX_SWELL;
      if (room > a.r) a.r = Math.min(room, limit);
    }
  }

  // A layout that still overlaps (it should not) is shrunk until it does not.
  let over = worstOverlap(best, w, h);
  for (let guard = 0; over > 0.5 && guard < 40; guard++) {
    for (const d of best) d.r *= 0.985;
    over = worstOverlap(best, w, h);
  }
  return best;
}

/** Share of the box covered by the discs, 0..1. */
export function coverage(discs: { r: number }[], w: number, h: number): number {
  return discs.reduce((s, d) => s + Math.PI * d.r * d.r, 0) / (w * h);
}
