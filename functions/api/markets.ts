/**
 * Cloudflare Pages Function — Yahoo Finance quotes with marketCap.
 * GET /api/markets?symbols=AAPL,MSFT,^GSPC
 * No API keys required (Yahoo crumb + chart fallback).
 */

import { fetchYahooQuotes } from '../_shared/yahooQuote';

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const symbolsParam = url.searchParams.get('symbols') ?? '';
  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (!symbols.length) {
    return new Response(JSON.stringify({ error: 'symbols query param required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const quotes = await fetchYahooQuotes(symbols);
  const normalized = quotes.map((q, i) => ({
    ...q,
    requested: symbols[i],
    symbol: q.symbol || symbols[i],
  }));

  const anyFail = normalized.some((q) => !q.ok || q.price == null);
  return new Response(
    JSON.stringify({ quotes: normalized, fetchedAt: new Date().toISOString() }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Don't let CDN pin partial Yahoo failures (blank tiles / missing mcap) for long.
        'Cache-Control': anyFail
          ? 'public, max-age=5, s-maxage=8'
          : 'public, max-age=15, s-maxage=20',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
