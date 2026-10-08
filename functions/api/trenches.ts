/**
 * Cloudflare Pages Function — The Trenches (sub-$1M mkt-cap crypto movers).
 * GET /api/trenches?limit=10
 * CoinGecko free markets, server-side, ~60s cache. No keys.
 */

import { getTrenches } from '../_shared/coingecko';

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '10') || 10));

  try {
    const data = await getTrenches(limit);
    return new Response(
      JSON.stringify({
        items: data.items,
        limit,
        fetchedAt: new Date().toISOString(),
        note: data.note,
        limitation: data.limitation,
        source: 'coingecko',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=45, s-maxage=60',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        items: [],
        limit,
        ok: false,
        error: e instanceof Error ? e.message : 'fetch failed',
        fetchedAt: new Date().toISOString(),
        limitation:
          'CoinGecko unreachable. UI should keep last good trenches rows if any.',
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
