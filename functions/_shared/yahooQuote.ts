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
async function fetchNasdaqMarketCap(symbol: string): Promise<number | null> {
  const sym = nasdaqSymbol(symbol);
  for (const assetclass of ['etf', 'stocks'] as const) {
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

async function fetchMarketCap(symbol: string): Promise<number | null> {
  const hit = mcapCache.get(symbol);
  if (hit) return hit.v;
  if (mcapNegCache.get(symbol)) {
    const stale = mcapCache.getStale(symbol);
    return stale?.v ?? null;
  }
  const stale = mcapCache.getStale(symbol);

  // One Yahoo attempt + one Nasdaq attempt max (CF subrequest budget is tight).
  let raw = await fetchTrailingMarketCap(symbol);
  if (raw == null) {
    raw = await fetchNasdaqMarketCap(symbol);
  }
  if (raw != null) {
    mcapCache.set(symbol, { v: raw });
    return raw;
  }
  if (stale) return stale.v;
  mcapNegCache.set(symbol, true);
  return null;
}

/** Fetch quotes for many symbols; attaches marketCap for equities/ETFs. */
export async function fetchYahooQuotes(symbols: string[]): Promise<YahooQuote[]> {
  if (!symbols.length) return [];
  // Hard cap — prevents "Too many subrequests" wiping late tickers (BND/VNQ/CPER/COPX).
  if (symbols.length > 20) {
    symbols = symbols.slice(0, 20);
  }

  // Keep total subrequests under CF per-invocation limit (~50 on many plans).
  // Client sends chunks of ~15; budget ≈ 15 charts + 15 Yahoo mcap + ~15 Nasdaq ≈ 45.
  const quotes = await mapPool(symbols, 6, (sym) => fetchChartSymbol(sym));

  const mcapSyms = [...new Set(symbols.filter(wantsMarketCap))];
  const mcaps = await mapPool(mcapSyms, 3, async (sym) => {
    const v = await fetchMarketCap(sym);
    return [sym, v] as const;
  });
  const mcapMap = new Map(mcaps);

  return quotes.map((q, i) => {
    const requested = symbols[i]!;
    const mcap =
      mcapMap.get(requested) ??
      mcapMap.get(q.symbol) ??
      null;
    return {
      ...q,
      marketCap: mcap,
    };
  });
}
