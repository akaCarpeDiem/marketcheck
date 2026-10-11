import { makeCache, mapPool, sleep } from './cache';
import type { Timeframe } from './universes';
import { getBinanceCryptoMovers } from './binanceCrypto';

const CG = 'https://api.coingecko.com/api/v3';
const MCAP_MAX = 1_000_000;
/** Aggressive success cache: 3 minutes. */
const CACHE_TTL = 180_000;

export type CGMarket = {
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  price_change_percentage_1y_in_currency?: number | null;
  total_volume: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
};

export type MoverRow = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  ok: boolean;
};

const marketsCache = makeCache<CGMarket[]>(CACHE_TTL);
const ohlcCache = makeCache<number[][]>(CACHE_TTL * 2);
export type TrendingRow = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  rank: number | null;
  score: number | null;
  marketCapRank: number | null;
  changePercent: number | null;
  volume?: number | null;
  marketCap?: number | null;
};

const CG_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; MarketCheckDash/1.0; +https://github.com/)',
};

async function fetchMarketsPage(
  page: number,
  order: string,
  pct: string,
): Promise<CGMarket[]> {
  const url =
    `${CG}/coins/markets?vs_currency=usd&order=${order}&per_page=250&page=${page}` +
    `&sparkline=false&price_change_percentage=${encodeURIComponent(pct)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: CG_HEADERS });
    if (res.status === 429) {
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      throw new Error('CoinGecko markets HTTP 429');
    }
    if (!res.ok) throw new Error(`CoinGecko markets HTTP ${res.status}`);
    return (await res.json()) as CGMarket[];
  }
  throw new Error('CoinGecko markets HTTP 429');
}

/**
 * Single CoinGecko markets request (per_page=250, volume_desc, multi-TF %).
 * Fresh cache 2–5 min; on 429/failure return last good cache if any.
 */
export async function fetchCgMarketsBundle(_opts?: {
  includeLowCap?: boolean;
}): Promise<{
  coins: CGMarket[];
  note: string;
  rateLimited: boolean;
  fromCache: boolean;
}> {
  const key = 'bundle:vol250:multi';
  const fresh = marketsCache.get(key);
  if (fresh && fresh.length) {
    return {
      coins: fresh,
      note: 'cached (CoinGecko single markets page)',
      rateLimited: false,
      fromCache: true,
    };
  }

  try {
    // One upstream request with real 1h/24h/7d/30d/1y % fields when available.
    const batch = await fetchMarketsPage(1, 'volume_desc', '1h,24h,7d,30d,1y');
    if (batch.length) marketsCache.set(key, batch);
    return {
      coins: batch,
      note: 'CoinGecko markets: 1 request (volume_desc, per_page=250, 1h+24h+7d+30d+1y %). Top movers ranked by abs(%).',
      rateLimited: false,
      fromCache: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fail';
    const is429 = msg.includes('429');
    const stale = marketsCache.getStale(key);
    if (stale && stale.length) {
      return {
        coins: stale,
        note: is429
          ? 'CoinGecko rate-limited (HTTP 429); serving last good cache.'
          : `CoinGecko fetch failed (${msg}); serving last good cache.`,
        rateLimited: is429,
        fromCache: true,
      };
    }
    return {
      coins: [],
      note: is429
        ? 'CoinGecko rate-limited (HTTP 429); no cached data yet.'
        : `CoinGecko fetch failed: ${msg}`,
      rateLimited: is429,
      fromCache: false,
    };
  }
}

type CryptoPctTf = '1h' | '24h' | '7d' | '30d' | '1y';

function pctFromMarket(c: CGMarket, tf: CryptoPctTf): number | null {
  let v: number | null | undefined;
  switch (tf) {
    case '1h':
      v = c.price_change_percentage_1h_in_currency;
      break;
    case '24h':
      v = c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h;
      break;
    case '7d':
      v = c.price_change_percentage_7d_in_currency;
      break;
    case '30d':
      v = c.price_change_percentage_30d_in_currency;
      break;
    case '1y':
      v = c.price_change_percentage_1y_in_currency;
      break;
  }
  return v != null && Number.isFinite(v) ? v : null;
}

/** Crypto bubble TFs: real CoinGecko markets fields only (no faking 4/8/12h). */
export function resolveCryptoTf(tf: Timeframe): {
  effective: CryptoPctTf;
  label: string;
  note: string | null;
  supported: boolean;
} {
  if (tf === '1h' || tf === '24h' || tf === '7d' || tf === '30d' || tf === '1y') {
    return { effective: tf, label: tf, note: null, supported: true };
  }
  return {
    effective: '24h',
    label: tf,
    note: `Crypto bubbles support 1h, 24h, 7d, 30d, 1y (Binance public API). Mid intraday windows (${tf}) are not offered.`,
    supported: false,
  };
}

function toMover(c: CGMarket, changePercent: number | null): MoverRow {
  return {
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.image ?? null,
    price: c.current_price,
    changePercent,
    volume: c.total_volume,
    volumeIsUsd: true,
    marketCap: c.market_cap,
    ok: c.current_price != null,
  };
}

function rankMovers(rows: MoverRow[], limit: number): MoverRow[] {
  const withPct = rows.filter(
    (r) => r.changePercent != null && Number.isFinite(r.changePercent),
  );
  withPct.sort((a, b) => {
    const absDiff = Math.abs(b.changePercent!) - Math.abs(a.changePercent!);
    if (absDiff !== 0) return absDiff;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });
  if (withPct.length >= limit) return withPct.slice(0, limit);
  const seen = new Set(withPct.map((r) => r.id));
  const pad = [...rows]
    .filter((r) => !seen.has(r.id) && r.price != null)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  for (const row of pad) {
    withPct.push({
      ...row,
      changePercent:
        row.changePercent != null && Number.isFinite(row.changePercent)
          ? row.changePercent
          : 0,
      ok: true,
    });
    if (withPct.length >= limit) break;
  }
  return withPct.slice(0, limit);
}

export async function getTrenches(limit = 10): Promise<{
  items: (MoverRow & { rank: number })[];
  note: string;
  limitation: string;
  rateLimited: boolean;
}> {
  const { coins, note, rateLimited, fromCache } = await fetchCgMarketsBundle();
  const filtered = coins.filter(
    (c) =>
      c.market_cap != null &&
      c.market_cap > 0 &&
      c.market_cap < MCAP_MAX &&
      (c.price_change_percentage_24h != null ||
        c.price_change_percentage_24h_in_currency != null),
  );
  const movers = rankMovers(
    filtered.map((c) => toMover(c, pctFromMarket(c, '24h'))),
    limit,
  );
  return {
    items: movers.map((m, i) => ({ ...m, rank: i + 1 })),
    note,
    limitation: rateLimited
      ? fromCache
        ? 'Rate-limited; serving last good cache. Sub-$1M coverage is incomplete on a single free markets page.'
        : 'CoinGecko rate-limited (HTTP 429); no cached trenches data yet.'
      : filtered.length < limit
        ? `Only ${filtered.length} coins with market_cap < $1M in the single volume_desc page (best-effort).`
        : 'Filtered from one CoinGecko markets page (volume_desc, 250). Not an exhaustive microcap scan.',
    rateLimited,
  };
}

export async function getCryptoMovers(
  tf: Timeframe,
  limit = 50,
  _trenchesOnly = false,
): Promise<{
  items: MoverRow[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
  rateLimited: boolean;
  stale: boolean;
}> {
  const resolved = resolveCryptoTf(tf);
  if (!resolved.supported) {
    return {
      items: [],
      effectiveTf: tf,
      tfLabel: tf,
      note: resolved.note,
      limitation: resolved.note ?? `Unsupported crypto timeframe ${tf}.`,
      rateLimited: false,
      stale: false,
    };
  }

  // Primary: Binance public API (no key, avoids CoinGecko 429 on every refresh)
  try {
    const binance = await getBinanceCryptoMovers(tf, limit);
    if (binance.items.length) {
      return {
        items: binance.items,
        effectiveTf: binance.effectiveTf,
        tfLabel: binance.tfLabel,
        note: binance.note,
        limitation: binance.limitation,
        rateLimited: false,
        stale: binance.stale,
      };
    }
    // Empty but Binance responded — still prefer its limitation over hitting CG
    if (!binance.rateLimited) {
      return {
        items: [],
        effectiveTf: binance.effectiveTf,
        tfLabel: binance.tfLabel,
        note: binance.note,
        limitation: binance.limitation || `No Binance movers for ${tf}.`,
        rateLimited: false,
        stale: false,
      };
    }
  } catch (e) {
    // Fall through to CoinGecko only when Binance fails
    const msg = e instanceof Error ? e.message : 'Binance failed';
    console.warn('[crypto movers] Binance primary failed, trying CoinGecko:', msg);
  }

  // Fallback only: CoinGecko markets bundle (may 429)
  const { coins, note: fetchNote, rateLimited, fromCache } = await fetchCgMarketsBundle();
  const movers = rankMovers(
    coins.map((c) => toMover(c, pctFromMarket(c, resolved.effective))),
    limit,
  );

  let limitation = `Binance unavailable; CoinGecko fallback. ${fetchNote}`;
  if (rateLimited && !movers.length) {
    limitation =
      'Binance failed and CoinGecko rate-limited (HTTP 429); no cached crypto movers yet. Try Stocks/ETFs or wait ~1–2 minutes.';
  } else if (rateLimited && fromCache) {
    limitation = 'Binance failed; CoinGecko rate-limited (HTTP 429); showing last good CoinGecko cache.';
  } else if (!movers.length && !rateLimited) {
    limitation = `Binance failed; CoinGecko returned no movers with real ${resolved.effective} %.`;
  }

  return {
    items: movers,
    effectiveTf: resolved.effective,
    tfLabel: resolved.label,
    note: fromCache && rateLimited ? fetchNote : null,
    limitation,
    rateLimited,
    stale: fromCache && rateLimited,
  };
}

/** Verified free trending windows exposed by CoinGecko markets fields. */
export type TrendingTf = '1h' | '4h' | '8h' | '12h' | '24h' | '7d' | '30d' | '1y';

/**
 * Top 20 momentum tokens from CoinGecko's 250 highest-volume market rows.
 * Ranking uses absolute real percentage change for the selected window; no
 * interpolated or fabricated intervals.
 */
export async function getTrendingTokens(
  tf: TrendingTf = '24h',
  limit = 10,
): Promise<{
  pumps: TrendingRow[];
  dumps: TrendingRow[];
  items: TrendingRow[];
  note: string;
  rateLimited: boolean;
  stale: boolean;
  source: string;
  supportedTfs: TrendingTf[];
}> {
  const supportedTfs: TrendingTf[] = ['1h', '4h', '8h', '12h', '24h', '7d', '30d', '1y'];
  const cap = limit === 25 ? 25 : 10;

  function splitPumpsDumps(rows: TrendingRow[]): { pumps: TrendingRow[]; dumps: TrendingRow[]; items: TrendingRow[] } {
    const withPct = rows.filter((r) => r.changePercent != null && Number.isFinite(r.changePercent));
    const pumps = [...withPct]
      .filter((r) => (r.changePercent ?? 0) > 0)
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
      .slice(0, cap)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    const dumps = [...withPct]
      .filter((r) => (r.changePercent ?? 0) < 0)
      .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
      .slice(0, cap)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    return { pumps, dumps, items: [...pumps, ...dumps] };
  }

  // Prefer Binance (same hosts as crypto bubbles) — avoids CoinGecko 429; supports mid-intraday TFs.
  try {
    const bn = await getBinanceCryptoMovers(tf as import('./universes').Timeframe, Math.max(80, cap * 4));
    if (bn.items.length) {
      const rows: TrendingRow[] = bn.items.map((row, index) => ({
        id: row.id,
        symbol: row.symbol,
        name: row.name,
        image:
          row.image ??
          `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${row.symbol.toLowerCase()}.png`,
        price: row.price,
        rank: index + 1,
        score: null,
        marketCapRank: null,
        changePercent: row.changePercent,
        volume: row.volume ?? null,
        marketCap: row.marketCap ?? null,
      }));
      const split = splitPumpsDumps(rows);
      return {
        ...split,
        note: bn.limitation || `Top pumps/dumps by ${tf} move via Binance.`,
        rateLimited: bn.rateLimited,
        stale: bn.stale,
        source: 'binance',
        supportedTfs,
      };
    }
  } catch (e) {
    console.warn('[trending] Binance failed, CoinGecko fallback', e);
  }

  // CoinGecko free markets only exposes 1h/24h/7d/30d/1y — not 4h/8h/12h.
  const cgTf: CryptoPctTf | null =
    tf === '1h' || tf === '24h' || tf === '7d' || tf === '30d' || tf === '1y'
      ? tf
      : null;
  if (!cgTf) {
    return {
      pumps: [],
      dumps: [],
      items: [],
      note: `Binance unavailable; CoinGecko has no real ${tf} field (only 1h/24h/7d/30d/1y).`,
      rateLimited: false,
      stale: false,
      source: 'coingecko:/coins/markets',
      supportedTfs: ['1h', '24h', '7d', '30d', '1y'],
    };
  }

  const markets = await fetchCgMarketsBundle();
  const rows = markets.coins
    .map((coin) => ({ coin, changePercent: pctFromMarket(coin, cgTf) }))
    .filter(
      (row): row is { coin: CGMarket; changePercent: number } =>
        row.changePercent != null && Number.isFinite(row.changePercent),
    )
    .map(({ coin, changePercent }, index) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      image: coin.image ?? null,
      price: coin.current_price ?? null,
      rank: index + 1,
      score: null,
      marketCapRank: coin.market_cap_rank,
      changePercent,
      volume: coin.total_volume ?? null,
      marketCap: coin.market_cap ?? null,
    }));

  const split = splitPumpsDumps(rows);
  const universe = 'CoinGecko /coins/markets (top 250 by volume)';
  const note = split.items.length
    ? `Binance unavailable; ${universe}; top pumps/dumps by ${cgTf} change. ${markets.note}`
    : `Binance unavailable; ${universe} returned no rows with a real ${cgTf} change field. ${markets.note}`;
  return {
    ...split,
    note,
    rateLimited: markets.rateLimited,
    stale: markets.rateLimited && markets.fromCache,
    source: 'coingecko:/coins/markets',
    supportedTfs: ['1h', '24h', '7d', '30d', '1y'],
  };
}

export async function refineWithOhlc(
  rows: MoverRow[],
  hours: number,
  maxRefine = 12,
): Promise<MoverRow[]> {
  const subset = rows.slice(0, maxRefine);
  const refined = await mapPool(subset, 2, async (row, i) => {
    await sleep(i * 80);
    try {
      const closes = await fetchOhlcCloses(row.id);
      if (closes.length < 2) return row;
      const pct = pctFromClosesHours(closes, hours);
      if (pct == null) return row;
      return { ...row, changePercent: pct };
    } catch {
      return row;
    }
  });
  const byId = new Map(refined.map((r) => [r.id, r]));
  return rows.map((r) => byId.get(r.id) ?? r);
}

async function fetchOhlcCloses(coinId: string): Promise<number[][]> {
  const cached = ohlcCache.get(coinId);
  if (cached) return cached;
  const url = `${CG}/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=1`;
  const res = await fetch(url, { headers: CG_HEADERS });
  if (!res.ok) return [];
  const data = (await res.json()) as number[][];
  if (!Array.isArray(data)) return [];
  ohlcCache.set(coinId, data);
  return data;
}

/** OHLC rows: [timestamp_ms, open, high, low, close] */
function pctFromClosesHours(ohlc: number[][], hours: number): number | null {
  if (!ohlc.length) return null;
  const last = ohlc[ohlc.length - 1]!;
  const lastClose = last[4];
  const lastTs = last[0];
  if (lastClose == null || !lastTs) return null;
  const target = lastTs - hours * 3600_000;
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (const row of ohlc) {
    const ts = row[0]!;
    const dist = Math.abs(ts - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }
  const openish = best?.[4] ?? best?.[1];
  if (openish == null || openish === 0) return null;
  return ((lastClose - openish) / openish) * 100;
}
