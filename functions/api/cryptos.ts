/**
 * GET /api/cryptos[?limit=250][&universe=eth]
 * The crypto universe (top coins by market cap, CoinGecko), with 1h / 24h / 7d /
 * 30d / 1y changes from CoinGecko and 4h / 8h changes from the site's own hourly
 * price record. One upstream request serves every crypto view on the site.
 * `universe=eth` gives the Ethereum-ecosystem list in the same shape.
 */

import { getCryptoUniverse, getEthUniverse, type DataEnv } from '../_shared/cryptoUniverse';
import { jsonResponse, type WaitUntil } from '../_shared/edgeCache';

type Ctx = { request: Request; env?: DataEnv; waitUntil?: WaitUntil };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url);
  const limit = Math.min(250, Math.max(1, Number(url.searchParams.get('limit')) || 250));
  try {
    const eth = url.searchParams.get('universe') === 'eth';
    const u = await (eth ? getEthUniverse : getCryptoUniverse)(context.env, context.waitUntil);
    const items = u.coins.slice(0, limit).map((c) => ({
      ...c,
      // Fields the previous client read; kept so tabs opened before a deploy keep working.
      changePercent: c.ch['24h'],
      ok: c.price != null,
      fallback: false,
      stale: u.stale || undefined,
    }));
    return jsonResponse(
      {
        items,
        ok: true,
        stale: u.stale,
        source: u.source,
        fetchedAt: new Date(u.at).toISOString(),
      },
      { cacheControl: u.stale ? 'public, max-age=15' : 'public, max-age=30' },
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
