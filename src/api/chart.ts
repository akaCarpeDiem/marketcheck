import { DEFAULT_FETCH_MS, fetchSignal } from './fetchTimeout';

export type ChartSeries = {
  symbol: string;
  closes: number[];
  ok: boolean;
  range?: string;
  interval?: string;
};

export async function fetchChartSeries(
  symbol: string,
  range = '1y',
  interval = '1d',
  signal?: AbortSignal,
): Promise<ChartSeries> {
  const qs = new URLSearchParams({ symbol, range, interval });
  let last: ChartSeries = { symbol, closes: [], ok: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`/api/chart?${qs}`, { signal: fetchSignal(DEFAULT_FETCH_MS, signal) });
    if (!res.ok) throw new Error(`Chart proxy HTTP ${res.status}`);
    const data = (await res.json()) as ChartSeries;
    last = {
      symbol: data.symbol ?? symbol,
      closes: Array.isArray(data.closes) ? data.closes : [],
      ok: Boolean(data.ok && data.closes?.length > 1),
      range: data.range,
      interval: data.interval,
    };
    if (last.ok) return last;
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return last;
}


/** Hero + index sparklines in one request (server uses a single Yahoo spark call). */
export async function fetchSparklineBatch(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Map<string, number[]>> {
  const uniq = [...new Set(symbols.filter(Boolean))];
  const map = new Map<string, number[]>();
  if (!uniq.length) return map;
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += 20) chunks.push(uniq.slice(i, i + 20));
  await Promise.all(
    chunks.map(async (c) => {
      const params = new URLSearchParams({ symbols: c.join(',') });
      const res = await fetch(`/api/sparklines?${params}`, {
        signal: fetchSignal(DEFAULT_FETCH_MS, signal),
      });
      if (!res.ok) throw new Error(`Sparkline proxy HTTP ${res.status}`);
      const data = (await res.json()) as {
        series?: Array<{ symbol?: string; closes?: number[]; ok?: boolean }>;
      };
      for (const row of data.series ?? []) {
        if (!row.symbol || !row.ok || !row.closes || row.closes.length < 2) continue;
        map.set(row.symbol, row.closes);
      }
    }),
  );
  return map;
}

/** Downsample closes to ~n points for a dense sparkline */
export function downsample(closes: number[], n = 64): number[] {
  if (closes.length <= n) return closes;
  const out: number[] = [];
  const step = (closes.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    out.push(closes[Math.round(i * step)]!);
  }
  return out;
}

/** Tiny SVG sparkline (no axes). Accent stroke color via CSS currentColor or fill attr. */
export function sparklineSvg(closes: number[], opts?: { w?: number; h?: number; color?: string }): string {
  const w = opts?.w ?? 120;
  const h = opts?.h ?? 32;
  const color = opts?.color ?? 'currentColor';
  const pts = downsample(closes, 72);
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const padY = 2;
  const innerH = h - padY * 2;
  const coords = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = padY + innerH - ((v - min) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" points="${coords}"/></svg>`;
}
