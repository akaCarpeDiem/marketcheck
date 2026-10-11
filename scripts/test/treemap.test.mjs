// Checks the treemap layout: tiles stay inside the box, do not overlap, and areas match weights.
import assert from 'node:assert/strict';
import { groupedTreemap, squarify } from '../../src/lib/treemap.ts';

const box = { x: 0, y: 0, w: 900, h: 500 };
const weights = [500, 300, 200, 120, 80, 60, 40, 25, 10, 5, 0];
const rects = squarify(weights, box);
const total = weights.reduce((s, v) => s + v, 0);
let area = 0;
rects.forEach((r, i) => {
  assert.ok(r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= box.w + 0.01 && r.y + r.h <= box.h + 0.01, 'tile inside the box');
  const want = (weights[i] / total) * box.w * box.h;
  assert.ok(Math.abs(r.w * r.h - want) < 0.5, `area matches weight for tile ${i}`);
  area += r.w * r.h;
  for (let j = 0; j < i; j++) {
    const o = rects[j];
    const overlapW = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
    const overlapH = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
    assert.ok(overlapW <= 0.01 || overlapH <= 0.01, `tiles ${i} and ${j} do not overlap`);
  }
});
assert.ok(Math.abs(area - box.w * box.h) < 1, 'tiles cover the whole box');
// The largest tiles should be reasonably square.
const ratio = (r) => Math.max(r.w / r.h, r.h / r.w);
assert.ok(ratio(rects[0]) < 2.2 && ratio(rects[1]) < 2.2, 'big tiles are not slivers');

const g = groupedTreemap(
  [
    { name: 'A', items: [{ item: 'a1', weight: 50 }, { item: 'a2', weight: 30 }] },
    { name: 'B', items: [{ item: 'b1', weight: 20 }, { item: 'b2', weight: 0 }] },
    { name: 'Empty', items: [] },
  ],
  box,
  { header: 18, gap: 2 },
);
assert.equal(g.groups.length, 2);
assert.equal(g.tiles.length, 3);
for (const t of g.tiles) assert.ok(t.rect.w > 0 && t.rect.h > 0);
console.log('treemap: all checks passed');
