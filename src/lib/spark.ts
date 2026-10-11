/** Small inline charts as SVG strings. */

let uid = 0;

/**
 * A sparkline that stretches to its container. `tone` picks the colour;
 * by default it is green when the series ends higher than it starts.
 */
export function sparkline(
  values: number[] | null | undefined,
  opts: { w?: number; h?: number; tone?: 'up' | 'down' | 'flat' | 'brand'; fill?: boolean; baseline?: number | null } = {},
): string {
  const w = opts.w ?? 120;
  const h = opts.h ?? 36;
  if (!values || values.length < 2) return `<svg class="spark spark-empty" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"></svg>`;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (opts.baseline != null) {
    min = Math.min(min, opts.baseline);
    max = Math.max(max, opts.baseline);
  }
  const span = max - min || Math.abs(max) * 0.01 || 1;
  const pad = 2;
  const sx = (w - 1) / (values.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);
  let d = '';
  for (let i = 0; i < values.length; i++) {
    d += `${i ? 'L' : 'M'}${(i * sx + 0.5).toFixed(1)} ${y(values[i]!).toFixed(1)}`;
  }
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const tone = opts.tone ?? (last > first ? 'up' : last < first ? 'down' : 'flat');
  const id = `sg${(uid += 1)}`;
  const area =
    opts.fill === false
      ? ''
      : `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".28"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="${d}L${w - 0.5} ${h}L0.5 ${h}Z" fill="url(#${id})" stroke="none"/>`;
  const base =
    opts.baseline != null
      ? `<line x1="0" x2="${w}" y1="${y(opts.baseline).toFixed(1)}" y2="${y(opts.baseline).toFixed(1)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 3" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      : '';
  return `<svg class="spark spark-${tone}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${area}${base}<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

/** A horizontal bar showing where `value` sits between `low` and `high`. */
export function rangeBar(low: number | null, high: number | null, value: number | null): string {
  if (low == null || high == null || value == null || !(high > low)) return '';
  const at = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return `<span class="rangebar" aria-hidden="true"><i style="left:${at.toFixed(1)}%"></i></span>`;
}
