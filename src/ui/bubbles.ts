/**
 * The bubble map: one circle per asset, sized by a weight (how far it moved,
 * or its market cap), coloured by direction, packed to fill whatever box it is
 * given.
 *
 * Packing works in three steps:
 *   1. Give each bubble a radius from its weight, sized so the bubbles together
 *      cover a set share of the box.
 *   2. Push overlapping bubbles apart and keep them inside the walls until
 *      nothing overlaps.
 *   3. Grow every bubble a little and repeat step 2, until they no longer fit.
 *      The last layout that fitted is the one that is drawn.
 * Because the walls are the box itself, the result fills a wide strip, a tall
 * column or a square equally well; there is no fixed shape to centre.
 */
import { cssVar, theme } from '../data/theme';
import { debounce, reducedMotion } from '../lib/dom';
import { MIN_REL, WALL, hashUnit, packBubbles } from '../lib/pack';

export type Bubble = {
  /** Stable id; a bubble with the same key keeps its place between updates. */
  key: string;
  label: string;
  /** Percent change shown in the bubble and used for colour. */
  change: number | null;
  /** Relative size. Any positive number. */
  weight: number;
  image: string | null;
};

export type BubbleMapOpts = {
  /** How strongly weight differences show: 0.5 makes area proportional to weight. */
  exponent?: number;
  /** Text for the hover card. */
  tooltip: (key: string) => string;
  onPick: (key: string) => void;
  /** Shown in place of the map when there is nothing to draw. */
  emptyText?: string;
};

export type BubbleMap = {
  set(items: Bubble[], opts?: { exponent?: number; emptyText?: string }): void;
  destroy(): void;
};

type Node = {
  key: string;
  item: Bubble;
  /** Current drawn position and radius. */
  x: number;
  y: number;
  r: number;
  /** Where the animation started and where it ends. */
  x0: number;
  y0: number;
  r0: number;
  x1: number;
  y1: number;
  r1: number;
};

const images = new Map<string, HTMLImageElement | 'failed'>();

export function createBubbleMap(host: HTMLElement, opts: BubbleMapOpts): BubbleMap {
  host.classList.add('bubbles');
  host.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  const tip = document.createElement('div');
  tip.className = 'bubble-tip';
  tip.hidden = true;
  const empty = document.createElement('div');
  empty.className = 'bubbles-empty';
  empty.hidden = true;
  const list = document.createElement('ul');
  list.className = 'sr-only';
  host.append(canvas, tip, empty, list);
  const ctx = canvas.getContext('2d')!;

  let nodes: Node[] = [];
  let w = 0;
  let h = 0;
  let exponent = opts.exponent ?? 0.5;
  let hover: Node | null = null;
  let raf = 0;
  let animStart = 0;
  let animating = false;
  let colourMax = 5;
  let destroyed = false;

  function measure(): boolean {
    const rect = host.getBoundingClientRect();
    const nw = Math.floor(rect.width);
    const nh = Math.floor(rect.height);
    if (nw === w && nh === h) return false;
    w = nw;
    h = nh;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    return true;
  }

  function layout(items: Bubble[], oldW: number, oldH: number): void {
    const prev = new Map(nodes.map((n) => [n.key, n]));
    const usable = items.filter((it) => it.weight > 0 && Number.isFinite(it.weight));
    // Biggest first: they are drawn first and claim space first.
    usable.sort((a, b) => b.weight - a.weight);
    const max = usable[0]?.weight ?? 1;
    const shares = usable.map((it) => Math.max(MIN_REL, Math.pow(it.weight / max, exponent)));
    const start = usable.map((it) => {
      const old = prev.get(it.key);
      if (old && oldW > 0 && oldH > 0) return { x: (old.x1 / oldW) * w, y: (old.y1 / oldH) * h };
      return { x: WALL + hashUnit(it.key, 1) * (w - 2 * WALL), y: WALL + hashUnit(it.key, 2) * (h - 2 * WALL) };
    });
    // A first layout tries a few scatters; later ones start from where the bubbles already are.
    const packed = packBubbles(shares, start, w, h, !usable.some((it) => prev.has(it.key)));
    nodes = usable.map((it, i) => {
      const p = packed[i] ?? { x: w / 2, y: h / 2, r: 0 };
      const old = prev.get(it.key);
      const from = old ? { x: (old.x / (oldW || w)) * w, y: (old.y / (oldH || h)) * h, r: old.r } : { x: p.x, y: p.y, r: 0 };
      return { key: it.key, item: it, x: from.x, y: from.y, r: from.r, x0: from.x, y0: from.y, r0: from.r, x1: p.x, y1: p.y, r1: p.r };
    });
    // Colour scale: the 85th percentile of moves is full strength, so one outlier does not wash out the rest.
    const moves = usable.map((it) => Math.abs(it.change ?? 0)).sort((a, b) => a - b);
    colourMax = Math.max(0.5, moves[Math.floor(moves.length * 0.85)] ?? 5);
  }

  function getImage(url: string): HTMLImageElement | null {
    const hit = images.get(url);
    if (hit === 'failed') return null;
    if (hit) return hit.complete && hit.naturalWidth > 0 ? hit : null;
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => schedule();
    img.onerror = () => images.set(url, 'failed');
    img.src = url;
    images.set(url, img);
    return null;
  }

  function draw(): void {
    const dpr = canvas.width / Math.max(1, w);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!nodes.length) return;
    const up = cssVar('--up');
    const down = cssVar('--down');
    const flat = cssVar('--flat');
    const text = cssVar('--text');
    const card = cssVar('--card');
    const family = getComputedStyle(document.body).fontFamily;
    const light = theme.get() === 'light';

    const order = hover ? [...nodes.filter((n) => n !== hover), hover] : nodes;
    for (const n of order) {
      const r = n === hover ? n.r * 1.05 : n.r;
      if (r < 1) continue;
      const ch = n.item.change;
      const tone = ch == null || Math.abs(ch) < 0.005 ? flat : ch > 0 ? up : down;
      const t = Math.max(0.12, Math.min(1, Math.abs(ch ?? 0) / colourMax));

      ctx.save();
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = card;
      ctx.fill();
      const g = ctx.createRadialGradient(n.x, n.y - r * 0.2, r * 0.1, n.x, n.y, r);
      g.addColorStop(0, tone);
      g.addColorStop(1, tone);
      ctx.globalAlpha = (light ? 0.1 : 0.12) + t * (light ? 0.22 : 0.3);
      ctx.fillStyle = g;
      ctx.fill();
      // A brighter rim gives the bubble its shape.
      ctx.globalAlpha = 0.35 + t * 0.6;
      ctx.lineWidth = n === hover ? 2.4 : 1.4;
      ctx.strokeStyle = tone;
      ctx.stroke();
      const rim = ctx.createRadialGradient(n.x, n.y, r * 0.62, n.x, n.y, r);
      rim.addColorStop(0, 'transparent');
      rim.addColorStop(1, tone);
      ctx.globalAlpha = 0.1 + t * 0.26;
      ctx.fillStyle = rim;
      ctx.fill();
      ctx.restore();

      // Contents: logo, ticker, percent — as much as the radius allows.
      const label = n.item.label;
      const pctText = ch == null ? '' : `${ch > 0 ? '+' : ch < 0 ? '−' : ''}${Math.abs(ch) >= 100 ? Math.abs(ch).toFixed(0) : Math.abs(ch).toFixed(1)}%`;
      const symSize = Math.max(9, Math.min(22, r * 0.36));
      const pctSize = Math.max(9, Math.min(17, r * 0.3));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const img = n.item.image && r >= 24 ? getImage(n.item.image) : null;
      const showLogo = !!img;
      const showBoth = r >= 17;
      let y = n.y;
      if (showLogo) {
        const size = Math.min(34, r * 0.6);
        const top = n.y - (size + symSize + pctSize + 6) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(n.x, top + size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.fillRect(n.x - size / 2, top, size, size);
        ctx.drawImage(img!, n.x - size / 2, top, size, size);
        ctx.restore();
        y = top + size + 4 + symSize / 2;
      } else if (showBoth) {
        y = n.y - pctSize / 2 - 1;
      }
      ctx.fillStyle = text;
      ctx.font = `600 ${symSize}px ${family}`;
      let shown = label;
      const maxWidth = r * 1.7;
      while (shown.length > 2 && ctx.measureText(shown).width > maxWidth) shown = shown.slice(0, -1);
      if (r >= 11) ctx.fillText(shown, n.x, y);
      if (showBoth && pctText) {
        ctx.fillStyle = tone;
        ctx.font = `600 ${pctSize}px ${family}`;
        ctx.fillText(pctText, n.x, y + symSize / 2 + pctSize / 2 + 2);
      }
    }
  }

  function step(now: number): void {
    raf = 0;
    if (destroyed) return;
    const t = Math.min(1, (now - animStart) / 650);
    const e = 1 - Math.pow(1 - t, 3);
    for (const n of nodes) {
      n.x = n.x0 + (n.x1 - n.x0) * e;
      n.y = n.y0 + (n.y1 - n.y0) * e;
      n.r = n.r0 + (n.r1 - n.r0) * e;
    }
    draw();
    if (t < 1) raf = requestAnimationFrame(step);
    else animating = false;
  }

  function finish(): void {
    for (const n of nodes) {
      n.x = n.x1;
      n.y = n.y1;
      n.r = n.r1;
    }
    animating = false;
    draw();
  }

  function schedule(): void {
    if (animating || raf || destroyed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function play(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    // A hidden tab gets no animation frames, so draw the end state at once.
    if (reducedMotion() || document.hidden) {
      finish();
      return;
    }
    animating = true;
    animStart = performance.now();
    raf = requestAnimationFrame(step);
  }

  function paintList(): void {
    list.innerHTML = nodes
      .map(
        (n) =>
          `<li><button type="button" data-key="${n.key.replace(/"/g, '&quot;')}">${n.item.label.replace(/[<>&]/g, '')} ${n.item.change == null ? '' : `${n.item.change > 0 ? 'up' : 'down'} ${Math.abs(n.item.change).toFixed(1)} percent`}</button></li>`,
      )
      .join('');
    canvas.setAttribute('aria-label', `Bubble map of ${nodes.length} assets. Use the list that follows to open one.`);
  }

  function at(clientX: number, clientY: number): Node | null {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let found: Node | null = null;
    for (const n of nodes) {
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= n.r * n.r) found = n;
    }
    return found;
  }

  function showTip(n: Node | null): void {
    if (!n) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = opts.tooltip(n.key);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = n.x - tw / 2;
    left = Math.max(6, Math.min(w - tw - 6, left));
    let top = n.y - n.r - th - 8;
    if (top < 4) top = Math.min(h - th - 4, n.y + n.r + 8);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  const onMove = (ev: PointerEvent) => {
    const n = at(ev.clientX, ev.clientY);
    if (n !== hover) {
      hover = n;
      canvas.style.cursor = n ? 'pointer' : '';
      showTip(ev.pointerType === 'touch' ? null : n);
      schedule();
    }
  };
  const onLeave = () => {
    if (!hover) return;
    hover = null;
    canvas.style.cursor = '';
    showTip(null);
    schedule();
  };
  const onClick = (ev: MouseEvent) => {
    const n = at(ev.clientX, ev.clientY);
    if (n) opts.onPick(n.key);
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);
  list.addEventListener('click', (ev) => {
    const key = (ev.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key) opts.onPick(key);
  });

  let lastItems: Bubble[] = [];
  const relayout = debounce(() => {
    if (destroyed) return;
    const oldW = w;
    const oldH = h;
    if (!measure()) return;
    layout(lastItems, oldW, oldH);
    finish();
  }, 90);
  const ro = new ResizeObserver(() => relayout());
  ro.observe(host);
  const stopTheme = theme.subscribe(() => schedule());

  return {
    set(items, o) {
      if (o?.exponent != null) exponent = o.exponent;
      lastItems = items;
      const oldW = w;
      const oldH = h;
      measure();
      const has = items.some((it) => it.weight > 0);
      empty.hidden = has;
      empty.textContent = has ? '' : (o?.emptyText ?? opts.emptyText ?? 'Nothing to show right now.');
      canvas.style.visibility = has ? '' : 'hidden';
      if (hover && !items.some((it) => it.key === hover!.key)) {
        hover = null;
        showTip(null);
      }
      layout(has ? items : [], oldW || w, oldH || h);
      if (hover) hover = nodes.find((n) => n.key === hover!.key) ?? null;
      paintList();
      play();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      stopTheme();
      host.textContent = '';
      host.classList.remove('bubbles');
    },
  };
}
