/**
 * Batched 1y sparklines — one Yahoo spark subrequest for up to 20 symbols.
 * GET /api/sparklines?symbols=BND,VNQ,CPER,COPX
 */

import { fetchYahooSparklines } from '../_shared/yahooQuote';

export async function onRequestGet(context: {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const symbols = (url.searchParams.get('symbols') ?? '')
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
    /* miss */
  }

  const series = await fetchYahooSparklines(symbols);
  const anyFail = series.some((s) => !s.ok);
  const response = new Response(
    JSON.stringify({ series, fetchedAt: new Date().toISOString() }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': anyFail
          ? 'public, max-age=15, s-maxage=20'
          : 'public, max-age=120, s-maxage=600',
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
