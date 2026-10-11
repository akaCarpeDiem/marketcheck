import { hierarchy, pack } from 'd3-hierarchy';
import type { BubbleItem } from '../types';
import { chartUrlFor, describeAsset, describeAssetHtml } from '../descriptions';
import { formatMktCap, formatMoney, formatPct } from '../format';

export type BubbleLayout = {
  item: BubbleItem;
  x: number;
  y: number;
  r: number;
};

type PackLeaf = {
  item: BubbleItem;
  /** Area weight for d3.pack (∝ sizeScore² so r ∝ sizeScore). */
  value: number;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Uniform gutter between disk *fill* edges.
 * Stroke ~3.25px is centered on the edge; glow sits outside — keep PAD large
 * enough that stroked disks never visually touch (Birdeye-like air gap).
 */
const PAD = 9;
const MARGIN = 7;

/** Soft initial area target; final size comes from inflate-to-walls. */
const TARGET_AREA_FRAC = 0.74;

function clampNode(n: BubbleLayout, width: number, height: number): void {
  n.x = Math.min(width - n.r - MARGIN, Math.max(n.r + MARGIN, n.x));
  n.y = Math.min(height - n.r - MARGIN, Math.max(n.r + MARGIN, n.y));
}

function resolveCollisions(
  nodes: BubbleLayout[],
  width: number,
  height: number,
  strength = 0.55,
  padScale = 1,
): boolean {
  let moved = false;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const minDist = a.r + b.r + PAD * padScale;
      if (dist < minDist) {
        if (dist < 1e-6) {
          const ang = ((i * 17 + j * 31) % 360) * (Math.PI / 180);
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          dist = 1;
        }
        const push = ((minDist - dist) / dist) * strength;
        dx *= push;
        dy *= push;
        a.x -= dx;
        a.y -= dy;
        b.x += dx;
        b.y += dy;
        moved = true;
      }
    }
  }
  for (const n of nodes) clampNode(n, width, height);
  return moved;
}

/** Soft springs: pull/push neighbors toward ideal gutter so gaps equalize. */
function equalizeGaps(
  nodes: BubbleLayout[],
  width: number,
  height: number,
  strength = 0.08,
  rangeScale = 2.4,
): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      const ideal = a.r + b.r + PAD;
      const maxRange = ideal * rangeScale;
      if (dist < 1e-6 || dist > maxRange) continue;
      const delta = (ideal - dist) / dist;
      const k = delta > 0 ? strength : strength * 0.35;
      const fx = dx * delta * k;
      const fy = dy * delta * k;
      a.x -= fx;
      a.y -= fy;
      b.x += fx;
      b.y += fy;
    }
  }
  for (const n of nodes) clampNode(n, width, height);
}




function diskBBox(nodes: BubbleLayout[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  bw: number;
  bh: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    minY = Math.min(minY, n.y - n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    bw: Math.max(1, maxX - minX),
    bh: Math.max(1, maxY - minY),
  };
}

/** Count pairs with distance < r_a + r_b + PAD (hard overlap / under-gutter). */
export function countHardOverlaps(nodes: BubbleLayout[]): number {
  let n = 0;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) + 1e-6 < a.r + b.r + PAD) n++;
    }
  }
  return n;
}

/** Minimum pairwise edge gap (dist − ra − rb). Negative ⇒ overlap. */
export function minPairwiseGap(nodes: BubbleLayout[]): number {
  let min = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
    }
  }
  return Number.isFinite(min) ? min : 0;
}

function hasHardOverlapOrOob(
  nodes: BubbleLayout[],
  width: number,
  height: number,
  factor = 1,
): boolean {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const ra = a.r * factor;
    if (
      a.x - ra < MARGIN - 1e-6 ||
      a.x + ra > width - MARGIN + 1e-6 ||
      a.y - ra < MARGIN - 1e-6 ||
      a.y + ra > height - MARGIN + 1e-6
    ) {
      return true;
    }
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      const rb = b.r * factor;
      if (Math.hypot(a.x - b.x, a.y - b.y) + 1e-6 < ra + rb + PAD) return true;
    }
  }
  return false;
}

function snapshot(nodes: BubbleLayout[]): Array<{ x: number; y: number; r: number }> {
  return nodes.map((n) => ({ x: n.x, y: n.y, r: n.r }));
}

function restore(nodes: BubbleLayout[], snap: Array<{ x: number; y: number; r: number }>): void {
  for (let i = 0; i < nodes.length; i++) {
    const s = snap[i]!;
    const n = nodes[i]!;
    n.x = s.x;
    n.y = s.y;
    n.r = s.r;
  }
}

/** Dollar volume for sizing. Binance quoteVolume is already USD — never × price. */
function dollarVolume(item: BubbleItem): number {
  const v = Math.max(0, item.volume ?? 0);
  if (v <= 0) return 0;
  if (item.volumeIsUsd || item.id.startsWith('binance:')) return v;
  if (item.price != null && Number.isFinite(item.price) && Math.abs(item.price) > 0) {
    return Math.abs(item.price) * v;
  }
  return v;
}

/**
 * Size STRICTLY from dollar volume (Birdeye-style). No |%| blend.
 * Radius weight uses sqrt so area ∝ volume; mild power keeps mid-tier spread.
 */
function sizeScores(items: BubbleItem[]): number[] {
  const vols = items.map(dollarVolume);
  const volMax = Math.max(...vols, 1);
  const hasVol = vols.some((v) => v > 0);
  if (!hasVol) {
    // Fallback only when volume missing entirely: equal-ish mid sizes
    return items.map(() => 0.45);
  }
  return vols.map((vm) => {
    if (vm <= 0) return 0.18;
    const t = vm / volMax;
    // sqrt → natural bubble area; 0.85 keeps highs distinct without crushing mids
    return Math.max(0.18, Math.pow(Math.sqrt(t), 0.85));
  });
}

/**
 * Scale pack radii toward a soft area target (starting point for inflate).
 * Relative ratios from d3.pack are preserved.
 */
function scaleRadiiToPanel(
  nodes: BubbleLayout[],
  width: number,
  height: number,
): void {
  if (!nodes.length) return;
  const panel = Math.max(1, width * height);
  const sumSq = nodes.reduce((s, n) => s + n.r * n.r, 0);
  let s = Math.sqrt((TARGET_AREA_FRAC * panel) / (Math.PI * Math.max(sumSq, 1e-6)));

  const minDim = Math.min(width, height);
  const n = nodes.length;
  // Cap giants so mid/small bubbles can still fill the rectangle
  const maxRCap = Math.min(110, Math.max(42, minDim / (2.3 + Math.sqrt(n) * 0.42)));
  const maxR = Math.max(...nodes.map((node) => node.r)) * s;
  if (maxR > maxRCap) s *= maxRCap / maxR;

  // Readable floor — no micro-dots
  const minRFloor = Math.max(20, Math.min(30, Math.round(minDim / (15 + n * 0.22))));
  for (const node of nodes) {
    node.r = Math.max(minRFloor, node.r * s);
  }

  // Moderate size spread (volume still drives size; extremes hurt packing)
  const rs = nodes.map((node) => node.r);
  const rMin = Math.min(...rs);
  const rMax = Math.max(...rs);
  const maxRatio = 5.2;
  if (rMax > rMin * maxRatio) {
    const loft = rMin * maxRatio;
    for (const node of nodes) {
      if (node.r > loft) node.r = loft;
    }
  }
}

/**
 * Center the pack in the panel (translate only — no anisotropic stretch).
 */
function centerPack(nodes: BubbleLayout[], width: number, height: number): void {
  if (!nodes.length) return;
  const box = diskBBox(nodes);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const dx = width / 2 - cx;
  const dy = height / 2 - cy;
  for (const n of nodes) {
    n.x += dx;
    n.y += dy;
  }
  for (const n of nodes) clampNode(n, width, height);
}

/**
 * Try applying a uniform radius scale from `baseR`, settling with collide+bounds.
 * Returns true if the result is overlap-free and in-bounds.
 */
function tryRadiusScale(
  nodes: BubbleLayout[],
  baseR: number[],
  pos0: Array<{ x: number; y: number; r: number }>,
  factor: number,
  width: number,
  height: number,
  settleTicks = 90,
): boolean {
  restore(nodes, pos0);
  for (let i = 0; i < nodes.length; i++) {
    nodes[i]!.r = baseR[i]! * factor;
  }
  for (let t = 0; t < settleTicks; t++) {
    resolveCollisions(nodes, width, height, 0.88, 1);
    if (t % 3 === 0) equalizeGaps(nodes, width, height, 0.03, 1.3);
  }
  for (let pass = 0; pass < 60; pass++) {
    if (!resolveCollisions(nodes, width, height, 0.92, 1)) break;
  }
  return countHardOverlaps(nodes) === 0 && !hasHardOverlapOrOob(nodes, width, height, 1);
}

/**
 * Collide-first settle. Short-range gap tidy only — no long-range attract
 * (long-range attract collapses rectangular fill back into a circular island).
 */
function settleRect(
  nodes: BubbleLayout[],
  width: number,
  height: number,
  ticks: number,
  collideStrength = 0.88,
): void {
  for (let t = 0; t < ticks; t++) {
    resolveCollisions(nodes, width, height, collideStrength, 1);
    if (t % 2 === 0) equalizeGaps(nodes, width, height, 0.045, 1.35);
  }
  for (let pass = 0; pass < 100; pass++) {
    if (!resolveCollisions(nodes, width, height, 0.98, 1)) break;
  }
}

/**
 * Progressive uniform radius inflation + collide/bounds.
 * Growing disks push centers apart; once the short axis hits walls, further
 * growth drives expansion along the long axis — filling the rectangle as
 * ONE contiguous field. No anisotropic stretch, no corner pins.
 */
function densifyPack(
  nodes: BubbleLayout[],
  width: number,
  height: number,
): void {
  if (!nodes.length) return;

  centerPack(nodes, width, height);

  // Start clearly under-sized so collide can spread into corners before inflate.
  for (const n of nodes) n.r *= 0.55;
  settleRect(nodes, width, height, 80, 0.9);

  // Progressive inflate: small steps, settle after each.
  for (let step = 0; step < 55; step++) {
    const before = snapshot(nodes);
    for (const n of nodes) n.r *= 1.035;
    settleRect(nodes, width, height, 28, 0.9);
    if (countHardOverlaps(nodes) > 0 || hasHardOverlapOrOob(nodes, width, height, 1)) {
      restore(nodes, before);
      settleRect(nodes, width, height, 40, 0.92);
      break;
    }
  }

  // Binary-search a final bump from the settled state.
  {
    const posSeed = snapshot(nodes);
    const baseR = nodes.map((n) => n.r);
    let lo = 1;
    let hi = 1.25;
    if (!tryRadiusScale(nodes, baseR, posSeed, 1, width, height, 50)) {
      lo = 0.7;
      hi = 1;
    } else {
      let probe = 1.04;
      while (probe < hi && tryRadiusScale(nodes, baseR, posSeed, probe, width, height, 45)) {
        lo = probe;
        probe *= 1.05;
      }
      hi = Math.min(hi, probe);
    }
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (tryRadiusScale(nodes, baseR, posSeed, mid, width, height, 50)) lo = mid;
      else hi = mid;
    }
    restore(nodes, posSeed);
    for (let i = 0; i < nodes.length; i++) nodes[i]!.r = baseR[i]! * lo;
    settleRect(nodes, width, height, 80, 0.92);
  }

  // If an axis is still short: shrink slightly → expand that axis → re-inflate.
  // Shrink-first keeps contiguity (no void ring); inflate recovers density.
  {
    const availW = width - MARGIN * 2;
    const availH = height - MARGIN * 2;
    for (let round = 0; round < 10; round++) {
      const box = diskBBox(nodes);
      const fillX = box.bw / availW;
      const fillY = box.bh / availH;
      if (fillX >= 0.985 && fillY >= 0.985) break;

      // Make room so the axis expand does not immediately collide-collapse.
      for (const n of nodes) n.r *= 0.9;
      settleRect(nodes, width, height, 30, 0.9);

      const box2 = diskBBox(nodes);
      const cx = (box2.minX + box2.maxX) / 2;
      const cy = (box2.minY + box2.maxY) / 2;
      const tcx = width / 2;
      const tcy = height / 2;
      const sx = fillX < 0.98 ? Math.min(availW / box2.bw, 1.22) : 1;
      const sy = fillY < 0.98 ? Math.min(availH / box2.bh, 1.22) : 1;
      for (const n of nodes) {
        n.x = tcx + (n.x - cx) * sx;
        n.y = tcy + (n.y - cy) * sy;
      }
      for (const n of nodes) clampNode(n, width, height);
      settleRect(nodes, width, height, 45, 0.92);

      // Re-inflate.
      const pos2 = snapshot(nodes);
      const base2 = nodes.map((n) => n.r);
      let lo2 = 1;
      let hi2 = 1.45;
      if (!tryRadiusScale(nodes, base2, pos2, 1, width, height, 45)) {
        lo2 = 0.8;
        hi2 = 1;
      } else {
        let probe = 1.06;
        while (probe < hi2 && tryRadiusScale(nodes, base2, pos2, probe, width, height, 40)) {
          lo2 = probe;
          probe *= 1.06;
        }
        hi2 = Math.min(hi2, probe);
      }
      for (let i = 0; i < 12; i++) {
        const mid = (lo2 + hi2) / 2;
        if (tryRadiusScale(nodes, base2, pos2, mid, width, height, 45)) lo2 = mid;
        else hi2 = mid;
      }
      restore(nodes, pos2);
      for (let i = 0; i < nodes.length; i++) nodes[i]!.r = base2[i]! * lo2;
      settleRect(nodes, width, height, 70, 0.92);
    }
  }

  for (let pass = 0; pass < 120; pass++) {
    if (!resolveCollisions(nodes, width, height, 0.98, 1)) break;
  }

  // Hard rule: shrink uniformly until every pair keeps ≥ PAD edge gap
  enforceMinGap(nodes, width, height);
}

/** Uniformly shrink radii until min pairwise edge gap ≥ PAD (never touch). */
function enforceMinGap(
  nodes: BubbleLayout[],
  width: number,
  height: number,
): void {
  if (nodes.length < 2) return;
  for (let iter = 0; iter < 24; iter++) {
    const gap = minPairwiseGap(nodes);
    if (gap + 1e-6 >= PAD && !hasHardOverlapOrOob(nodes, width, height, 1)) {
      // One more collide settle at current radii
      for (let pass = 0; pass < 40; pass++) {
        if (!resolveCollisions(nodes, width, height, 0.98, 1)) break;
      }
      if (minPairwiseGap(nodes) + 1e-6 >= PAD) return;
    }
    for (const n of nodes) n.r *= 0.97;
    for (let pass = 0; pass < 50; pass++) {
      if (!resolveCollisions(nodes, width, height, 0.98, 1)) break;
    }
  }
}

/**
 * Birdeye-style full-bleed bubble layout.
 * Relative sizes STRICTLY from dollar volume → d3-hierarchy pack() for initial
 * topology; densifyPack inflates uniformly + collide/bounds to fill the
 * rectangle as one contiguous field (no corner pins, no empty moat).
 */
export function layoutBubbles(
  items: BubbleItem[],
  width: number,
  height: number,
): BubbleLayout[] {
  if (!items.length) return [];

  const scores = sizeScores(items);
  const leaves: PackLeaf[] = items.map((item, i) => {
    const sizeScore = Math.max(0.16, scores[i]!);
    return { item, value: sizeScore * sizeScore };
  });

  const availW = Math.max(1, width - MARGIN * 2);
  const availH = Math.max(1, height - MARGIN * 2);

  type PackDatum = PackLeaf & { children?: PackLeaf[] };
  const root = hierarchy<PackDatum>({ children: leaves } as PackDatum)
    .sum((d) => (d.children ? 0 : d.value))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const packed = pack<PackDatum>()
    .size([availW, availH])
    .padding(PAD)(root);

  const nodes: BubbleLayout[] = packed.leaves().map((leaf) => ({
    item: leaf.data.item,
    x: leaf.x + MARGIN,
    y: leaf.y + MARGIN,
    r: leaf.r,
  }));

  scaleRadiiToPanel(nodes, width, height);
  densifyPack(nodes, width, height);

  // Final safety shrink if anything still overlaps (numerical).
  if (hasHardOverlapOrOob(nodes, width, height, 1) || countHardOverlaps(nodes) > 0) {
    const pos = snapshot(nodes);
    const baseR = nodes.map((n) => n.r);
    let dLo = 0.4;
    let dHi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (dLo + dHi) / 2;
      if (tryRadiusScale(nodes, baseR, pos, mid, width, height, 60)) dLo = mid;
      else dHi = mid;
    }
    tryRadiusScale(nodes, baseR, pos, dLo, width, height, 80);
  }

  return nodes;
}

/** Fill ratios of disk bbox vs available panel (after MARGIN). */
export function measureFill(
  nodes: BubbleLayout[],
  width: number,
  height: number,
): { fillX: number; fillY: number; overlaps: number } {
  if (!nodes.length) return { fillX: 0, fillY: 0, overlaps: 0 };
  const availW = width - MARGIN * 2;
  const availH = height - MARGIN * 2;
  const box = diskBBox(nodes);
  return {
    fillX: box.bw / availW,
    fillY: box.bh / availH,
    overlaps: countHardOverlaps(nodes),
  };
}

export function bubbleTipText(
  item: BubbleItem,
  tfLabel: string,
  kind: 'crypto' | 'stock' | 'etf' = 'crypto',
): string {
  const blurb = describeAsset(item.id, {
    kind: kind === 'etf' ? 'stock' : kind,
    name: item.name,
    symbol: item.symbol,
  });
  const parts = [
    blurb,
    `${formatPct(item.changePercent)} (${tfLabel})`,
  ];
  if (item.price != null) parts.push(`Price ${formatMoney(item.price)}`);
  if (item.volume != null) {
    const dv =
      item.volumeIsUsd || item.id.startsWith('binance:')
        ? item.volume
        : item.price != null && Number.isFinite(item.price)
          ? Math.abs(item.price) * item.volume
          : item.volume;
    parts.push(`Vol ${formatMktCap(dv)}`);
  }
  if (item.marketCap != null) parts.push(`Mkt ${formatMktCap(item.marketCap)}`);
  return parts.join('\n');
}

function compactPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  const abs = Math.abs(n);
  if (abs >= 100) return `${sign}${n.toFixed(0)}%`;
  if (abs >= 10) return `${sign}${n.toFixed(1)}%`;
  return `${sign}${n.toFixed(2)}%`;
}

function letterAvatar(symbol: string, x: number, y: number, size: number, up: boolean): string {
  const letter = escapeHtml((symbol || '?').charAt(0).toUpperCase());
  const fill = up ? 'rgba(61, 206, 122, 0.35)' : 'rgba(240, 85, 85, 0.35)';
  const r = size / 2;
  const font = Math.max(8, Math.round(size * 0.55));
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${font}" font-weight="700" fill="#e8edf5" font-family="IBM Plex Mono, monospace">${letter}</text>`;
}

type LabelLayout = {
  imgSize: number;
  imgCy: number;
  symSize: number;
  symY: number;
  pctSize: number;
  pctY: number;
  showSym: boolean;
  showPct: boolean;
  symLabel: string;
};

/**
 * Logo + ticker + % stack.
 * Prefer dropping logo / % before shrinking text below readable mins.
 * Ticker never shown below ~9px; prefer ≥11–12px when radius allows.
 * % never shown below ~9px.
 */
function computeLabelLayout(n: BubbleLayout): LabelLayout {
  const pad = Math.max(7, n.r * 0.16);
  const usable = Math.max(4, n.r * 2 - pad * 2);
  const gap = Math.max(2.5, n.r * 0.06);
  const maxTextW = Math.max(4, n.r * 2 - pad * 2);

  const MIN_SYM_SHOWN = 10;
  const MIN_SYM_COMFORT = 12.5;
  const MIN_PCT_SHOWN = 10;
  const empty = (imgSize: number): LabelLayout => ({
    imgSize,
    imgCy: n.y,
    symSize: 0,
    symY: n.y,
    pctSize: 0,
    pctY: n.y,
    showSym: false,
    showPct: false,
    symLabel: n.item.symbol || '—',
  });

  // Only the tiniest disks go logo-only (raised floor vs old r<20)
  if (n.r < 22) {
    const imgSize = Math.max(10, Math.min(usable * 0.7, n.r * 0.85));
    return empty(imgSize);
  }

  let symLabel = n.item.symbol || '—';
  const symChars = Math.max(1, symLabel.length);
  const pctChars = Math.max(1, compactPct(n.item.changePercent).length);

  // Target readable sizes first; drop layers if they won’t fit.
  let showPct = n.r >= 28;
  let showLogo = true;
  let imgSize = Math.max(14, Math.min(usable * 0.42, n.r * 0.52));
  let symSize = Math.max(
    MIN_SYM_COMFORT,
    Math.min(28, usable * (showPct ? 0.24 : 0.3)),
  );
  let pctSize = showPct
    ? Math.max(MIN_PCT_SHOWN, Math.min(22, usable * 0.19))
    : 0;

  symSize = Math.min(symSize, maxTextW / (symChars * 0.68));
  if (showPct) pctSize = Math.min(pctSize, maxTextW / (pctChars * 0.62));

  // Truncate long tickers rather than going illegible
  if (symSize < MIN_SYM_SHOWN && symChars > 4) {
    symSize = MIN_SYM_SHOWN;
    const maxChars = Math.max(3, Math.floor(maxTextW / (symSize * 0.68)));
    if (symLabel.length > maxChars) {
      symLabel = symLabel.slice(0, Math.max(2, maxChars - 1)) + '…';
    }
  }

  const stackH = () =>
    (showLogo ? imgSize + gap : 0) +
    symSize +
    (showPct ? gap + pctSize : 0);

  // Prefer keep logo (Birdeye-style): shrink text / drop % before logo
  if (stackH() > usable && showPct) {
    showPct = false;
    pctSize = 0;
  }
  if (stackH() > usable) {
    const s = usable / Math.max(stackH(), 1e-6);
    symSize *= s;
    imgSize *= Math.min(1, Math.max(0.75, s));
  }
  if (stackH() > usable && showLogo && n.r < 26) {
    showLogo = false;
    imgSize = 0;
  }
  if (stackH() > usable) {
    const s = usable / Math.max(stackH(), 1e-6);
    symSize *= s;
  }

  // Enforce readable floors: hide rather than paint unreadably small text
  if (showPct && pctSize < MIN_PCT_SHOWN) {
    showPct = false;
    pctSize = 0;
  }
  if (symSize < MIN_SYM_SHOWN) {
    // Fall back to logo-only if ticker can’t stay ≥9px
    if (n.r >= 14) {
      const solo = Math.max(8, Math.min(usable * 0.7, n.r * 0.85));
      return empty(solo);
    }
    return empty(Math.max(8, usable * 0.6));
  }

  // Comfort bump when space allows after drops (never overflow usable)
  if (!showPct && !showLogo) {
    symSize = Math.max(symSize, Math.min(MIN_SYM_COMFORT + 2, usable * 0.42));
  } else if (!showPct && showLogo) {
    const room = Math.max(MIN_SYM_SHOWN, usable - imgSize - gap);
    symSize = Math.max(symSize, Math.min(MIN_SYM_COMFORT, room, usable * 0.28));
  }
  if (stackH() > usable) {
    const over = stackH() - usable;
    symSize = Math.max(MIN_SYM_SHOWN, symSize - over);
  }

  const finalH = stackH();
  const topY = n.y - finalH / 2;
  let cursor = topY;
  let imgCy = n.y;
  if (showLogo) {
    imgCy = cursor + imgSize / 2;
    cursor += imgSize + gap;
  }
  const symY = cursor + symSize / 2;
  cursor += symSize;
  const pctY = showPct ? cursor + gap + pctSize / 2 : symY;

  return {
    imgSize: showLogo ? imgSize : 0,
    imgCy,
    symSize,
    symY,
    pctSize,
    pctY,
    showSym: true,
    showPct,
    symLabel,
  };
}

export function renderBubbleSvg(
  items: BubbleItem[],
  opts: {
    width?: number;
    height?: number;
    tfLabel?: string;
    emptyMessage?: string;
    /** cryptos → Birdeye; stocks/etfs → Robinhood */
    category?: 'cryptos' | 'solana' | 'stocks' | 'etfs';
  },
): string {
  const width = opts.width ?? 1600;
  const height = opts.height ?? 720;
  if (!items.length) {
    const msg =
      opts.emptyMessage ??
      'No movers for this category / timeframe (or data unavailable). Try another control — page stays up.';
    return `<div class="bubble-empty">${escapeHtml(msg)}</div>`;
  }
  const nodes = layoutBubbles(items, width, height);
  return svgFromLayouts(nodes, width, height, opts);
}

function svgFromLayouts(
  nodes: BubbleLayout[],
  width: number,
  height: number,
  opts: {
    tfLabel?: string;
    category?: 'cryptos' | 'solana' | 'stocks' | 'etfs';
  },
): string {
  const tfLabel = opts.tfLabel ?? '24h';
  const linkKind: 'crypto' | 'stock' | 'etf' =
    opts.category === 'stocks' ? 'stock' : opts.category === 'etfs' ? 'etf' : 'crypto';
  const labelLayouts = nodes.map((n) => computeLabelLayout(n));

  const defs = `
    <defs>
      ${nodes
        .map((n, i) => {
          const L = labelLayouts[i]!;
          if (L.imgSize < 1) return '';
          const imgR = L.imgSize / 2;
          return `<clipPath id="bclip-${i}"><circle cx="${n.x.toFixed(1)}" cy="${L.imgCy.toFixed(1)}" r="${imgR.toFixed(1)}"/></clipPath>`;
        })
        .join('')}
    </defs>`;

  const circles = nodes
    .map((n, i) => {
      const pct = n.item.changePercent;
      const up = (pct ?? 0) >= 0;
      const fill = up ? 'rgba(12, 48, 32, 0.92)' : 'rgba(52, 16, 20, 0.92)';
      const stroke = up ? '#3dce7a' : '#f05555';
      const rim = up ? 'rgba(61, 206, 122, 0.55)' : 'rgba(240, 85, 85, 0.55)';
      const tipPlain = bubbleTipText(n.item, tfLabel, linkKind);
      const tip = escapeHtml(tipPlain).replace(/\n/g, '&#10;');
      const statsHtml = [
        `<div>${escapeHtml(compactPct(n.item.changePercent))} (${escapeHtml(tfLabel)})</div>`,
        n.item.price != null
          ? `<div>Price ${escapeHtml(formatMoney(n.item.price))}</div>`
          : '',
      ].join('');
      const tipHtml = (
        describeAssetHtml(n.item.id, {
          kind: linkKind === 'etf' ? 'stock' : linkKind,
          name: n.item.name,
          symbol: n.item.symbol,
        }) + `<div class="tip-gap"></div>${statsHtml}`
      )
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '&#10;');
      const href = escapeHtml(
        chartUrlFor(n.item.id, {
          kind: linkKind,
          symbol: n.item.symbol,
          name: n.item.name,
        }),
      );
      const L = labelLayouts[i]!;
      const sym = escapeHtml(L.symLabel);
      const pctText = escapeHtml(compactPct(pct));
      const pctClass = up ? 'up' : 'down';
      const imgR = L.imgSize / 2;

      let logo = '';
      if (L.imgSize >= 1) {
        logo = letterAvatar(n.item.symbol, n.x, L.imgCy, L.imgSize, up);
        if (n.item.image) {
          logo += `<image href="${escapeHtml(n.item.image)}" x="${(n.x - imgR).toFixed(1)}" y="${(L.imgCy - imgR).toFixed(1)}" width="${L.imgSize.toFixed(1)}" height="${L.imgSize.toFixed(1)}" clip-path="url(#bclip-${i})" preserveAspectRatio="xMidYMid slice" class="bubble-logo" onerror="this.style.display='none'"/>
          <circle cx="${n.x.toFixed(1)}" cy="${L.imgCy.toFixed(1)}" r="${imgR.toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;
        }
      }

      const symText = L.showSym
        ? `<text class="bubble-label bubble-label-sym" x="${n.x.toFixed(1)}" y="${L.symY.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${L.symSize.toFixed(1)}" font-weight="800">${sym}</text>`
        : '';
      const pctEl = L.showPct
        ? `<text class="bubble-label bubble-label-pct ${pctClass}" x="${n.x.toFixed(1)}" y="${L.pctY.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${L.pctSize.toFixed(1)}" font-weight="700">${pctText}</text>`
        : '';

      const label = `${logo}
        ${symText}
        ${pctEl}`;

      const innerR = Math.max(1, n.r - 3.2);
      const softR = Math.max(n.r * 0.72, n.r - 14);
      const strokeW = n.r < 16 ? 2 : 2.6;
      return `<g class="bubble-node has-tip" data-tip="${tip}" data-tip-html="${tipHtml}" data-id="${escapeHtml(n.item.id)}" data-href="${href}" style="cursor:pointer">
        <circle class="bubble-disk" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>
        <circle class="bubble-rim" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${innerR.toFixed(1)}" fill="none" stroke="${rim}" stroke-width="3.5" opacity="0.28" pointer-events="none"/>
        <circle class="bubble-glow" cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${softR.toFixed(1)}" fill="${rim}" opacity="0.07" pointer-events="none"/>
        ${label}
      </g>`;
    })
    .join('');

  return `<svg class="bubble-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Bubble map of top movers with ${escapeHtml(tfLabel)} change">${defs}${circles}</svg>`;
}

type Pos = { x: number; y: number; r: number };

/** Last settled layout — used to morph between timeframe / data changes. */
let prevBubblePos = new Map<string, Pos>();
let bubbleAnimToken = 0;
let bubbleAnimRaf = 0;

/** Soft overshoot (Birdeye-like settle). */
function easeOutBack(t: number): number {
  const c1 = 1.55;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cancelBubbleAnim(): void {
  bubbleAnimToken += 1;
  if (bubbleAnimRaf) {
    cancelAnimationFrame(bubbleAnimRaf);
    bubbleAnimRaf = 0;
  }
}

/**
 * Paint bubbles into a canvas element. When `animate` is true and we have a
 * prior layout, morph positions/radii with a bounce instead of a hard cut.
 */
export function paintBubbleMap(
  canvas: HTMLElement,
  items: BubbleItem[],
  opts: {
    width?: number;
    height?: number;
    tfLabel?: string;
    emptyMessage?: string;
    category?: 'cryptos' | 'solana' | 'stocks' | 'etfs';
    animate?: boolean;
  },
): void {
  const width = opts.width ?? 1600;
  const height = opts.height ?? 720;
  const animate = opts.animate !== false;

  cancelBubbleAnim();

  if (!items.length) {
    prevBubblePos.clear();
    const msg =
      opts.emptyMessage ??
      'No movers for this category / timeframe (or data unavailable). Try another control — page stays up.';
    canvas.innerHTML = `<div class="bubble-empty">${escapeHtml(msg)}</div>`;
    return;
  }

  const targets = layoutBubbles(items, width, height);
  const cx = width / 2;
  const cy = height / 2;

  const starts: BubbleLayout[] = targets.map((n) => {
    const prev = prevBubblePos.get(n.item.id);
    if (prev && animate) {
      return { item: n.item, x: prev.x, y: prev.y, r: prev.r };
    }
    if (animate && prevBubblePos.size > 0) {
      // New ticker entering an existing map — pop in from center
      return {
        item: n.item,
        x: cx + (n.x - cx) * 0.2,
        y: cy + (n.y - cy) * 0.2,
        r: Math.max(6, n.r * 0.12),
      };
    }
    if (animate && prevBubblePos.size === 0) {
      // First paint: gentle expand from center cluster
      return {
        item: n.item,
        x: cx + (n.x - cx) * 0.35,
        y: cy + (n.y - cy) * 0.35,
        r: Math.max(8, n.r * 0.25),
      };
    }
    return { item: n.item, x: n.x, y: n.y, r: n.r };
  });

  const commitPrev = () => {
    prevBubblePos = new Map(
      targets.map((n) => [n.item.id, { x: n.x, y: n.y, r: n.r }]),
    );
  };

  if (!animate) {
    canvas.innerHTML = svgFromLayouts(targets, width, height, opts);
    commitPrev();
    return;
  }

  // Paint at start poses, then interpolate toward targets
  canvas.innerHTML = svgFromLayouts(starts, width, height, opts);

  const token = bubbleAnimToken;
  const duration = 820;
  const t0 = performance.now();

  const tick = (now: number) => {
    if (token !== bubbleAnimToken) return;
    const u = Math.min(1, (now - t0) / duration);
    // Slight stagger by index so the pack feels organic
    const cur: BubbleLayout[] = targets.map((n, i) => {
      const s = starts[i]!;
      const delay = (i % 7) * 0.018;
      const local = Math.min(1, Math.max(0, (u - delay) / (1 - delay * 0.85)));
      const e = easeOutBack(local);
      return {
        item: n.item,
        x: lerp(s.x, n.x, e),
        y: lerp(s.y, n.y, e),
        r: lerp(s.r, n.r, e),
      };
    });
    canvas.innerHTML = svgFromLayouts(cur, width, height, opts);
    if (u < 1) {
      bubbleAnimRaf = requestAnimationFrame(tick);
    } else {
      bubbleAnimRaf = 0;
      canvas.innerHTML = svgFromLayouts(targets, width, height, opts);
      commitPrev();
    }
  };

  bubbleAnimRaf = requestAnimationFrame(tick);
}

/** Clear morph memory (e.g. category switch). */
export function resetBubbleAnimState(): void {
  cancelBubbleAnim();
  prevBubblePos.clear();
}
