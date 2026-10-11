/** An interactive price chart on a canvas: line, soft fill, axes and a crosshair. */
import { cssVar, theme } from '../data/theme';

export type ChartPoint = { t: number; v: number };

export type ChartOpts = {
  /** Draw a dashed reference line here (previous close on a 1-day chart). */
  baseline?: number | null;
  formatValue: (v: number) => string;
  /** Label for a point in time, given the whole span being shown. */
  formatTime: (ms: number, spanMs: number) => string;
  formatAxisTime: (ms: number, spanMs: number) => string;
};

export type Chart = {
  set(points: ChartPoint[], opts: ChartOpts): void;
  clear(message?: string): void;
  destroy(): void;
};

export function createChart(host: HTMLElement): Chart {
  host.classList.add('chart');
  const canvas = document.createElement('canvas');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  const note = document.createElement('div');
  note.className = 'chart-note';
  host.append(canvas, tip, note);
  const ctx = canvas.getContext('2d')!;

  let points: ChartPoint[] = [];
  let opts: ChartOpts | null = null;
  let hover = -1;
  let w = 0;
  let h = 0;
  const pad = { l: 8, r: 62, t: 12, b: 24 };

  const colours = () => ({
    up: cssVar('--up'),
    down: cssVar('--down'),
    flat: cssVar('--flat'),
    line: cssVar('--line'),
    text: cssVar('--text-3'),
    strong: cssVar('--text'),
    card: cssVar('--card'),
  });

  function scale() {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    }
    const base = opts?.baseline;
    if (base != null && Number.isFinite(base)) {
      min = Math.min(min, base);
      max = Math.max(max, base);
    }
    const span = max - min || Math.abs(max) * 0.02 || 1;
    min -= span * 0.08;
    max += span * 0.08;
    const t0 = points[0]!.t;
    const t1 = points[points.length - 1]!.t;
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;
    // Points are spaced evenly by index, so nights and weekends leave no gaps.
    const x = (i: number) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * ih;
    return { min, max, t0, t1, x, y, iw, ih };
  }

  function draw(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = host.getBoundingClientRect();
    w = Math.max(120, Math.floor(rect.width));
    h = Math.max(120, Math.floor(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (points.length < 2 || !opts) return;

    const c = colours();
    const s = scale();
    const first = opts.baseline ?? points[0]!.v;
    const last = points[points.length - 1]!.v;
    const tone = last > first ? c.up : last < first ? c.down : c.flat;
    ctx.font = `500 11px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textBaseline = 'middle';

    // Horizontal grid and value labels.
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
      const v = s.min + ((s.max - s.min) * i) / rows;
      const yy = Math.round(s.y(v)) + 0.5;
      ctx.strokeStyle = c.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.stroke();
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.fillText(opts.formatValue(v), w - pad.r + 8, yy);
    }

    // Time labels.
    const span = s.t1 - s.t0;
    const cols = w < 420 ? 3 : 5;
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < cols; i++) {
      const idx = Math.round(((points.length - 1) * i) / (cols - 1));
      const label = opts.formatAxisTime(points[idx]!.t, span);
      ctx.fillStyle = c.text;
      ctx.textAlign = i === 0 ? 'left' : i === cols - 1 ? 'right' : 'center';
      ctx.fillText(label, s.x(idx), h - 6);
    }

    // Reference line.
    if (opts.baseline != null && Number.isFinite(opts.baseline)) {
      const yy = Math.round(s.y(opts.baseline)) + 0.5;
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

    // Fill, then line.
    const path = new Path2D();
    points.forEach((p, i) => (i ? path.lineTo(s.x(i), s.y(p.v)) : path.moveTo(s.x(i), s.y(p.v))));
    const area = new Path2D(path);
    area.lineTo(s.x(points.length - 1), h - pad.b);
    area.lineTo(s.x(0), h - pad.b);
    area.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, tone);
    grad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = grad;
    ctx.fill(area);
    ctx.restore();
    ctx.strokeStyle = tone;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);

    // Last value marker.
    const lx = s.x(points.length - 1);
    const ly = s.y(last);
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();

    if (hover >= 0 && hover < points.length) {
      const p = points[hover]!;
      const hx = Math.round(s.x(hover)) + 0.5;
      ctx.strokeStyle = c.text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, pad.t);
      ctx.lineTo(hx, h - pad.b);
      ctx.stroke();
      ctx.fillStyle = c.card;
      ctx.strokeStyle = tone;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hx, s.y(p.v), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const change = first ? ((p.v - first) / first) * 100 : 0;
      const cls = change > 0.005 ? 'up' : change < -0.005 ? 'down' : 'flat';
      tip.innerHTML = `<strong class="num">${opts.formatValue(p.v)}</strong><span class="num ${cls}">${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(2)}%</span><em>${opts.formatTime(p.t, span)}</em>`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = Math.max(4, Math.min(w - tw - 4, hx - tw / 2));
      tip.style.transform = `translate(${left}px, 0)`;
    } else {
      tip.hidden = true;
    }
  }

  function pick(clientX: number): void {
    if (points.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const iw = w - pad.l - pad.r;
    const ratio = (clientX - rect.left - pad.l) / iw;
    const next = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    if (next !== hover) {
      hover = next;
      draw();
    }
  }

  const onMove = (ev: PointerEvent) => pick(ev.clientX);
  const onLeave = () => {
    hover = -1;
    draw();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointercancel', onLeave);

  const ro = new ResizeObserver(() => draw());
  ro.observe(host);
  const stopTheme = theme.subscribe(() => draw());

  return {
    set(next, o) {
      points = next;
      opts = o;
      hover = -1;
      note.textContent = '';
      note.hidden = true;
      draw();
    },
    clear(message = '') {
      points = [];
      hover = -1;
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
