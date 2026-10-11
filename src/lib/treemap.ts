/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk): fills a rectangle
 * with one tile per item, each tile's area proportional to its weight, keeping
 * tiles as close to square as it can. Pure maths, no DOM.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/** Lay out `weights` (any positive numbers, largest first works best) inside `box`. */
export function squarify(weights: number[], box: Rect): Rect[] {
  const total = weights.reduce((s, v) => s + Math.max(0, v), 0);
  const out: Rect[] = new Array(weights.length);
  if (!(total > 0) || box.w <= 0 || box.h <= 0) {
    for (let i = 0; i < weights.length; i++) out[i] = { x: box.x, y: box.y, w: 0, h: 0 };
    return out;
  }
  // Work in area units so a weight is directly an area.
  const scale = (box.w * box.h) / total;
  const areas = weights.map((v) => Math.max(0, v) * scale);
  let { x, y, w, h } = box;
  let i = 0;

  /** Worst aspect ratio of a row of areas laid along a side of length `side`. */
  const worst = (sum: number, min: number, max: number, side: number): number => {
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  };

  while (i < areas.length) {
    const side = Math.min(w, h);
    let sum = 0;
    let min = Infinity;
    let max = 0;
    let j = i;
    // Add tiles to the row while that keeps them squarer.
    while (j < areas.length) {
      const a = areas[j]!;
      if (a <= 0) {
        j++;
        continue;
      }
      const nSum = sum + a;
      const nMin = Math.min(min, a);
      const nMax = Math.max(max, a);
      if (sum > 0 && worst(nSum, nMin, nMax, side) > worst(sum, min, max, side)) break;
      sum = nSum;
      min = nMin;
      max = nMax;
      j++;
    }
    if (sum <= 0) {
      for (; i < j; i++) out[i] = { x, y, w: 0, h: 0 };
      continue;
    }
    const thick = sum / side;
    let offset = 0;
    for (let k = i; k < j; k++) {
      const a = areas[k]!;
      const len = a > 0 ? a / thick : 0;
      out[k] = w >= h ? { x, y: y + offset, w: thick, h: len } : { x: x + offset, y, w: len, h: thick };
      offset += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}

export type TreeGroup<T> = { name: string; items: { item: T; weight: number }[] };
export type PlacedTile<T> = { item: T; rect: Rect; group: string };
export type PlacedGroup = { name: string; rect: Rect; header: number };

/**
 * Two-level treemap: groups fill the box, then each group's items fill the
 * group (below a header strip when the group is tall enough for one).
 */
export function groupedTreemap<T>(
  groups: TreeGroup<T>[],
  box: Rect,
  opts: { header?: number; gap?: number } = {},
): { tiles: PlacedTile<T>[]; groups: PlacedGroup[] } {
  const gap = opts.gap ?? 2;
  const sized = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.weight > 0).sort((a, b) => b.weight - a.weight), total: 0 }))
    .map((g) => ({ ...g, total: g.items.reduce((s, i) => s + i.weight, 0) }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
  const rects = squarify(sized.map((g) => g.total), box);
  const tiles: PlacedTile<T>[] = [];
  const placed: PlacedGroup[] = [];
  sized.forEach((g, gi) => {
    const r = rects[gi]!;
    const single = sized.length === 1;
    const header = !single && opts.header && r.h > opts.header * 2.4 && r.w > 60 ? opts.header : 0;
    const inner: Rect = single
      ? r
      : { x: r.x + gap, y: r.y + gap + header, w: Math.max(0, r.w - 2 * gap), h: Math.max(0, r.h - 2 * gap - header) };
    placed.push({ name: g.name, rect: r, header });
    const itemRects = squarify(g.items.map((i) => i.weight), inner);
    g.items.forEach((it, ii) => tiles.push({ item: it.item, rect: itemRects[ii]!, group: g.name }));
  });
  return { tiles, groups: placed };
}
