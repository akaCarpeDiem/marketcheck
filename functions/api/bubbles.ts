/**
 * Cloudflare Pages Function — Bubble-map movers by category + timeframe.
 * GET /api/bubbles?category=cryptos|solana|stocks|etfs&tf=1h|4h|8h|12h|24h|7d|30d|1y
 * Default category: stocks (reliable Yahoo). Cryptos: CoinGecko 1h/24h/7d/30d/1y.
 * No API keys.
 */

import { getCryptoMovers } from '../_shared/coingecko';
import { getSolanaMovers } from '../_shared/solanaMovers';
import { getEquityMovers } from '../_shared/yahooEquity';
import { CRYPTO_TFS, type BubbleCategory, type Timeframe } from '../_shared/universes';

const VALID_CAT = new Set<BubbleCategory>(['cryptos', 'solana', 'stocks', 'etfs']);
const VALID_TF = new Set<Timeframe>(['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y']);
const CRYPTO_TF = new Set<Timeframe>(CRYPTO_TFS);

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const category = (url.searchParams.get('category') ?? 'stocks') as BubbleCategory;
  const tf = (url.searchParams.get('tf') ?? '24h') as Timeframe;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '50') || 50));

  if (!VALID_CAT.has(category) || !VALID_TF.has(tf)) {
    return new Response(JSON.stringify({ error: 'invalid category or tf' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if ((category === 'cryptos' || category === 'solana') && !CRYPTO_TF.has(tf)) {
    return new Response(
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
        limitation: `Cryptos only support ${CRYPTO_TFS.join(', ')} (CoinGecko free markets fields). ${tf} is not available and is not approximated.`,
        fetchedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  try {
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
    } else if (category === 'solana') {
      const m = await getSolanaMovers(tf, limit);
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

    const cacheControl =
      category === 'cryptos' || category === 'solana'
        ? 'public, max-age=120, s-maxage=180'
        : 'public, max-age=30, s-maxage=60';

    // Keep empty arrays — do not throw away; surface limitation for UI
    if (!payload.items?.length && !payload.limitation) {
      payload.limitation = `No movers for ${category} / ${tf}. Try another timeframe or category.`;
    }

    return new Response(
      JSON.stringify({
        category,
        tf,
        limit,
        ...payload,
        fetchedAt: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': cacheControl,
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    const rateLimited = msg.includes('429');
    return new Response(
      JSON.stringify({
        category,
        tf,
        items: [],
        effectiveTf: tf,
        tfLabel: tf,
        rateLimited,
        stale: false,
        error: msg,
        fetchedAt: new Date().toISOString(),
        limitation: rateLimited
          ? 'Upstream rate-limited (HTTP 429); no cached data. Keep prior bubble data in UI.'
          : 'Upstream failed; keep prior bubble data in UI.',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=10',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}
