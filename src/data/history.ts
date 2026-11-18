/**
 * Price history for charts: Yahoo series through /api/chart, CoinGecko series and candles
 * asked from the browser, and daily closes for any asset (Compare page, portfolio history).
 * Answers are kept in memory for a few minutes so switching back and forth costs nothing.
 */
import { coinForPair, type AssetRef } from './assets';
import { crypto } from './market';
import { getJson } from '../lib/api';
import { dailyLast } from '../lib/stats';

/** One bar: time (ms), close, and when known open, high, low and volume. */
export type Bar = { t: number; v: number; o?: number; h?: number; l?: number; vol?: number };

export type ChartMeta = {
  prevClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  high52: number | null;
  low52: number | null;
  exchange: string | null;
  name: string | null;
  price: number | null;
};

type ChartPayload = {
  ok?: boolean;
  closes?: number[];
  timestamps?: number[];
  volumes?: number[];
  opens?: number[];
  highs?: number[];
  lows?: number[];
  meta?: ChartMeta | null;
};

const memo = new Map<string, { at: number; value: Promise<unknown> }>();

/** Run `load` once per key within `maxAge`; a failed load is forgotten so it can be retried. */
function remember<T>(key: string, maxAge: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.value as Promise<T>;
  const value = load();
  memo.set(key, { at: Date.now(), value });
  value.catch(() => memo.delete(key));
  if (memo.size > 120) memo.delete(memo.keys().next().value!);
  return value;
}

const ageFor = (interval: string): number => (/m$|h$/.test(interval) ? 60_000 : 5 * 60_000);

/** A Yahoo series with candles and volume when Yahoo has them. Null when there is no usable series. */
export function yahooBars(symbol: string, range: string, interval: string): Promise<{ bars: Bar[]; meta: ChartMeta | null } | null> {
  return remember(`y|${symbol}|${range}|${interval}`, ageFor(interval), async () => {
    const d = await getJson<ChartPayload>(
      `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`,
      { timeout: 20_000 },
    );
    const c = d.closes ?? [];
    const t = d.timestamps ?? [];
    if (!d.ok || c.length < 2 || t.length !== c.length) return null;
    const ohlc = d.opens?.length === c.length && d.highs?.length === c.length && d.lows?.length === c.length;
    const vols = d.volumes?.length === c.length && d.volumes.some((v) => v > 0);
    const bars: Bar[] = c.map((v, i) => {
      const b: Bar = { t: t[i]! * 1000, v };
      if (ohlc) {
        b.o = d.opens![i]!;
        b.h = d.highs![i]!;
        b.l = d.lows![i]!;
      }
      if (vols) b.vol = d.volumes![i]!;
      return b;
    });
    return { bars, meta: d.meta ?? null };
  });
}

/** CoinGecko's public price series for a coin over the past `days`, thinned to a few hundred points. */
export function coinGeckoBars(id: string, days: number): Promise<Bar[] | null> {
  return remember(`cg|${id}|${days}`, days <= 1 ? 60_000 : 5 * 60_000, async () => {
    const d = await getJson<{ prices?: [number, number][] }>(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`,
      { timeout: 9000 },
    );
    const rows = (d.prices ?? []).filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]));
    if (rows.length < 2) return null;
    const step = Math.max(1, Math.floor(rows.length / 360));
    const out: Bar[] = [];
    for (let i = 0; i < rows.length; i += step) out.push({ t: rows[i]![0], v: rows[i]![1] });
    const last = rows[rows.length - 1]!;
    if (out[out.length - 1]!.t !== last[0]) out.push({ t: last[0], v: last[1] });
    return out;
  });
}

/** CoinGecko candles. Their size follows the span: 30 minutes for a day, 4 hours up to a month, 4 days beyond. */
export function coinGeckoCandles(id: string, days: number): Promise<Bar[] | null> {
  return remember(`cgo|${id}|${days}`, 5 * 60_000, async () => {
    const d = await getJson<[number, number, number, number, number][]>(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`,
      { timeout: 9000 },
    );
    const rows = (Array.isArray(d) ? d : []).filter((r) => Array.isArray(r) && r.length >= 5 && r.every((x) => Number.isFinite(x)));
    if (rows.length < 2) return null;
    return rows.map(([t, o, h, l, c]) => ({ t, v: c, o, h: Math.max(h, o, c), l: Math.min(l, o, c) }));
  });
}

/** The coin behind a ref, if it is one in the crypto list. */
export function coinOf(ref: AssetRef) {
  return ref.cg ? (crypto.get().byId.get(ref.cg) ?? null) : ref.kind === 'crypto' && ref.yahoo ? coinForPair(ref.yahoo) : null;
}

/**
 * The Yahoo pair that tracks a coin (BTC-USD), but only once Yahoo's price for it agrees with
 * CoinGecko's: some tickers belong to a different coin on Yahoo.
 */
export async function verifiedPair(ref: AssetRef): Promise<string | null> {
  const coin = coinOf(ref);
  if (!coin) return ref.yahoo ?? null;
  const pair = ref.yahoo && /-USD$/i.test(ref.yahoo) ? ref.yahoo : `${coin.symbol.toUpperCase()}-USD`;
  try {
    const y = await yahooBars(pair, '5d', '1d');
    const last = y?.bars[y.bars.length - 1]?.v ?? null;
    return last != null && coin.price != null && Math.abs(last / coin.price - 1) < 0.05 ? pair : null;
  } catch {
    return null;
  }
}

/** Ranges for daily comparisons. */
export type DailyRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';
export const DAILY_RANGES: DailyRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y'];

const YAHOO_DAILY: Record<DailyRange, [string, string]> = {
  '1M': ['1mo', '1d'],
  '3M': ['3mo', '1d'],
  '6M': ['6mo', '1d'],
  YTD: ['ytd', '1d'],
  '1Y': ['1y', '1d'],
  '5Y': ['5y', '1wk'],
};

/** When a range starts, for trimming a longer series. */
export function rangeStart(range: DailyRange | string, now = Date.now()): number {
  const d = new Date(now);
  switch (range) {
    case '1M':
      return now - 30 * 86_400_000;
    case '3M':
      return now - 91 * 86_400_000;
    case '6M':
      return now - 182 * 86_400_000;
    case 'YTD':
      return Date.UTC(d.getUTCFullYear(), 0, 1);
    case '1Y':
      return now - 365 * 86_400_000;
    case '5Y':
      return now - 5 * 365.25 * 86_400_000;
    default:
      return 0;
  }
}

/**
 * Daily closes (weekly for 5Y) of any asset over a range. Stocks, funds, indexes and futures come
 * from Yahoo; a coin from its Yahoo pair when that is the same coin, otherwise from CoinGecko
 * (which only goes back a year).
 */
export async function dailyHistory(ref: AssetRef, range: DailyRange): Promise<{ bars: Bar[]; source: string } | null> {
  const [yr, yi] = YAHOO_DAILY[range];
  const coin = coinOf(ref);
  const pair = coin ? await verifiedPair(ref) : (ref.yahoo ?? null);
  if (pair) {
    try {
      const y = await yahooBars(pair, yr, yi);
      if (y && y.bars.length >= 2) return { bars: y.bars, source: 'Yahoo Finance' };
    } catch {
      /* try CoinGecko below for a coin */
    }
  }
  const cgId = coin?.id ?? ref.cg;
  if (cgId && range !== '5Y') {
    const days = Math.max(2, Math.min(365, Math.ceil((Date.now() - rangeStart(range)) / 86_400_000)));
    try {
      const pts = await coinGeckoBars(cgId, days);
      if (pts && pts.length >= 2) return { bars: dailyLast(pts), source: 'CoinGecko' };
    } catch {
      /* nothing else to try */
    }
  }
  return null;
}
