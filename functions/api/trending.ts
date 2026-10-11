/**
 * GET /api/trending?tf=1h|24h|7d|30d|1y&limit=10|25
 * Biggest crypto gainers and losers over a timeframe, taken from the same
 * CoinGecko universe as the crypto table (liquid coins only; no stablecoins or
 * wrapped copies). 4h / 8h / 12h are accepted for old saved layouts and answer
 * with 24h, reported in `effectiveTf`.
 */

import {
  cryptoTf,
  gainersAndLosers,
  getCryptoUniverse,
  MOVER_MIN_VOLUME,
  type Coin,
  type CryptoTf,
  type DataEnv,
} from '../_shared/cryptoUniverse';
import { jsonResponse, type WaitUntil } from '../_shared/edgeCache';

type Ctx = { request: Request; env?: DataEnv; waitUntil?: WaitUntil };

const ACCEPTED = new Set(['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y']);

function row(c: Coin, tf: CryptoTf, i: number) {
  return {
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    image: c.image,
    price: c.price,
    rank: i + 1,
    score: null,
    marketCapRank: c.rank,
    changePercent: c.ch[tf],
    volume: c.volume,
    marketCap: c.marketCap,
  };
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url);
  const asked = url.searchParams.get('tf') ?? '24h';
  if (!ACCEPTED.has(asked)) {
    return jsonResponse({ error: 'invalid timeframe; use 1h|24h|7d|30d|1y' }, { status: 400 });
  }
  const tf = cryptoTf(asked);
  const limit = Number(url.searchParams.get('limit')) === 25 ? 25 : 10;
  const note =
    `Top ${limit} gainers and losers over ${tf} among the 250 largest coins on CoinGecko ` +
    `with at least $${MOVER_MIN_VOLUME / 1e6}M traded in 24h. Stablecoins and wrapped tokens are left out.` +
    (tf !== asked ? ` ${asked} is not published by the data source; showing ${tf}.` : '');
  try {
    const u = await getCryptoUniverse(context.env, context.waitUntil);
    const { gainers, losers } = gainersAndLosers(u.coins, tf, limit);
    const pumps = gainers.map((c, i) => row(c, tf, i));
    const dumps = losers.map((c, i) => row(c, tf, i));
    return jsonResponse(
      {
        tf: asked,
        effectiveTf: tf,
        limit,
        pumps,
        dumps,
        items: [...pumps, ...dumps],
        note,
        rateLimited: false,
        stale: u.stale,
        source: 'coingecko',
        supportedTfs: ['1h', '24h', '7d', '30d', '1y'],
        fetchedAt: new Date(u.at).toISOString(),
      },
      { cacheControl: u.stale ? 'public, max-age=15' : 'public, max-age=45' },
    );
  } catch (e) {
    return jsonResponse(
      {
        tf: asked,
        effectiveTf: tf,
        pumps: [],
        dumps: [],
        items: [],
        error: e instanceof Error ? e.message : 'fetch failed',
        note: 'Crypto data is unavailable right now.',
        source: 'coingecko',
        fetchedAt: new Date().toISOString(),
      },
      { cacheControl: 'public, max-age=10' },
    );
  }
}
