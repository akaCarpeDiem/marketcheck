/**
 * Yahoo Finance quotes — chart for price/%, fundamentals timeseries for marketCap.
 * (v7 quote + crumb is blocked from many Cloudflare egress IPs.)
 * ETF trailingMarketCap is usually empty on Yahoo timeseries — fall back to Nasdaq
 * summary MarketCap / AUM so SPY, QQQ, etc. sort and display correctly.
 */

import { makeCache, mapPool, sleep } from './cache';

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_TS =
  'https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries';
const NASDAQ_SUMMARY = 'https://api.nasdaq.com/api/quote';

export type YahooQuote = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  currency?: string;
  shortName?: string;
  ok: boolean;
  error?: string;
};

const quoteCache = makeCache<YahooQuote>(25_000);
/** Successful market caps — cache ~30 min. */
const mcapCache = makeCache<{ v: number }>(1_800_000);
/** Failed mcap lookups — short TTL so a rate-limit burst does not blank the column for half an hour. */
const mcapNegCache = makeCache<true>(45_000);

/** Equities/ETFs only — skip indexes (^), futures (=), crypto pairs (-USD). */
function wantsMarketCap(symbol: string): boolean {
  if (!symbol) return false;
  if (symbol.startsWith('^')) return false;
  if (symbol.includes('=')) return false;
  if (/-USD$/i.test(symbol)) return false;
  return true;
}

/** Nasdaq uses BRK.B; Yahoo uses BRK-B. */
function nasdaqSymbol(symbol: string): string {
  return symbol.replace(/-/g, '.');
}

function parseNasdaqMoney(raw: string | null | undefined): number | null {
  if (!raw || raw === 'N/A') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchChartSymbolOnce(symbol: string): Promise<YahooQuote> {
  const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) {
    return {
      symbol,
      price: null,
      changePercent: null,
      marketCap: null,
      ok: false,
      error: `HTTP ${res.status}`,
    };
  }
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          previousClose?: number;
          chartPreviousClose?: number;
          regularMarketChangePercent?: number;
          currency?: string;
          shortName?: string;
          symbol?: string;
        };
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const meta = result?.meta;
  if (meta?.regularMarketPrice == null) {
    return {
      symbol,
      price: null,
      changePercent: null,
      marketCap: null,
      ok: false,
      error: 'No price',
    };
  }
  const price = meta.regularMarketPrice;
  let changePercent: number | null =
    meta.regularMarketChangePercent != null &&
    Number.isFinite(meta.regularMarketChangePercent)
      ? meta.regularMarketChangePercent
      : null;
  if (changePercent == null) {
    const closes = result?.indicators?.quote?.[0]?.close?.filter(
      (c): c is number => c != null,
    );
    const prev =
      meta.previousClose ??
      meta.chartPreviousClose ??
      (closes && closes.length >= 2 ? closes[closes.length - 2] : undefined);
    if (prev != null && prev !== 0) {
      changePercent = ((price - prev) / prev) * 100;
    }
  }
  return {
    symbol: meta.symbol ?? symbol,
    price,
    changePercent,
    marketCap: null,
    currency: meta.currency,
    shortName: meta.shortName,
    ok: true,
  };
}

async function fetchChartSymbol(symbol: string): Promise<YahooQuote> {
  const cached = quoteCache.get(symbol);
  if (cached) return { ...cached };
  const stale = quoteCache.getStale(symbol);

  let last: YahooQuote | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await fetchChartSymbolOnce(symbol);
      if (last.ok && last.price != null) {
        quoteCache.set(symbol, last);
        return { ...last };
      }
      // Yahoo sometimes returns transient 404/429 under batch concurrency.
      const retryable =
        last.error === 'HTTP 404' ||
        last.error === 'HTTP 429' ||
        last.error === 'HTTP 503' ||
        last.error === 'HTTP 502' ||
        last.error === 'No price';
      if (!retryable || attempt === 1) break;
      await sleep(120 + attempt * 180);
    } catch (e) {
      last = {
        symbol,
        price: null,
        changePercent: null,
        marketCap: null,
        ok: false,
        error: e instanceof Error ? e.message : 'fetch failed',
      };
      if (attempt < 2) await sleep(120 + attempt * 180);
    }
  }

  if (stale && stale.ok && stale.price != null) {
    return { ...stale };
  }
  return (
    last ?? {
      symbol,
      price: null,
      changePercent: null,
      marketCap: null,
      ok: false,
      error: 'fetch failed',
    }
  );
}

async function fetchTrailingMarketCap(symbol: string): Promise<number | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const period1 = now - 120 * 86400;
    const url =
      `${YAHOO_TS}/${encodeURIComponent(symbol)}` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&type=trailingMarketCap&period1=${period1}&period2=${now}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      timeseries?: {
        result?: Array<{
          trailingMarketCap?: Array<{
            reportedValue?: { raw?: number };
          }>;
        }>;
      };
    };
    const series = json.timeseries?.result?.[0]?.trailingMarketCap ?? [];
    for (let i = series.length - 1; i >= 0; i--) {
      const v = series[i]?.reportedValue?.raw;
      if (v != null && Number.isFinite(v) && v > 0) return v;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Nasdaq public summary — MarketCap for stocks/ETFs; AUM (,000) as ETF fallback.
 * Used when Yahoo trailingMarketCap is empty (typical for ETFs).
 * Origin/Referer required — bare requests are often blocked from CF egress.
 */
async function fetchNasdaqMarketCap(
  symbol: string,
  only?: 'etf' | 'stocks',
): Promise<number | null> {
  const sym = nasdaqSymbol(symbol);
  const classes = only ? [only] : (['etf', 'stocks'] as const);
  for (const assetclass of classes) {
    try {
      const url = `${NASDAQ_SUMMARY}/${encodeURIComponent(sym)}/summary?assetclass=${assetclass}`;
      const res = await fetch(url, {
        headers: {
          ...UA,
          Accept: 'application/json',
          Origin: 'https://www.nasdaq.com',
          Referer: `https://www.nasdaq.com/market-activity/${assetclass === 'etf' ? 'etf' : 'stocks'}/${encodeURIComponent(sym)}`,
        },
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: {
          summaryData?: {
            MarketCap?: { value?: string };
            AUM?: { value?: string };
          };
        };
      };
      const sd = json.data?.summaryData;
      if (!sd) continue;
      const mcap = parseNasdaqMoney(sd.MarketCap?.value);
      // AUM is in thousands — prefer for ETFs (Nasdaq MarketCap is often incomplete, e.g. VOO).
      const aumThousands = parseNasdaqMoney(sd.AUM?.value);
      const aum = aumThousands != null ? aumThousands * 1000 : null;
      if (assetclass === 'etf') {
        if (aum != null) return aum;
        if (mcap != null) return mcap;
      } else {
        if (mcap != null) return mcap;
        if (aum != null) return aum;
      }
    } catch {
      /* try next asset class */
    }
  }
  return null;
}

const MCAP_TTL_SEC = 30 * 60;
const SPARK = 'https://query1.finance.yahoo.com/v7/finance/spark';

export type McapKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
};

export type YahooFetchOpts = {
  /** quotes: prices + fast Yahoo mcaps (no Nasdaq). mcaps: fill caps only. */
  phase?: 'quotes' | 'mcaps';
  /** mcaps phase: which Nasdaq asset class to hit when Yahoo trailing is empty. */
  asset?: 'etf' | 'equity';
  kv?: McapKv | null;
  waitUntil?: (promise: Promise<unknown>) => void;
};

type SparkRow = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  currency?: string;
  shortName?: string;
  closes: number[];
  ok: boolean;
};

function edgeCaches(): Cache | null {
  try {
    const store = caches as CacheStorage & { default?: Cache };
    return store.default ?? null;
  } catch {
    return null;
  }
}

function mcapEdgeRequest(symbol: string): Request {
  return new Request(`https://marketcheck.internal/yahoo-mcap/v1/${encodeURIComponent(symbol)}`);
}

function rememberMcap(
  symbol: string,
  value: number,
  kv?: McapKv | null,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  mcapCache.set(symbol, { v: value });
  const tasks: Promise<unknown>[] = [];
  const edge = edgeCaches();
  if (edge) {
    const res = new Response(String(value), {
      headers: { 'Cache-Control': `public, max-age=${MCAP_TTL_SEC}` },
    });
    tasks.push(edge.put(mcapEdgeRequest(symbol), res).catch(() => undefined));
  }
  if (kv) {
    tasks.push(
      kv
        .put(`yahoo-mcap:v1:${symbol}`, String(value), { expirationTtl: MCAP_TTL_SEC })
        .catch(() => undefined),
    );
  }
  if (!tasks.length) return;
  const all = Promise.all(tasks);
  if (waitUntil) waitUntil(all);
  else void all;
}

async function readStoredMcap(symbol: string, kv?: McapKv | null): Promise<number | null> {
  const hit = mcapCache.get(symbol);
  if (hit) return hit.v;
  const edge = edgeCaches();
  if (edge) {
    try {
      const match = await edge.match(mcapEdgeRequest(symbol));
      if (match) {
        const n = Number(await match.text());
        if (Number.isFinite(n) && n > 0) {
          mcapCache.set(symbol, { v: n });
          return n;
        }
      }
    } catch {
      /* miss */
    }
  }
  if (kv) {
    try {
      const raw = await kv.get(`yahoo-mcap:v1:${symbol}`);
      const n = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) {
        mcapCache.set(symbol, { v: n });
        return n;
      }
    } catch {
      /* miss */
    }
  }
  return null;
}

function quoteFromSpark(requested: string, row: SparkRow): YahooQuote {
  return {
    symbol: row.symbol || requested,
    price: row.price,
    changePercent: row.changePercent,
    marketCap: null,
    currency: row.currency,
    shortName: row.shortName,
    ok: row.ok && row.price != null,
    ...(row.ok ? {} : { error: 'No price' }),
  };
}

/** One Yahoo call for up to 20 symbols. Spark rejects larger batches. */
async function fetchSparkBatch(
  symbols: string[],
  range: string,
  interval: string,
): Promise<Map<string, SparkRow>> {
  const out = new Map<string, SparkRow>();
  if (!symbols.length) return out;
  const qs = symbols.map((s) => encodeURIComponent(s)).join(',');
  const url = `${SPARK}?symbols=${qs}&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: UA });
  } catch {
    return out;
  }
  if (!res.ok) return out;
  let json: {
    spark?: {
      result?: Array<{
        symbol?: string;
        response?: Array<{
          meta?: {
            regularMarketPrice?: number;
            regularMarketChangePercent?: number;
            chartPreviousClose?: number;
            previousClose?: number;
            currency?: string;
            shortName?: string;
            symbol?: string;
          };
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      }>;
    };
  };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return out;
  }
  for (const item of json.spark?.result ?? []) {
    const block = item.response?.[0];
    const meta = block?.meta;
    const symbol = meta?.symbol || item.symbol;
    if (!symbol || !meta) continue;
    const price = meta.regularMarketPrice;
    let changePercent: number | null =
      meta.regularMarketChangePercent != null && Number.isFinite(meta.regularMarketChangePercent)
        ? meta.regularMarketChangePercent
        : null;
    if (changePercent == null && price != null) {
      const prev = meta.previousClose ?? meta.chartPreviousClose;
      if (prev != null && prev !== 0) changePercent = ((price - prev) / prev) * 100;
    }
    const rawCloses = block?.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((c): c is number => c != null && Number.isFinite(c));
    const row: SparkRow = {
      symbol,
      price: price != null && Number.isFinite(price) ? price : null,
      changePercent,
      currency: meta.currency,
      shortName: meta.shortName,
      closes,
      ok: price != null && Number.isFinite(price),
    };
    out.set(symbol, row);
    out.set(symbol.toUpperCase(), row);
  }
  return out;
}

export function downsampleCloses(closes: number[], n = 72): number[] {
  if (closes.length <= n) return closes;
  const out: number[] = [];
  const step = (closes.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(closes[Math.round(i * step)]!);
  return out;
}

/** 1y sparkline closes for up to 20 symbols (one Yahoo subrequest). */
export async function fetchYahooSparklines(
  symbols: string[],
): Promise<Array<{ symbol: string; closes: number[]; ok: boolean }>> {
  const list = symbols.slice(0, 20);
  const batch = await fetchSparkBatch(list, '1y', '1d');
  const missing: string[] = [];
  const rows = list.map((sym) => {
    const row = batch.get(sym) ?? batch.get(sym.toUpperCase());
    const closes = row?.closes?.length ? downsampleCloses(row.closes, 72) : [];
    if (closes.length <= 1) missing.push(sym);
    return { symbol: sym, closes, ok: closes.length > 1 };
  });
  if (missing.length) {
    const fallback = await mapPool(missing, 4, async (sym) => {
      const url = `${YAHOO_CHART}/${encodeURIComponent(sym)}?interval=1d&range=1y`;
      try {
        const res = await fetch(url, { headers: UA });
        if (!res.ok) return [sym, [] as number[]] as const;
        const json = (await res.json()) as {
          chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> };
        };
        const raw = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
        const closes = raw.filter((c): c is number => c != null && Number.isFinite(c));
        return [sym, downsampleCloses(closes, 72)] as const;
      } catch {
        return [sym, [] as number[]] as const;
      }
    });
    const fb = new Map(fallback);
    return rows.map((row) => {
      if (row.ok) return row;
      const closes = fb.get(row.symbol) ?? [];
      return { symbol: row.symbol, closes, ok: closes.length > 1 };
    });
  }
  return rows;
}

async function trailingMcap(symbol: string, opts?: YahooFetchOpts): Promise<number | null> {
  const stored = await readStoredMcap(symbol, opts?.kv);
  if (stored != null) return stored;
  if (mcapNegCache.get(symbol)) {
    const stale = mcapCache.getStale(symbol);
    return stale?.v ?? null;
  }
  const raw = await fetchTrailingMarketCap(symbol);
  if (raw != null) {
    rememberMcap(symbol, raw, opts?.kv, opts?.waitUntil);
    return raw;
  }
  return mcapCache.getStale(symbol)?.v ?? null;
}

async function nasdaqMcap(
  symbol: string,
  asset: 'etf' | 'equity',
  opts?: YahooFetchOpts,
): Promise<number | null> {
  const stored = await readStoredMcap(symbol, opts?.kv);
  if (stored != null) return stored;
  if (mcapNegCache.get(symbol)) {
    return mcapCache.getStale(symbol)?.v ?? null;
  }
  const stale = mcapCache.getStale(symbol);
  // Equities usually have Yahoo trailingMarketCap (~100ms). ETFs do not — Nasdaq only.
  let raw: number | null = null;
  if (asset === 'equity') {
    raw = await fetchTrailingMarketCap(symbol);
  }
  if (raw == null) {
    raw = await fetchNasdaqMarketCap(symbol, asset === 'etf' ? 'etf' : 'stocks');
  }
  if (raw != null) {
    rememberMcap(symbol, raw, opts?.kv, opts?.waitUntil);
    return raw;
  }
  if (stale) return stale.v;
  mcapNegCache.set(symbol, true);
  return null;
}

function emptyQuote(symbol: string, error: string): YahooQuote {
  return {
    symbol,
    price: null,
    changePercent: null,
    marketCap: null,
    ok: false,
    error,
  };
}

/**
 * Prices via one Yahoo spark call per chunk (not per symbol).
 * Market caps on this path are Yahoo trailing + edge/KV hits only.
 * Nasdaq (1–3s each, and empty for the wrong asset class) stays on phase=mcaps
 * so the first paint is not stuck behind ETF AUM lookups.
 */
export async function fetchYahooQuotes(
  symbols: string[],
  opts?: YahooFetchOpts,
): Promise<YahooQuote[]> {
  if (!symbols.length) return [];
  // Hard cap — Yahoo spark rejects batches above 20, and CF subrequest budget is ~50.
  if (symbols.length > 20) symbols = symbols.slice(0, 20);

  if (opts?.phase === 'mcaps') {
    const asset = opts.asset === 'etf' ? 'etf' : 'equity';
    const mcapSyms = symbols.filter(wantsMarketCap);
    const pairs = await mapPool(mcapSyms, asset === 'etf' ? 10 : 8, async (sym) => {
      const v = await nasdaqMcap(sym, asset, opts);
      return [sym, v] as const;
    });
    const mcapMap = new Map(pairs);
    return symbols.map((sym) => {
      const mcap = wantsMarketCap(sym) ? (mcapMap.get(sym) ?? null) : null;
      return {
        symbol: sym,
        price: null,
        changePercent: null,
        marketCap: mcap,
        ok: mcap != null,
      };
    });
  }

  const mcapSyms = [...new Set(symbols.filter(wantsMarketCap))];
  const [spark, mcaps] = await Promise.all([
    fetchSparkBatch(symbols, '5d', '1d'),
    mapPool(mcapSyms, 8, async (sym) => {
      const v = await trailingMcap(sym, opts);
      return [sym, v] as const;
    }),
  ]);
  const mcapMap = new Map(mcaps);

  const missing = symbols.filter((sym) => {
    const row = spark.get(sym) ?? spark.get(sym.toUpperCase());
    return !row?.ok;
  });
  if (missing.length) {
    await mapPool(missing, 6, (sym) => fetchChartSymbol(sym));
  }

  return symbols.map((sym) => {
    const sparked = spark.get(sym) ?? spark.get(sym.toUpperCase());
    let quote: YahooQuote;
    if (sparked?.ok && sparked.price != null) {
      quote = quoteFromSpark(sym, sparked);
      quoteCache.set(sym, quote);
    } else {
      const cached = quoteCache.get(sym) ?? quoteCache.getStale(sym);
      quote = cached ? { ...cached } : emptyQuote(sym, 'No price');
    }
    const mcap = wantsMarketCap(sym)
      ? (mcapMap.get(sym) ?? mcapMap.get(quote.symbol) ?? null)
      : null;
    return { ...quote, symbol: quote.symbol || sym, marketCap: mcap };
  });
}
