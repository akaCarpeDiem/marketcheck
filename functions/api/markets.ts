/**
 * Cloudflare Pages Function — Yahoo Finance quotes with marketCap.
 * GET /api/markets?symbols=AAPL,MSFT,^GSPC
 * GET /api/markets?symbols=BND,VNQ&phase=mcaps&asset=etf
 * No API keys required (Yahoo spark + chart fallback; Nasdaq for ETF AUM).
 */

import { fetchYahooQuotes, type McapKv } from '../_shared/yahooQuote';

type Env = { LAYOUTS?: McapKv };

function wantsMarketCap(symbol: string): boolean {
  if (!symbol) return false;
  if (symbol.startsWith('^')) return false;
  if (symbol.includes('=')) return false;
  if (/-USD$/i.test(symbol)) return false;
  return true;
}

export async function onRequestGet(context: {
  request: Request;
  env?: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const phase = url.searchParams.get('phase') === 'mcaps' ? 'mcaps' : 'quotes';
  const asset = url.searchParams.get('asset') === 'etf' ? 'etf' : 'equity';
  const symbolsParam = url.searchParams.get('symbols') ?? '';
  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (!symbols.length) {
    return new Response(JSON.stringify({ error: 'symbols query param required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cacheKey = new Request(url.toString(), { method: 'GET' });
  try {
    const edge = (caches as CacheStorage & { default?: Cache }).default;
    if (edge) {
      const hit = await edge.match(cacheKey);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set('X-Cache', 'HIT');
        return new Response(hit.body, { status: hit.status, headers });
      }
    }
  } catch {
    /* cache miss */
  }

  const quotes = await fetchYahooQuotes(symbols, {
    phase,
    asset,
    kv: context.env?.LAYOUTS ?? null,
    waitUntil: context.waitUntil,
  });
  const normalized = quotes.map((q, i) => ({
    ...q,
    requested: symbols[i],
    symbol: q.symbol || symbols[i],
  }));

  const anyFail =
    phase === 'mcaps'
      ? normalized.some((q) => wantsMarketCap(q.requested || q.symbol) && q.marketCap == null)
      : normalized.some((q) => !q.ok || q.price == null);

  const cacheControl =
    phase === 'mcaps'
      ? anyFail
        ? 'public, max-age=15, s-maxage=20'
        : 'public, max-age=120, s-maxage=300'
      : anyFail
        ? 'public, max-age=5, s-maxage=8'
        : 'public, max-age=15, s-maxage=20';

  const response = new Response(
    JSON.stringify({ quotes: normalized, fetchedAt: new Date().toISOString(), phase }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'MISS',
      },
    },
  );

  if (!anyFail && context.waitUntil) {
    try {
      const edge = (caches as CacheStorage & { default?: Cache }).default;
      if (edge) context.waitUntil(edge.put(cacheKey, response.clone()));
    } catch {
      /* ignore */
    }
  }

  return response;
}
