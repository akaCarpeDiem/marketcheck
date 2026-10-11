/**
 * Yahoo Finance access for Pages Functions. No API key.
 *
 * - spark: one request for up to 20 symbols (prices + a close series)
 * - chart: one symbol, any range, with quote details
 * - fundamentals timeseries: market cap for one stock
 * - Nasdaq summary: assets under management for one ETF
 *
 * How the day change is worked out (this was wrong in several places before):
 * Yahoo's `chartPreviousClose` is the close before the START of the requested
 * range, so on a 5-day range it gives a 5-day change. It is only used here on a
 * 1-day range. Otherwise the day change comes from Yahoo's own percent field,
 * then `previousClose`, then the daily bars themselves.
 */

import { mapPool, sleep } from './cache';

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const SPARK = 'https://query1.finance.yahoo.com/v7/finance/spark';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TIMESERIES =
  'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries';
const NASDAQ = 'https://api.nasdaq.com/api/quote';

/** Spark rejects more than 20 symbols per request. */
export const SPARK_MAX = 20;

type RawMeta = {
  symbol?: string;
  currency?: string;
  shortName?: string;
  longName?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  instrumentType?: string;
  exchangeTimezoneName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  regularMarketChangePercent?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  previousClose?: number;
  chartPreviousClose?: number;
};

type RawBlock = {
  meta?: RawMeta;
  timestamp?: Array<number | null>;
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      volume?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
    }>;
  };
};

export type Series = {
  /** Symbol as Yahoo reports it. */
  symbol: string;
  name?: string;
  currency?: string;
  exchange?: string;
  type?: string;
  price: number | null;
  /** Previous session close used for the day change. */
  prevClose: number | null;
  /** Change since the previous close, percent. */
  changePercent: number | null;
  /** Unix seconds of the last trade. */
  time: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  volume?: number | null;
  high52?: number | null;
  low52?: number | null;
  /** Bar timestamps (unix seconds) and closes, same length, no gaps. */
  t: number[];
  c: number[];
  /** Bar volumes aligned with `t` when Yahoo sent them. */
  v?: number[];
  ok: boolean;
};

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Previous close taken from daily bars. The last daily bar is the session of
 * the last trade, so the previous close is the bar before it. The one exception
 * is a new session whose bar has not been published yet (a long gap between
 * the last bar and the last trade): then the last bar is the previous close.
 */
function prevCloseFromDailyBars(t: number[], c: number[], lastTradeSec: number | null): number | null {
  const n = c.length;
  if (n < 2) return null;
  const lastBar = t[n - 1]!;
  const barIsCurrent = lastTradeSec == null || lastTradeSec - lastBar < 30 * 3600;
  return barIsCurrent ? c[n - 2]! : c[n - 1]!;
}

/** True when `value` is within 12% of either of the last two daily closes. */
function nearRecentCloses(value: number, c: number[]): boolean {
  const n = c.length;
  if (n < 2) return true;
  const near = (ref: number) => ref > 0 && Math.abs(value / ref - 1) <= 0.12;
  return near(c[n - 1]!) || near(c[n - 2]!);
}

function toSeries(requested: string, block: RawBlock | undefined, range: string, interval: string): Series {
  const meta = block?.meta ?? {};
  const rawT = block?.timestamp ?? [];
  const q = block?.indicators?.quote?.[0];
  const rawC = q?.close ?? [];
  const rawV = q?.volume ?? [];
  const t: number[] = [];
  const c: number[] = [];
  const v: number[] = [];
  const hasT = rawT.length === rawC.length && rawT.length > 0;
  for (let i = 0; i < rawC.length; i++) {
    const close = rawC[i];
    if (!fin(close)) continue;
    const ts = hasT ? rawT[i] : null;
    if (hasT && !fin(ts)) continue;
    c.push(close);
    t.push(fin(ts) ? ts : 0);
    const vol = rawV[i];
    v.push(fin(vol) ? vol : 0);
  }

  const price = fin(meta.regularMarketPrice) ? meta.regularMarketPrice : null;
  const time = fin(meta.regularMarketTime) ? meta.regularMarketTime : null;
  const daily = interval === '1d';

  let prevClose: number | null = null;
  const barPrev = daily && hasT ? prevCloseFromDailyBars(t, c, time) : null;
  if (
    fin(meta.previousClose) &&
    meta.previousClose > 0 &&
    // Guard: a value far from both recent closes is not yesterday's close.
    (!daily || !hasT || nearRecentCloses(meta.previousClose, c))
  ) {
    prevClose = meta.previousClose;
  } else if (barPrev != null) {
    prevClose = barPrev;
  } else if (range === '1d' && fin(meta.chartPreviousClose) && meta.chartPreviousClose > 0) {
    prevClose = meta.chartPreviousClose;
  }

  let changePercent: number | null = null;
  if (fin(meta.regularMarketChangePercent)) {
    changePercent = meta.regularMarketChangePercent;
  } else if (price != null && prevClose != null && prevClose !== 0) {
    changePercent = ((price - prevClose) / prevClose) * 100;
  }

  return {
    symbol: meta.symbol || requested,
    name: meta.longName || meta.shortName || undefined,
    currency: meta.currency,
    exchange: meta.fullExchangeName || meta.exchangeName,
    type: meta.instrumentType,
    price,
    prevClose,
    changePercent,
    time,
    dayHigh: fin(meta.regularMarketDayHigh) ? meta.regularMarketDayHigh : null,
    dayLow: fin(meta.regularMarketDayLow) ? meta.regularMarketDayLow : null,
    volume: fin(meta.regularMarketVolume) ? meta.regularMarketVolume : null,
    high52: fin(meta.fiftyTwoWeekHigh) ? meta.fiftyTwoWeekHigh : null,
    low52: fin(meta.fiftyTwoWeekLow) ? meta.fiftyTwoWeekLow : null,
    t: hasT ? t : [],
    c,
    v: rawV.length ? v : undefined,
    ok: price != null,
  };
}

/** One spark request. Returns a map keyed by the symbol as requested (upper-cased too). */
export async function fetchSpark(
  symbols: string[],
  range: string,
  interval: string,
): Promise<Map<string, Series>> {
  const out = new Map<string, Series>();
  const list = symbols.slice(0, SPARK_MAX);
  if (!list.length) return out;
  const url =
    `${SPARK}?symbols=${list.map((s) => encodeURIComponent(s)).join(',')}` +
    `&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  let json: {
    spark?: { result?: Array<{ symbol?: string; response?: RawBlock[] }> };
  };
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return out;
    json = (await res.json()) as typeof json;
  } catch {
    return out;
  }
  const byUpper = new Map(list.map((s) => [s.toUpperCase(), s]));
  for (const item of json.spark?.result ?? []) {
    const block = item.response?.[0];
    const reported = block?.meta?.symbol || item.symbol;
    if (!reported) continue;
    const requested = byUpper.get(reported.toUpperCase()) ?? reported;
    const series = toSeries(requested, block, range, interval);
    out.set(requested, series);
    out.set(requested.toUpperCase(), series);
  }
  return out;
}

/** Spark for any number of symbols, 20 per request, a few requests at a time. */
export async function fetchSparkAll(
  symbols: string[],
  range: string,
  interval: string,
  concurrency = 4,
): Promise<Map<string, Series>> {
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += SPARK_MAX) chunks.push(symbols.slice(i, i + SPARK_MAX));
  const parts = await mapPool(chunks, concurrency, (c) => fetchSpark(c, range, interval));
  const out = new Map<string, Series>();
  for (const part of parts) for (const [k, v] of part) out.set(k, v);
  return out;
}

/** One symbol from the chart API (also the fallback when spark has no row). */
export async function fetchChart(
  symbol: string,
  range: string,
  interval: string,
): Promise<Series | null> {
  const url = `${CHART}/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) {
        if ([404, 429, 502, 503].includes(res.status) && attempt === 0) {
          await sleep(160);
          continue;
        }
        return null;
      }
      const json = (await res.json()) as { chart?: { result?: RawBlock[] } };
      const block = json.chart?.result?.[0];
      if (!block) {
        if (attempt === 0) {
          await sleep(160);
          continue;
        }
        return null;
      }
      return toSeries(symbol, block, range, interval);
    } catch {
      if (attempt === 0) await sleep(160);
    }
  }
  return null;
}

export type Quote = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  prevClose: number | null;
  currency?: string;
  shortName?: string;
  time: number | null;
  ok: boolean;
  error?: string;
};

function toQuote(requested: string, s: Series | null | undefined): Quote {
  if (!s || !s.ok) {
    return {
      symbol: requested,
      price: null,
      changePercent: null,
      prevClose: null,
      time: null,
      ok: false,
      error: 'No price',
    };
  }
  return {
    symbol: s.symbol || requested,
    price: s.price,
    changePercent: s.changePercent,
    prevClose: s.prevClose,
    currency: s.currency,
    shortName: s.name,
    time: s.time,
    ok: true,
  };
}

/**
 * Quotes for up to 20 symbols: one spark request, then the chart API for any
 * symbol spark left out. Order matches the input.
 */
export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const list = symbols.slice(0, SPARK_MAX);
  if (!list.length) return [];
  const spark = await fetchSpark(list, '5d', '1d');
  const missing = list.filter((s) => !spark.get(s)?.ok);
  const fallback = new Map<string, Series | null>();
  if (missing.length) {
    const rows = await mapPool(missing, 6, async (s) => [s, await fetchChart(s, '5d', '1d')] as const);
    for (const [s, row] of rows) fallback.set(s, row);
  }
  return list.map((s) => toQuote(s, spark.get(s)?.ok ? spark.get(s) : fallback.get(s)));
}

/** Evenly thin a series to at most `n` points, always keeping the first and last. */
export function downsample(values: number[], n = 72): number[] {
  if (values.length <= n) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(values[Math.round(i * step)]!);
  return out;
}

/** Equities and ETFs have a market cap; indexes (^), futures (=F), FX (=X) and crypto pairs do not. */
export function wantsMarketCap(symbol: string): boolean {
  if (!symbol) return false;
  if (symbol.startsWith('^')) return false;
  if (symbol.includes('=')) return false;
  if (/-USD$/i.test(symbol)) return false;
  return true;
}

/** Latest market cap Yahoo reports for a stock, with the date it applies to. */
export async function fetchTrailingMarketCap(
  symbol: string,
): Promise<{ value: number; asOf: string | null } | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const url =
      `${TIMESERIES}/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}` +
      `&type=trailingMarketCap&period1=${now - 120 * 86_400}&period2=${now}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      timeseries?: {
        result?: Array<{
          trailingMarketCap?: Array<{ asOfDate?: string; reportedValue?: { raw?: number } } | null>;
        }>;
      };
    };
    const series = json.timeseries?.result?.[0]?.trailingMarketCap ?? [];
    for (let i = series.length - 1; i >= 0; i--) {
      const v = series[i]?.reportedValue?.raw;
      if (fin(v) && v > 0) return { value: v, asOf: series[i]?.asOfDate ?? null };
    }
    return null;
  } catch {
    return null;
  }
}

function parseMoney(raw: string | null | undefined): number | null {
  if (!raw || raw === 'N/A') return null;
  const n = Number(String(raw).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Nasdaq's public quote summary. For ETFs it gives assets under management
 * (in thousands); for stocks, market cap. Nasdaq writes BRK.B where Yahoo
 * writes BRK-B. Origin and Referer are required or the request is refused.
 */
export async function fetchNasdaqSize(
  symbol: string,
  assetClass: 'etf' | 'stocks',
): Promise<number | null> {
  const sym = symbol.replace(/-/g, '.');
  try {
    const res = await fetch(
      `${NASDAQ}/${encodeURIComponent(sym)}/summary?assetclass=${assetClass}`,
      {
        headers: {
          ...UA,
          Origin: 'https://www.nasdaq.com',
          Referer: `https://www.nasdaq.com/market-activity/${assetClass === 'etf' ? 'etf' : 'stocks'}/${encodeURIComponent(sym)}`,
        },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { summaryData?: { MarketCap?: { value?: string }; AUM?: { value?: string } } };
    };
    const sd = json.data?.summaryData;
    if (!sd) return null;
    const cap = parseMoney(sd.MarketCap?.value);
    const aumK = parseMoney(sd.AUM?.value);
    const aum = aumK != null ? aumK * 1000 : null;
    return assetClass === 'etf' ? (aum ?? cap) : (cap ?? aum);
  } catch {
    return null;
  }
}

type YahooSearchHit = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchDisp?: string;
};

/** Yahoo symbol search (company name -> ticker). */
export async function searchYahoo(q: string, count = 12): Promise<YahooSearchHit[]> {
  try {
    const url =
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
      `&quotesCount=${count}&newsCount=0&listsCount=0`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return [];
    const json = (await res.json()) as { quotes?: YahooSearchHit[] };
    return json.quotes ?? [];
  } catch {
    return [];
  }
}
