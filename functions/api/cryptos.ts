/**
 * GET /api/cryptos[?limit=250][&universe=eth|bnb]
 * The crypto universe (top coins by market cap, CoinGecko), with 1h / 24h / 7d /
 * 30d / 1y changes from CoinGecko and 4h / 8h changes from the site's own hourly
 * price record. One upstream request serves every crypto view on the site.
 * `universe=eth` gives the Ethereum-ecosystem list in the same shape, and
 * `universe=bnb` the BNB Chain one. If that list cannot be had (CoinGecko
 * refuses and no copy is held), the answer is the chain's tokens found in the
 * main list, marked `partial: true`.
 */

import { CHAIN_FROM_MAIN_MIN, CHAINS, chainFromMain, getChainUniverse, getCryptoUniverse, type Chain, type CryptoUniverse, type DataEnv } from '../_shared/cryptoUniverse';
import { jsonResponse, type WaitUntil } from '../_shared/edgeCache';

type Ctx = { request: Request; env?: DataEnv; waitUntil?: WaitUntil };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url);
  const limit = Math.min(250, Math.max(1, Number(url.searchParams.get('limit')) || 250));
  try {
    const asked = url.searchParams.get('universe');
    const chain = CHAINS.includes(asked as Chain) ? (asked as Chain) : null;
    let u: CryptoUniverse;
    let partial = false;
    if (chain) {
      try {
        u = await getChainUniverse(chain, context.env, context.waitUntil);
      } catch (e) {
        const main = await getCryptoUniverse(context.env, context.waitUntil);
        const known = chainFromMain(chain, main.coins);
        if (known.length < CHAIN_FROM_MAIN_MIN[chain]) throw e;
        u = { ...main, coins: known };
        partial = true;
      }
    } else {
      u = await getCryptoUniverse(context.env, context.waitUntil);
    }
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
        ...(partial ? { partial: true } : {}),
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
