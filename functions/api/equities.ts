/**
 * GET /api/equities
 * Every stock and ETF in the site's universe with price, 1D / 1W / 1M / YTD / 1Y
 * changes, market cap, 52-week range and a small sparkline. Feeds the stock and
 * ETF tables, the heat map and the stock bubbles.
 */

import { getEquityUniverse } from '../_shared/equityUniverse';
import { jsonResponse, type KvLike, type WaitUntil } from '../_shared/edgeCache';
import { marketStatus } from '../_shared/marketCalendar';

type Ctx = { request: Request; env?: { LAYOUTS?: KvLike }; waitUntil?: WaitUntil };

export async function onRequestGet(context: Ctx): Promise<Response> {
  try {
    const u = await getEquityUniverse(context.env, context.waitUntil);
    const open = marketStatus().open;
    return jsonResponse(
      {
        items: u.items,
        ok: true,
        stale: u.stale,
        source: u.source,
        fetchedAt: new Date(u.at).toISOString(),
      },
      { cacheControl: u.stale ? 'public, max-age=15' : `public, max-age=${open ? 20 : 120}` },
    );
  } catch (e) {
    return jsonResponse(
      {
        items: [],
        ok: false,
        error: e instanceof Error ? e.message : 'fetch failed',
        fetchedAt: new Date().toISOString(),
      },
      { cacheControl: 'public, max-age=10' },
    );
  }
}
