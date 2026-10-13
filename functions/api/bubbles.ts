/**
 * GET /api/bubbles?category=cryptos|solana|stocks|etfs&tf=…&limit=50[&rank=move|up|down|volume]
 * The biggest movers in a category over a timeframe, for the bubble map.
 *
 *   cryptos  CoinGecko universe            1h 24h 7d 30d 1y
 *   solana   Jupiter verified tokens       1h 6h 24h
 *   stocks   Yahoo, the site's stock list  24h (1D) 7d 30d ytd 1y
 *   etfs     Yahoo, the site's ETF list    24h (1D) 7d 30d ytd 1y
 *
 * A timeframe the category cannot answer (kept in some saved layouts) falls
 * back to the nearest one it can; `effectiveTf` says which was used.
 * `rank` applies to Solana only: biggest moves (default), gainers, losers, or
 * most traded in the window.
 * The site itself builds crypto / stock / ETF bubbles in the browser from
 * /api/cryptos and /api/equities and only calls this for Solana (bubbles and
 * the SOL tab of the gainers and losers panels).
 */

import { cryptoTf, getCryptoUniverse, topMovers, type DataEnv } from '../_shared/cryptoUniverse';
import { jsonResponse, type WaitUntil } from '../_shared/edgeCache';
import { equityTf, getEquityUniverse } from '../_shared/equityUniverse';
import { SOLANA_RANKS, getSolanaMovers, type SolanaRank } from '../_shared/solanaMovers';

type Ctx = { request: Request; env?: DataEnv; waitUntil?: WaitUntil };

const CATEGORIES = new Set(['cryptos', 'solana', 'stocks', 'etfs']);
const EQUITY_LABEL: Record<string, string> = { '24h': '1D', '7d': '1W', '30d': '1M', ytd: 'YTD', '1y': '1Y' };

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url);
  const category = url.searchParams.get('category') ?? 'cryptos';
  const tf = url.searchParams.get('tf') ?? '24h';
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  if (!CATEGORIES.has(category) || !/^[a-z0-9]{2,4}$/.test(tf)) {
    return jsonResponse({ error: 'invalid category or tf' }, { status: 400 });
  }

  try {
    let body: Record<string, unknown>;
    if (category === 'cryptos') {
      const eff = cryptoTf(tf);
      const u = await getCryptoUniverse(context.env, context.waitUntil);
      body = {
        items: topMovers(u.coins, eff, limit).map((c) => ({
          id: c.id,
          symbol: c.symbol,
          name: c.name,
          image: c.image,
          price: c.price,
          changePercent: c.ch[eff],
          volume: c.volume,
          volumeIsUsd: true,
          marketCap: c.marketCap,
          ok: true,
        })),
        effectiveTf: eff,
        tfLabel: eff,
        note: eff !== tf ? `${tf} is not published for crypto; showing ${eff}.` : null,
        limitation: 'Largest moves among the 250 biggest coins on CoinGecko with real trading volume.',
        stale: u.stale,
        fetchedAt: new Date(u.at).toISOString(),
      };
    } else if (category === 'solana') {
      const asked = url.searchParams.get('rank');
      const rank = SOLANA_RANKS.includes(asked as SolanaRank) ? (asked as SolanaRank) : 'move';
      const m = await getSolanaMovers(tf, limit, rank);
      body = { ...m, fetchedAt: new Date().toISOString() };
    } else {
      const eff = equityTf(tf);
      const kind = category === 'stocks' ? 'stock' : 'etf';
      const u = await getEquityUniverse(context.env, context.waitUntil);
      const items = u.items
        .filter((e) => e.kind === kind && e.ok && e.ch[eff] != null)
        .sort((a, b) => Math.abs(b.ch[eff]!) - Math.abs(a.ch[eff]!))
        .slice(0, limit)
        .map((e) => ({
          id: e.symbol,
          symbol: e.symbol,
          name: e.name,
          image: null,
          price: e.price,
          changePercent: e.ch[eff],
          volume: null,
          marketCap: e.marketCap,
          ok: true,
        }));
      body = {
        items,
        effectiveTf: eff,
        tfLabel: EQUITY_LABEL[eff] ?? eff,
        note: eff !== tf ? `${tf} is not available for ${category}; showing ${EQUITY_LABEL[eff]}.` : null,
        limitation: `Largest moves in the site's ${category === 'stocks' ? 'large-cap stock' : 'ETF'} list (Yahoo Finance).`,
        stale: u.stale,
        fetchedAt: new Date(u.at).toISOString(),
      };
    }
    return jsonResponse(
      { category, tf, limit, rateLimited: false, ...body },
      { cacheControl: body.stale ? 'public, max-age=15' : 'public, max-age=45' },
    );
  } catch (e) {
    return jsonResponse(
      {
        category,
        tf,
        items: [],
        effectiveTf: tf,
        tfLabel: tf,
        rateLimited: false,
        stale: false,
        error: e instanceof Error ? e.message : 'fetch failed',
        limitation: 'This data is unavailable right now.',
        fetchedAt: new Date().toISOString(),
      },
      { cacheControl: 'public, max-age=10' },
    );
  }
}
