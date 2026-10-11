/**
 * Cloudflare Pages Function — momentum pumps & dumps.
 * GET /api/trending?tf=1h|4h|8h|12h|24h|7d|30d|1y&limit=10|25
 * Prefers Binance public data; CoinGecko fallback for non-mid-intraday TFs.
 */

import { getTrendingTokens, type TrendingTf } from '../_shared/coingecko';

const VALID_TF = new Set<TrendingTf>([
  '1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y',
]);

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  try {
    const url = new URL(context.request.url);
    const tf = (url.searchParams.get('tf') ?? '24h') as TrendingTf;
    if (!VALID_TF.has(tf)) {
      return new Response(
        JSON.stringify({
          error: 'invalid trending timeframe; use 1h|4h|8h|12h|24h|7d|30d|1y',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const limitRaw = Number(url.searchParams.get('limit') ?? '10');
    const limit = limitRaw === 25 ? 25 : 10;
    const data = await getTrendingTokens(tf, limit);
    return new Response(
      JSON.stringify({
        tf,
        limit,
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
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': data.stale
            ? 'public, max-age=30'
            : 'public, max-age=60, s-maxage=120',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        pumps: [],
        dumps: [],
        items: [],
        error: e instanceof Error ? e.message : 'fetch failed',
        source: 'binance|coingecko',
        fetchedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=15',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
