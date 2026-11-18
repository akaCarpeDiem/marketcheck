/**
 * An interactive price chart on a canvas, drawn with D3 scales and shapes.
 *
 * - Line (with a soft fill) or candles, with volume bars underneath when there is volume.
 * - Moving averages, worked out from a longer history than is shown so they start on the left edge.
 * - Compare: other series lined up by time and shown as percent change from the left edge.
 * - Hover for a crosshair; press and drag across the chart to measure the move between two points.
 *
 * Bars are spaced evenly by index, so nights and weekends leave no gaps; time labels are placed at
 * real calendar boundaries (hours, days, months, years) found with a D3 time scale.
 */
import { bisector } from 'd3-array';
import { scaleLinear, scaleTime } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import { cssVar, theme } from '../data/theme';
import type { Bar } from '../data/history';
import { esc } from '../lib/dom';
import { compact, pct } from '../lib/format';
import { alignTo, rebase, sma } from '../lib/stats';

export type ChartPoint = Bar;

export type ChartLine = { label: string; colour: string; points: { t: number; v: number }[] };

export type ChartOpts = {
  /** Draw a dashed reference line here (previous close on a 1-day chart). */
  baseline?: number | null;
  formatValue: (v: number) => string;
  /** Label for a point in time, given the whole span being shown. */
  formatTime: (ms: number, spanMs: number) => string;
  /** Kept for callers of the first version; axis labels now follow calendar boundaries. */
  formatAxisTime?: (ms: number, spanMs: number) => string;
  mode?: 'line' | 'candle';
  volume?: boolean;
  /** Moving-average periods, in bars. */
  averages?: number[];
  /** What one bar is, for the average labels: "day", "week", "hour". */
  barName?: string;
  /** A longer series ending with the same bars as `points`, used to start averages on the left edge. */
  history?: ChartPoint[];
  /** Other series to compare against; the chart then shows percent change from the left edge. */
  compare?: ChartLine[];
  /** Name and colour of the main series in compare mode. */
  label?: string;
  colour?: string;
};

export type Chart = {
  set(points: ChartPoint[], opts: ChartOpts): void;
  clear(message?: string): void;
  destroy(): void;
};

const AVG_COLOURS = ['#f5b942', '#a78bfa', '#60a5fa'];
const byT = bisector<ChartPoint, number>((d) => d.t).left;

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const hourMinFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const yearFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric' });

/** An axis label that says only as much as the boundary needs: a year, a month, a day or a time. */
function axisLabel(d: Date, span: number): string {
  const midnight = d.getHours() === 0 && d.getMinutes() === 0;
  if (span <= 1.6 * 86_400_000 && !midnight) return d.getMinutes() ? hourMinFmt.format(d) : hourFmt.format(d);
  if (midnight && d.getDate() === 1) return d.getMonth() === 0 ? yearFmt.format(d) : monthFmt.format(d);
  return dayFmt.format(d);
}

/** "3 h 20 min", "12 days", "4 months", "2.5 years". */
export function duration(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${(days / 365.25).toFixed(1).replace(/\.0$/, '')} years`;
}

export function createChart(host: HTMLElement): Chart {
  host.classList.add('chart');
  const canvas = document.createElement('canvas');
  canvas.style.touchAction = 'pan-y';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  const note = document.createElement('div');
  note.className = 'chart-note';
  host.append(canvas, legend, tip, note);
  const ctx = canvas.getContext('2d')!;

  let points: ChartPoint[] = [];
  let opts: ChartOpts | null = null;
  let hover = -1;
  /** A measured stretch: from bar a to bar b. `live` while the pointer is still down. */
  let measure: { a: number; b: number; live: boolean; x0: number; moved: boolean } | null = null;
  let averages: { period: number; colour: string; vals: (number | null)[] }[] = [];
  let lines: { label: string; colour: string; vals: (number | null)[] }[] = [];
  let mainPct: (number | null)[] = [];
  let legendHtml = '';
  let w = 0;
  let h = 0;
  const pad = { l: 8, r: 64, t: 14, b: 24 };

  const colours = () => ({
    up: cssVar('--up'),
    down: cssVar('--down'),
    flat: cssVar('--flat'),
    line: cssVar('--line'),
    line2: cssVar('--line-2'),
    text: cssVar('--text-3'),
    strong: cssVar('--text'),
    card: cssVar('--card'),
    brand: cssVar('--brand'),
  });

  const percentMode = () => lines.length > 0;
  const candleMode = () => opts?.mode === 'candle' && !percentMode() && points.length > 1 && points.every((p) => p.o != null && p.h != null && p.l != null);
  const volumeOn = () => !!opts?.volume && !percentMode() && points.some((p) => (p.vol ?? 0) > 0);
  /** The main series as plotted: price, or percent in compare mode. */
  const plotted = (i: number): number | null => (percentMode() ? (mainPct[i] ?? null) : points[i]!.v);

  function derive(): void {
    averages = [];
    lines = [];
    mainPct = [];
    if (!opts || points.length < 2) return;
    if (opts.compare?.length) {
      const times = points.map((p) => p.t);
      mainPct = rebase(points.map((p) => p.v));
      lines = opts.compare.map((c) => ({ label: c.label, colour: c.colour, vals: rebase(alignTo(times, c.points)) }));
      return;
    }
    const hist = opts.history && opts.history.length >= points.length ? opts.history : points;
    const offset = hist.length - points.length;
    const closes = hist.map((p) => p.v);
    (opts.averages ?? []).forEach((period, k) => {
      if (period >= closes.length) return;
      const all = sma(closes, period);
      const vals = all.slice(offset);
      if (vals.some((v) => v != null)) averages.push({ period, colour: AVG_COLOURS[k % AVG_COLOURS.length]!, vals });
    });
  }

  function layout() {
    const n = points.length;
    const iw = w - pad.l - pad.r;
    const vol = volumeOn();
    const priceBottom = vol ? pad.t + (h - pad.t - pad.b) * 0.78 : h - pad.b;
    const bw = iw / n;
    const x = (i: number) => pad.l + (i + 0.5) * bw;

    let min = Infinity;
    let max = -Infinity;
    const take = (v: number | null | undefined) => {
      if (v == null || !Number.isFinite(v)) return;
      if (v < min) min = v;
      if (v > max) max = v;
    };
    const candles = candleMode();
    for (let i = 0; i < n; i++) {
      if (candles) {
        take(points[i]!.l);
        take(points[i]!.h);
      } else take(plotted(i));
    }
    for (const a of averages) a.vals.forEach(take);
    for (const l of lines) l.vals.forEach(take);
    if (percentMode()) take(0);
    else if (opts?.baseline != null) take(opts.baseline);
    const span = max - min || Math.abs(max) * 0.02 || 1;
    const y = scaleLinear()
      .domain([min - span * 0.06, max + span * 0.06])
      .nice(5)
      .range([priceBottom, pad.t]);

    let vmax = 0;
    if (vol) for (const p of points) vmax = Math.max(vmax, p.vol ?? 0);
    const vy = scaleLinear().domain([0, vmax || 1]).range([h - pad.b, priceBottom + 8]);
    return { n, iw, bw, x, y, vy, vol, candles, priceBottom };
  }

  function draw(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = host.getBoundingClientRect();
    w = Math.max(160, Math.floor(rect.width));
    h = Math.max(140, Math.floor(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (points.length < 2 || !opts) {
      paintLegend(-1);
      tip.hidden = true;
      return;
    }

    const c = colours();
    const L = layout();
    const { n, x, y } = L;
    const fmt = (v: number) => (percentMode() ? pct(v, Math.abs(v) >= 100 ? 0 : 1) : opts!.formatValue(v));
    const first = percentMode() ? 0 : (opts.baseline ?? points[0]!.v);
    const lastV = plotted(n - 1) ?? 0;
    const tone = percentMode() ? (opts.colour ?? c.brand) : lastV > first ? c.up : lastV < first ? c.down : c.flat;
    const font = getComputedStyle(document.body).fontFamily;
    ctx.font = `500 11px ${font}`;

    // Value grid on calm numbers, with labels on the right.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const v of y.ticks(h < 230 ? 3 : 5)) {
      const yy = Math.round(y(v)) + 0.5;
      if (yy < pad.t - 2 || yy > L.priceBottom + 2) continue;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.stroke();
      ctx.fillStyle = c.text;
      ctx.fillText(fmt(v), w - pad.r + 8, yy);
    }

    // Time labels at calendar boundaries, each placed on the first bar after it.
    const t0 = points[0]!.t;
    const t1 = points[n - 1]!.t;
    const span = t1 - t0;
    const ticks = scaleTime().domain([new Date(t0), new Date(t1)]).ticks(w < 420 ? 4 : w < 700 ? 6 : 8);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    let lastX = -Infinity;
    for (const d of ticks) {
      const i = byT(points, d.getTime());
      if (i <= 0 || i >= n) continue;
      const xx = Math.round(x(i)) + 0.5;
      if (xx - lastX < 56 || xx > w - pad.r - 18) continue;
      lastX = xx;
      ctx.strokeStyle = c.line;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(xx, pad.t);
      ctx.lineTo(xx, h - pad.b);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text;
      ctx.fillText(axisLabel(d, span), xx, h - 7);
    }

    // Measured stretch, under everything else.
    if (measure && measure.moved) {
      const a = Math.min(measure.a, measure.b);
      const b = Math.max(measure.a, measure.b);
      const va = points[a]!.v;
      const vb = points[b]!.v;
      const mTone = vb > va ? c.up : vb < va ? c.down : c.flat;
      ctx.save();
      ctx.fillStyle = mTone;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(x(a), pad.t, x(b) - x(a), h - pad.b - pad.t);
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = mTone;
      ctx.setLineDash([3, 3]);
      for (const i of [a, b]) {
        ctx.beginPath();
        ctx.moveTo(Math.round(x(i)) + 0.5, pad.t);
        ctx.lineTo(Math.round(x(i)) + 0.5, h - pad.b);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Reference line: previous close, or zero in compare mode.
    const ref = percentMode() ? 0 : opts.baseline;
    if (ref != null && Number.isFinite(ref)) {
      const yy = Math.round(y(ref)) + 0.5;
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = c.text;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.stroke();
      ctx.restore();
    }

    // Volume.
    if (L.vol) {
      const bwv = Math.max(1, L.bw * 0.7);
      for (let i = 0; i < n; i++) {
        const p = points[i]!;
        if (!p.vol) continue;
        const prev = p.o ?? points[i - 1]?.v ?? p.v;
        ctx.fillStyle = p.v >= prev ? c.up : c.down;
        ctx.globalAlpha = 0.32;
        const top = L.vy(p.vol);
        ctx.fillRect(x(i) - bwv / 2, top, bwv, h - pad.b - top);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Vol', w - pad.r + 8, L.priceBottom + 14);
    }

    // Compare lines first, so the main series sits on top.
    for (const l of lines) strokeSeries(l.vals, l.colour, 1.6, 1);
    // Moving averages.
    for (const a of averages) strokeSeries(a.vals, a.colour, 1.4, 0.95);

    if (L.candles) {
      const body = Math.max(1, Math.min(14, L.bw * 0.66));
      for (let i = 0; i < n; i++) {
        const p = points[i]!;
        const up = p.v >= p.o!;
        const col = up ? c.up : c.down;
        const xx = Math.round(x(i)) + 0.5;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xx, y(p.h!));
        ctx.lineTo(xx, y(p.l!));
        ctx.stroke();
        const top = y(Math.max(p.o!, p.v));
        const bot = y(Math.min(p.o!, p.v));
        ctx.fillStyle = col;
        ctx.fillRect(xx - body / 2, top, body, Math.max(1, bot - top));
      }
    } else {
      // Fill, then line.
      const vals = points.map((_, i) => plotted(i));
      const path = new Path2D();
      let started = false;
      vals.forEach((v, i) => {
        if (v == null) return;
        if (started) path.lineTo(x(i), y(v));
        else {
          path.moveTo(x(i), y(v));
          started = true;
        }
      });
      if (!percentMode()) {
        const area = new Path2D(path);
        area.lineTo(x(n - 1), L.priceBottom);
        area.lineTo(x(0), L.priceBottom);
        area.closePath();
        const grad = ctx.createLinearGradient(0, pad.t, 0, L.priceBottom);
        grad.addColorStop(0, tone);
        grad.addColorStop(1, 'transparent');
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = grad;
        ctx.fill(area);
        ctx.restore();
      }
      ctx.strokeStyle = tone;
      ctx.lineWidth = percentMode() ? 2.2 : 1.8;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(path);

      // Last value marker.
      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.arc(x(n - 1), y(lastV), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crosshair.
    const at = measure?.moved ? measure.b : hover;
    if (at >= 0 && at < n) {
      const hx = Math.round(x(at)) + 0.5;
      ctx.strokeStyle = c.text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, pad.t);
      ctx.lineTo(hx, h - pad.b);
      ctx.stroke();
      const dots: [number | null, string][] = [[plotted(at), tone], ...lines.map((l) => [l.vals[at] ?? null, l.colour] as [number | null, string])];
      if (!L.candles)
        for (const [v, col] of dots) {
          if (v == null) continue;
          ctx.fillStyle = c.card;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(hx, y(v), 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
    }

    paintLegend(at);
    paintTip(at, span, hxOf(at));

    function strokeSeries(vals: (number | null)[], colour: string, width: number, alpha: number) {
      const ln = d3line<number | null>()
        .defined((v) => v != null)
        .x((_, i) => x(i))
        .y((v) => y(v!))
        .context(ctx);
      ctx.save();
      ctx.beginPath();
      ln(vals);
      ctx.strokeStyle = colour;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
    function hxOf(i: number) {
      return i >= 0 ? x(i) : 0;
    }
  }

  function paintLegend(at: number): void {
    if (!opts || points.length < 2) {
      if (legendHtml) legend.innerHTML = legendHtml = '';
      return;
    }
    const i = at >= 0 ? at : points.length - 1;
    const chips: string[] = [];
    if (percentMode()) {
      const v = mainPct[i];
      chips.push(`<span style="--c:${opts.colour ?? 'var(--brand)'}"><i></i>${esc(opts.label ?? 'This')} <b class="num">${v == null ? '—' : pct(v)}</b></span>`);
      for (const l of lines) {
        const lv = l.vals[i];
        chips.push(`<span style="--c:${l.colour}"><i></i>${esc(l.label)} <b class="num">${lv == null ? '—' : pct(lv)}</b></span>`);
      }
    } else {
      for (const a of averages) {
        const v = a.vals[i];
        chips.push(`<span style="--c:${a.colour}"><i></i>${a.period}-${opts.barName ?? 'bar'} avg <b class="num">${v == null ? '—' : esc(opts.formatValue(v))}</b></span>`);
      }
    }
    const next = chips.join('');
    if (next !== legendHtml) legend.innerHTML = legendHtml = next;
  }

  function paintTip(at: number, span: number, hx: number): void {
    if (!opts || at < 0 || at >= points.length) {
      tip.hidden = true;
      return;
    }
    let inner: string;
    if (measure?.moved) {
      const a = Math.min(measure.a, measure.b);
      const b = Math.max(measure.a, measure.b);
      const va = points[a]!.v;
      const vb = points[b]!.v;
      const ch = va ? ((vb - va) / va) * 100 : 0;
      const cls = ch > 0.005 ? 'up' : ch < -0.005 ? 'down' : 'flat';
      const diff = vb - va;
      inner = `<strong class="num ${cls}">${pct(ch)}</strong><span class="num ${cls}">${diff >= 0 ? '+' : '−'}${esc(opts.formatValue(Math.abs(diff)))}</span><em>${esc(opts.formatTime(points[a]!.t, span))} → ${esc(opts.formatTime(points[b]!.t, span))} · ${duration(points[b]!.t - points[a]!.t)}</em>`;
    } else {
      const p = points[at]!;
      const base = percentMode() ? null : (opts.baseline ?? points[0]!.v);
      const change = base ? ((p.v - base) / base) * 100 : (mainPct[at] ?? 0);
      const cls = change > 0.005 ? 'up' : change < -0.005 ? 'down' : 'flat';
      const ohlc = candleMode()
        ? `<span class="tip-ohlc num"><i>O</i>${esc(opts.formatValue(p.o!))} <i>H</i>${esc(opts.formatValue(p.h!))} <i>L</i>${esc(opts.formatValue(p.l!))}</span>`
        : '';
      const vol = volumeOn() && p.vol ? `<span class="tip-vol num">Vol ${compact(p.vol).replace('$', '')}</span>` : '';
      inner = `<strong class="num">${esc(opts.formatValue(p.v))}</strong><span class="num ${cls}">${pct(change)}</span>${ohlc}${vol}<em>${esc(opts.formatTime(p.t, span))}</em>`;
    }
    tip.innerHTML = inner;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = Math.max(4, Math.min(w - tw - 4, hx - tw / 2));
    tip.style.transform = `translate(${left}px, 0)`;
  }

  function indexAt(clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    const iw = w - pad.l - pad.r;
    const ratio = (clientX - rect.left - pad.l) / iw;
    return Math.max(0, Math.min(points.length - 1, Math.floor(ratio * points.length)));
  }

  const onDown = (ev: PointerEvent) => {
    if (points.length < 2 || ev.button > 0) return;
    const i = indexAt(ev.clientX);
    measure = { a: i, b: i, live: true, x0: ev.clientX, moved: false };
    hover = i;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* not capturable: measuring still works while over the chart */
    }
    draw();
  };
  const onMove = (ev: PointerEvent) => {
    if (points.length < 2) return;
    const i = indexAt(ev.clientX);
    if (measure?.live) {
      if (Math.abs(ev.clientX - measure.x0) > 4) measure.moved = true;
      if (measure.b !== i || hover !== i) {
        measure.b = i;
        hover = i;
        draw();
      }
      return;
    }
    if (i !== hover) {
      hover = i;
      draw();
    }
  };
  const onUp = () => {
    if (!measure) return;
    if (!measure.moved) measure = null;
    else measure.live = false;
    draw();
  };
  const onLeave = () => {
    if (measure?.live) return;
    hover = -1;
    measure = null;
    draw();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onLeave);
  canvas.addEventListener('pointerleave', onLeave);

  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  const stopTheme = theme.subscribe(() => draw());

  return {
    set(next, o) {
      points = next;
      opts = o;
      hover = -1;
      measure = null;
      note.textContent = '';
      note.hidden = true;
      derive();
      draw();
    },
    clear(message = '') {
      points = [];
      hover = -1;
      measure = null;
      derive();
      note.textContent = message;
      note.hidden = !message;
      draw();
    },
    destroy() {
      ro.disconnect();
      stopTheme();
      host.textContent = '';
      host.classList.remove('chart');
    },
  };
}
