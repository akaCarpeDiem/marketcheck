// Checks the bubble packing: no overlaps, nothing outside the box, and the box is well filled
// at every shape. Run: node scripts/test/run.mjs pack
import assert from 'node:assert/strict';
import { GAP, MIN_REL, WALL, coverage, hashUnit, packBubbles } from '../../src/lib/pack.ts';

function shares(n, seed, spread) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = Math.pow(hashUnit(`w${seed}:${i}`, 7), spread) + 0.02;
    out.push(w);
  }
  const max = Math.max(...out);
  return out.map((w) => Math.max(MIN_REL, Math.sqrt(w / max))).sort((a, b) => b - a);
}

/** Radius of the largest empty circle, found on a grid. */
function biggestHole(discs, w, h) {
  let best = 0;
  const step = Math.max(4, Math.min(w, h) / 60);
  for (let x = step / 2; x < w; x += step) {
    for (let y = step / 2; y < h; y += step) {
      let room = Math.min(x, y, w - x, h - y);
      for (const d of discs) {
        room = Math.min(room, Math.hypot(d.x - x, d.y - y) - d.r);
        if (room <= best) break;
      }
      if (room > best) best = room;
    }
  }
  return best;
}

const boxes = [
  [680, 430], [1400, 640], [360, 400], [330, 560], [900, 300], [1200, 673], [500, 500], [1800, 820], [300, 300],
];
const rows = [];
let worstFill = 1;
const started = performance.now();
for (const [w, h] of boxes) {
  for (const n of [50, 30, 12, 60]) {
    for (const seed of [1, 2]) {
      const s = shares(n, seed, seed === 1 ? 1 : 2.4);
      const start = s.map((_, i) => ({ x: WALL + hashUnit(`p${seed}:${i}`, 1) * (w - 2 * WALL), y: WALL + hashUnit(`p${seed}:${i}`, 2) * (h - 2 * WALL) }));
      const t0 = performance.now();
      const out = packBubbles(s, start, w, h, true);
      const ms = performance.now() - t0;
      assert.equal(out.length, n);
      let overlap = 0;
      for (let i = 0; i < n; i++) {
        const a = out[i];
        assert.ok(a.r > 0, 'radius is positive');
        assert.ok(a.x - a.r >= WALL - 0.6 && a.y - a.r >= WALL - 0.6 && a.x + a.r <= w - WALL + 0.6 && a.y + a.r <= h - WALL + 0.6, `inside the box (${w}x${h}, n=${n})`);
        for (let j = i + 1; j < n; j++) overlap = Math.max(overlap, a.r + out[j].r + GAP - Math.hypot(out[j].x - a.x, out[j].y - a.y));
      }
      assert.ok(overlap <= 0.6, `no overlap beyond half a pixel (got ${overlap.toFixed(2)} at ${w}x${h}, n=${n})`);
      const fill = coverage(out, w, h);
      const hole = biggestHole(out, w, h);
      const median = [...out].map((d) => d.r).sort((a, b) => a - b)[Math.floor(n / 2)];
      rows.push({ box: `${w}x${h}`, n, seed, fill: +fill.toFixed(3), hole: +(hole / median).toFixed(2), ms: +ms.toFixed(0) });
      worstFill = Math.min(worstFill, fill);
    }
  }
}
const avg = rows.reduce((s, r) => s + r.fill, 0) / rows.length;
if (process.argv.includes('--table')) console.table(rows);
console.log(`pack: ${rows.length} layouts, average fill ${(avg * 100).toFixed(1)}%, lowest ${(worstFill * 100).toFixed(1)}%, largest hole ${Math.max(...rows.map((r) => r.hole))}× the median bubble, slowest ${Math.max(...rows.map((r) => r.ms))} ms, total ${(performance.now() - started).toFixed(0)} ms`);
assert.ok(worstFill >= 0.6, `every layout covers at least 60% of its box before counting gaps (lowest ${(worstFill * 100).toFixed(1)}%)`);
assert.ok(avg >= 0.67, `layouts cover 67% of their box on average (got ${(avg * 100).toFixed(1)}%)`);
console.log('pack: all checks passed');
