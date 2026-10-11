import { defineConfig, type Plugin } from 'vite';
import { getTrenches, getCryptoMovers, getTrendingTokens } from './functions/_shared/coingecko';
import { getEquityMovers } from './functions/_shared/yahooEquity';
import {
  CRYPTO_TFS,
  type BubbleCategory,
  type Timeframe,
} from './functions/_shared/universes';
import { getHeadlines, ALL_HEADLINE_CATEGORIES, type HeadlineCategory } from './functions/_shared/rssHeadlines';
import { fetchYahooQuotes, fetchYahooSparklines } from './functions/_shared/yahooQuote';

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const CACHE_TTL_MS = 20_000;
const CHART_CACHE_TTL_MS = 60_000;

type Quote = {
  symbol: string;
  requested?: string;
  price: number | null;
  changePercent: number | null;
  currency?: string;
  shortName?: string;
  ok: boolean;
  error?: string;
};

const cache = new Map<string, { at: number; data: Quote }>();
const chartCache = new Map<
  string,
  {
    at: number;
    data: {
      symbol: string;
      closes: number[];
      timestamps: number[];
      ok: boolean;
      range: string;
      interval: string;
    };
  }
>();

async function fetchYahooSymbol(symbol: string): Promise<Quote> {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.data, requested: symbol };
  }

  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketCheck/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return { symbol, requested: symbol, price: null, changePercent: null, ok: false, error: `HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            previousClose?: number;
            chartPreviousClose?: number;
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
      return { symbol, requested: symbol, price: null, changePercent: null, ok: false, error: 'No price' };
    }
    const price = meta.regularMarketPrice;
    const closes = result?.indicators?.quote?.[0]?.close?.filter((c): c is number => c != null);
    const prev =
      meta.previousClose ??
      meta.chartPreviousClose ??
      (closes && closes.length >= 2 ? closes[closes.length - 2] : undefined);
    let changePercent: number | null = null;
    if (prev != null && prev !== 0) {
      changePercent = ((price - prev) / prev) * 100;
    }
    const q: Quote = {
      symbol: meta.symbol ?? symbol,
      requested: symbol,
      price,
      changePercent,
      currency: meta.currency,
      shortName: meta.shortName,
      ok: true,
    };
    cache.set(symbol, { at: Date.now(), data: q });
    return q;
  } catch (e) {
    return {
      symbol,
      requested: symbol,
      price: null,
      changePercent: null,
      ok: false,
      error: e instanceof Error ? e.message : 'fetch failed',
    };
  }
}

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string,
): Promise<{
  symbol: string;
  closes: number[];
  timestamps: number[];
  ok: boolean;
  range: string;
  interval: string;
}> {
  const key = `${symbol}|${range}|${interval}`;
  const cached = chartCache.get(key);
  if (cached && Date.now() - cached.at < CHART_CACHE_TTL_MS) {
    return cached.data;
  }
  try {
    const url = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketCheck/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return { symbol, closes: [], timestamps: [], ok: false, range, interval };
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const timestampsRaw = result?.timestamp ?? [];
    const raw = result?.indicators?.quote?.[0]?.close ?? [];
    const closes: number[] = [];
    const timestamps: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c != null && Number.isFinite(c)) {
        closes.push(c);
        if (timestampsRaw[i] != null) timestamps.push(timestampsRaw[i]!);
      }
    }
    const data = { symbol, closes, timestamps, ok: closes.length > 1, range, interval };
    chartCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return { symbol, closes: [], timestamps: [], ok: false, range, interval };
  }
}

const VALID_CAT = new Set(['cryptos', 'stocks', 'etfs']);
const CRYPTO_TF = new Set<string>(CRYPTO_TFS);
const VALID_TF = new Set(['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y']);

function yahooProxyPlugin(): Plugin {
  return {
    name: 'yahoo-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';

        if (url.startsWith('/api/trenches')) {
          try {
            const u = new URL(url, 'http://localhost');
            const limit = Math.min(50, Math.max(1, Number(u.searchParams.get('limit') ?? '10') || 10));
            const data = await getTrenches(limit);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=45');
            res.end(
              JSON.stringify({
                items: data.items,
                limit,
                fetchedAt: new Date().toISOString(),
                note: data.note,
                limitation: data.limitation,
                source: 'coingecko',
              }),
            );
          } catch (e) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                items: [],
                error: e instanceof Error ? e.message : 'error',
                fetchedAt: new Date().toISOString(),
              }),
            );
          }
          return;
        }

        if (url.startsWith('/api/trending')) {
          try {
            const u = new URL(url, 'http://localhost');
            const requestedTf = u.searchParams.get('tf') ?? '24h';
            const validTf = new Set([
              '1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y',
            ]);
            const tf = validTf.has(requestedTf) ? requestedTf : '24h';
            const data = await getTrendingTokens(tf as any);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=60');
            res.end(
              JSON.stringify({
                tf,
                pumps: data.pumps,
                dumps: data.dumps,
                items: data.items,
                note: data.note,
                rateLimited: data.rateLimited,
                stale: data.stale,
                source: data.source,
                supportedTfs: data.supportedTfs,
                fetchedAt: new Date().toISOString(),
              }),
            );
          } catch (e) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                pumps: [],
                dumps: [],
                items: [],
                error: e instanceof Error ? e.message : 'error',
                source: 'binance|coingecko',
                fetchedAt: new Date().toISOString(),
              }),
            );
          }
          return;
        }

        if (url.startsWith('/api/headlines')) {
          try {
            const u = new URL(url, 'http://localhost');
            const category = (u.searchParams.get('category') ?? 'tradfi') as HeadlineCategory;
            const valid = (ALL_HEADLINE_CATEGORIES as string[]).includes(category);
            if (!valid) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: `invalid category; use ${ALL_HEADLINE_CATEGORIES.join('|')}`,
                }),
              );
              return;
            }
            const data = await getHeadlines(category);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', data.stale ? 'public, max-age=60' : 'public, max-age=180');
            res.end(
              JSON.stringify({
                category: data.category,
                items: data.items,
                feedsUsed: data.feedsUsed,
                feedsFailed: data.feedsFailed,
                thin: data.thin,
                note: data.note,
                stale: data.stale,
                source: 'public-rss',
                fetchedAt: data.fetchedAt,
              }),
            );
          } catch (e) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                items: [],
                error: e instanceof Error ? e.message : 'error',
                source: 'public-rss',
                fetchedAt: new Date().toISOString(),
              }),
            );
          }
          return;
        }

        if (url.startsWith('/api/bubbles')) {
          try {
            const u = new URL(url, 'http://localhost');
            const category = (u.searchParams.get('category') ?? 'stocks') as BubbleCategory;
            const tf = (u.searchParams.get('tf') ?? '24h') as Timeframe;
            const limit = Math.min(50, Math.max(1, Number(u.searchParams.get('limit') ?? '50') || 50));
            if (!VALID_CAT.has(category) || !VALID_TF.has(tf)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'invalid category or tf' }));
              return;
            }
            if (category === 'cryptos' && !CRYPTO_TF.has(tf)) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  category,
                  tf,
                  limit,
                  items: [],
                  effectiveTf: tf,
                  tfLabel: tf,
                  rateLimited: false,
                  stale: false,
                  note: null,
                  limitation: `Cryptos only support ${CRYPTO_TFS.join(', ')} (CoinGecko free). ${tf} is not available and is not approximated.`,
                  fetchedAt: new Date().toISOString(),
                }),
              );
              return;
            }
            let payload: {
              items: unknown[];
              effectiveTf: string;
              tfLabel: string;
              note: string | null;
              limitation: string;
              rateLimited?: boolean;
              stale?: boolean;
            };
            if (category === 'cryptos') {
              const m = await getCryptoMovers(tf, limit, false);
              payload = {
                items: m.items,
                effectiveTf: m.effectiveTf,
                tfLabel: m.tfLabel,
                note: m.note,
                limitation: m.limitation,
                rateLimited: m.rateLimited,
                stale: m.stale,
              };
            } else {
              const m = await getEquityMovers(category, tf, limit);
              payload = {
                items: m.items,
                effectiveTf: m.effectiveTf,
                tfLabel: m.tfLabel,
                note: m.note,
                limitation: m.limitation,
                rateLimited: false,
                stale: false,
              };
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader(
              'Cache-Control',
              category === 'cryptos' ? 'public, max-age=120' : 'public, max-age=30',
            );
            res.end(
              JSON.stringify({
                category,
                tf,
                limit,
                ...payload,
                fetchedAt: new Date().toISOString(),
              }),
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'error';
            const rateLimited = msg.includes('429');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                items: [],
                rateLimited,
                error: msg,
                limitation: rateLimited
                  ? 'Upstream rate-limited (HTTP 429); no cached data.'
                  : 'Upstream failed.',
                fetchedAt: new Date().toISOString(),
              }),
            );
          }
          return;
        }

        if (url.startsWith('/api/chart')) {
          try {
            const u = new URL(url, 'http://localhost');
            const symbol = (u.searchParams.get('symbol') ?? '').trim();
            const range = (u.searchParams.get('range') ?? '1y').trim();
            const interval = (u.searchParams.get('interval') ?? '1d').trim();
            if (!symbol) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'symbol required' }));
              return;
            }
            const data = await fetchYahooChart(symbol, range, interval);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=60');
            res.end(JSON.stringify({ ...data, fetchedAt: new Date().toISOString() }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }));
          }
          return;
        }

        if (url.startsWith('/api/sparklines')) {
          try {
            const u = new URL(url, 'http://localhost');
            const symbols = (u.searchParams.get('symbols') ?? '')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 20);
            if (!symbols.length) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'symbols required' }));
              return;
            }
            const series = await fetchYahooSparklines(symbols);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=120');
            res.end(JSON.stringify({ series, fetchedAt: new Date().toISOString() }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }));
          }
          return;
        }

        if (!url.startsWith('/api/markets')) return next();
        try {
          const u = new URL(url, 'http://localhost');
          const phase = u.searchParams.get('phase') === 'mcaps' ? 'mcaps' : 'quotes';
          const asset = u.searchParams.get('asset') === 'etf' ? 'etf' : 'equity';
          const symbolsParam = u.searchParams.get('symbols') ?? '';
          const symbols = symbolsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 20);
          if (!symbols.length) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'symbols required' }));
            return;
          }
          const quotesRaw = await fetchYahooQuotes(symbols, { phase, asset });
          const quotes = quotesRaw.map((q, i) => ({
            ...q,
            requested: symbols[i],
            symbol: q.symbol || symbols[i],
          }));
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=15');
          res.end(JSON.stringify({ quotes, fetchedAt: new Date().toISOString() }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'error' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [yahooProxyPlugin()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
