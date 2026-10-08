import { makeCache, mapPool, sleep } from './cache';
import { ETF_UNIVERSE, STOCK_UNIVERSE, TF_HOURS, type Timeframe } from './universes';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FMP_LOGO = 'https://images.financialmodelingprep.com/symbol';

/** Response-level cache for equity movers (~2.5 min) — avoids CF timeouts on repeat. */
const moversCache = makeCache<{
  items: EquityMover[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
}>(150_000);

const quoteCache = makeCache<{
  symbol: string;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  shortName?: string;
  ok: boolean;
}>(30_000);
const chartCache = makeCache<{
  timestamps: number[];
  closes: number[];
  volumes: number[];
}>(60_000);

/** Chart TF subset sized to always fill limit=50 when Yahoo responds. */
const CHART_STOCK_LIMIT = 50;
const CHART_ETF_LIMIT = 50;

export type EquityMover = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  ok: boolean;
};

const UA = {
  'User-Agent': 'Mozilla/5.0 (compatible; MarketClock/1.0)',
  Accept: 'application/json',
};

function equityLogoUrl(yahoo: string): string {
  return `${FMP_LOGO}/${encodeURIComponent(yahoo)}.png`;
}

function chartUniverse(
  category: 'stocks' | 'etfs',
): { yahoo: string; label: string; name: string }[] {
  if (category === 'stocks') return STOCK_UNIVERSE.slice(0, CHART_STOCK_LIMIT);
  return ETF_UNIVERSE.slice(0, CHART_ETF_LIMIT);
}

async function fetchQuote(symbol: string) {
  const cached = quoteCache.get(symbol);
  if (cached) return cached;
  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      const miss = { symbol, price: null, changePercent: null, volume: null, ok: false };
      return miss;
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            previousClose?: number;
            chartPreviousClose?: number;
            shortName?: string;
            symbol?: string;
          };
          indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const meta = result?.meta;
    if (meta?.regularMarketPrice == null) {
      return { symbol, price: null, changePercent: null, volume: null, ok: false };
    }
    const price = meta.regularMarketPrice;
    const closes = result?.indicators?.quote?.[0]?.close?.filter(
      (c): c is number => c != null,
    );
    const prev =
      meta.previousClose ??
      meta.chartPreviousClose ??
      (closes && closes.length >= 2 ? closes[closes.length - 2] : undefined);
    let changePercent: number | null = null;
    if (prev != null && prev !== 0) {
      changePercent = ((price - prev) / prev) * 100;
    }
    const volFromMeta =
      typeof (meta as { regularMarketVolume?: number }).regularMarketVolume ===
      'number'
        ? (meta as { regularMarketVolume?: number }).regularMarketVolume!
        : null;
    const volArr = result?.indicators?.quote?.[0]?.volume;
    const lastVol =
      volArr
        ?.filter((v): v is number => v != null && Number.isFinite(v))
        .at(-1) ?? null;
    const q = {
      symbol: meta.symbol ?? symbol,
      price,
      changePercent,
      volume: volFromMeta ?? lastVol,
      shortName: meta.shortName,
      ok: true,
    };
    quoteCache.set(symbol, q);
    return q;
  } catch {
    return { symbol, price: null, changePercent: null, volume: null, ok: false };
  }
}

function chartParams(tf: Timeframe): { range: string; interval: string } {
  if (tf === '1h' || tf === '4h') return { range: '1d', interval: '5m' };
  if (tf === '8h' || tf === '12h') return { range: '1d', interval: '15m' };
  if (tf === '24h') return { range: '5d', interval: '1h' };
  if (tf === '7d') return { range: '1mo', interval: '1d' };
  if (tf === '30d') return { range: '3mo', interval: '1d' };
  if (tf === '1y') return { range: '1y', interval: '1d' };
  return { range: '5d', interval: '1h' };
}

async function fetchChartSeries(symbol: string, tf: Timeframe) {
  const { range, interval } = chartParams(tf);
  const key = `${symbol}|${range}|${interval}`;
  const cached = chartCache.get(key);
  if (cached) return cached;
  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return { timestamps: [] as number[], closes: [] as number[], volumes: [] as number[] };
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const raw = result?.indicators?.quote?.[0]?.close ?? [];
    const rawVol = result?.indicators?.quote?.[0]?.volume ?? [];
    const closes: number[] = [];
    const volumes: number[] = [];
    const tsOut: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const t = timestamps[i];
      if (c != null && Number.isFinite(c) && t != null) {
        closes.push(c);
        tsOut.push(t);
        const v = rawVol[i];
        volumes.push(v != null && Number.isFinite(v) ? v : 0);
      }
    }
    const data = { timestamps: tsOut, closes, volumes };
    chartCache.set(key, data);
    return data;
  } catch {
    return { timestamps: [] as number[], closes: [] as number[], volumes: [] as number[] };
  }
}

/** Intraday: lookback hours; if series shorter (weekend/after-hours), first→last of available bars. */
function pctOverHours(
  timestamps: number[],
  closes: number[],
  hours: number,
): number | null {
  if (closes.length < 2 || timestamps.length !== closes.length) return null;
  const lastClose = closes[closes.length - 1]!;
  const lastTs = timestamps[timestamps.length - 1]!;
  const firstTs = timestamps[0]!;
  const spanHours = (lastTs - firstTs) / 3600;
  // Series shorter than lookback (weekend / after-hours): use full available range
  if (spanHours + 0.05 < hours) {
    const base = closes[0]!;
    if (!base) return null;
    return ((lastClose - base) / base) * 100;
  }
  const target = lastTs - hours * 3600;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const dist = Math.abs(timestamps[i]! - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  const base = closes[bestIdx]!;
  if (!base) return null;
  return ((lastClose - base) / base) * 100;
}

/** Multi-day / year: (lastClose - firstClose) / firstClose on the chart series. */
function pctFirstToLast(closes: number[]): number | null {
  if (closes.length < 2) return null;
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

const MULTI_DAY_TFS = new Set<Timeframe>(['7d', '30d', '1y']);

export async function getEquityMovers(
  category: 'stocks' | 'etfs',
  tf: Timeframe,
  limit = 50,
): Promise<{
  items: EquityMover[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
}> {
  const cacheKey = `${category}|${tf}|${limit}`;
  const cached = moversCache.get(cacheKey);
  if (cached) return cached;

  const fullUniverse = category === 'stocks' ? STOCK_UNIVERSE : ETF_UNIVERSE;
  const hours = TF_HOURS[tf];

  if (tf === '24h') {
    const quotes = await mapPool(fullUniverse, 8, async (u, i) => {
      if (i > 0 && i % 8 === 0) await sleep(40);
      const q = await fetchQuote(u.yahoo);
      return { u, q };
    });
    const mapped: EquityMover[] = quotes.map(({ u, q }) => ({
      id: u.yahoo,
      symbol: u.label,
      name: u.name,
      image: equityLogoUrl(u.yahoo),
      price: q.price,
      changePercent: q.changePercent,
      volume: q.volume ?? null,
      marketCap: null,
      ok: q.ok,
    }));
    const withPct = mapped
      .filter((r) => r.changePercent != null)
      .sort(
        (a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!),
      );
    const items = withPct.slice(0, limit);
    if (items.length < limit) {
      const seen = new Set(items.map((r) => r.id));
      for (const row of mapped.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))) {
        if (seen.has(row.id)) continue;
        if (row.price == null) continue;
        items.push({ ...row, changePercent: row.changePercent ?? 0, ok: true });
        if (items.length >= limit) break;
      }
    }
    const shortNote =
      items.length < limit
        ? ` Yahoo returned only ${items.length}/${limit} usable quotes.`
        : '';
    const result = {
      items,
      effectiveTf: '24h',
      tfLabel: '24h',
      note: null,
      limitation: `Curated ${category} universe (${fullUniverse.length} symbols); target ${limit} bubbles; 24h ≈ Yahoo previous-close → last.${shortNote}`,
    };
    moversCache.set(cacheKey, result);
    return result;
  }

  // Chart lookback — smaller liquid subset + higher concurrency to finish under CF limits
  const universe = chartUniverse(category);
  const series = await mapPool(universe, 12, async (u) => {
    const chart = await fetchChartSeries(u.yahoo, tf);
    const pct = MULTI_DAY_TFS.has(tf)
      ? pctFirstToLast(chart.closes)
      : pctOverHours(chart.timestamps, chart.closes, hours);
    const last = chart.closes[chart.closes.length - 1] ?? null;
    let volume: number | null = null;
    if (chart.timestamps.length && chart.volumes.length) {
      if (MULTI_DAY_TFS.has(tf)) {
        volume = chart.volumes.reduce((s, v) => s + (v ?? 0), 0) || null;
      } else {
        const lastTs = chart.timestamps[chart.timestamps.length - 1]!;
        const firstTs = chart.timestamps[0]!;
        const spanHours = (lastTs - firstTs) / 3600;
        const target =
          spanHours + 0.05 < hours ? firstTs : lastTs - hours * 3600;
        let sum = 0;
        let any = false;
        for (let j = 0; j < chart.timestamps.length; j++) {
          if (chart.timestamps[j]! >= target) {
            sum += chart.volumes[j] ?? 0;
            any = true;
          }
        }
        volume = any ? sum : null;
      }
    }
    return {
      id: u.yahoo,
      symbol: u.label,
      name: u.name,
      image: equityLogoUrl(u.yahoo),
      price: last,
      changePercent: pct,
      volume,
      marketCap: null as number | null,
      ok: pct != null && last != null,
    };
  });

  const withPct = series
    .filter((r) => r.changePercent != null)
    .sort(
      (a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!),
    );
  const items = withPct.slice(0, limit);
  if (items.length < limit) {
    const seen = new Set(items.map((r) => r.id));
    for (const row of [...series].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))) {
      if (seen.has(row.id)) continue;
      if (row.price == null) continue;
      items.push({ ...row, changePercent: row.changePercent ?? 0, ok: true });
      if (items.length >= limit) break;
    }
  }

  const pctNote = MULTI_DAY_TFS.has(tf)
    ? `${tf} % = (lastClose − firstClose) / firstClose on Yahoo chart range`
    : `${tf} % from Yahoo chart close lookback ~${hours}h (falls back to first→last if series shorter)`;
  const shortNote =
    items.length < limit
      ? ` Yahoo returned only ${items.length}/${limit} usable series.`
      : '';

  const result = {
    items,
    effectiveTf: tf,
    tfLabel: tf,
    note: null,
    limitation: `Chart TF uses ${universe.length} ${category} symbols (target ${limit} bubbles, concurrency 12, cached ~2.5m). ${pctNote}.${shortNote}`,
  };
  moversCache.set(cacheKey, result);
  return result;
}
