/**
 * Solana bubble movers via Jupiter lite-api verified tokens (free, no key).
 * Provides priceChange + volume on 5m/1h/6h/24h windows.
 */
import { makeCache } from './cache';
import type { Timeframe } from './universes';

export type SolanaMoverRow = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  volumeIsUsd?: boolean;
  marketCap: number | null;
  ok: boolean;
};

type JupStats = {
  priceChange?: number;
  buyVolume?: number;
  sellVolume?: number;
};

type JupToken = {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  usdPrice?: number;
  mcap?: number;
  stats1h?: JupStats;
  stats6h?: JupStats;
  stats24h?: JupStats;
  tags?: string[];
  isVerified?: boolean;
};

const jupCache = makeCache<JupToken[]>(150_000);
const moversCache = makeCache<{
  items: SolanaMoverRow[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
  rateLimited: boolean;
  stale: boolean;
}>(150_000);

const UA = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; MarketClock/1.0)',
};

const STABLE = new Set([
  'USDC',
  'USDT',
  'USD1',
  'PYUSD',
  'DAI',
  'USDS',
  'USDE',
  'FDUSD',
  'TUSD',
  'FRAX',
  'EURC',
  'JLUSDC',
  'CUSD',
]);

function volUsd(s?: JupStats): number {
  if (!s) return 0;
  return Math.max(0, (s.buyVolume ?? 0) + (s.sellVolume ?? 0));
}

function pickStats(
  t: JupToken,
  tf: Timeframe,
): { stats?: JupStats; effective: string; note: string | null } {
  if (tf === '1h') return { stats: t.stats1h, effective: '1h', note: null };
  if (tf === '4h' || tf === '8h' || tf === '12h') {
    return {
      stats: t.stats6h,
      effective: '6h',
      note: `Solana bubbles use Jupiter 6h change for ${tf} (closest free window).`,
    };
  }
  if (tf === '24h') return { stats: t.stats24h, effective: '24h', note: null };
  // 7d / 30d / 1y — Jupiter lite list has no longer windows; use 24h + label
  return {
    stats: t.stats24h,
    effective: '24h',
    note: `Solana bubbles: Jupiter verified list only exposes ≤24h stats; showing 24h change for ${tf}.`,
  };
}

async function fetchVerified(): Promise<{ tokens: JupToken[]; stale: boolean }> {
  const hit = jupCache.get('verified');
  if (hit?.length) return { tokens: hit, stale: false };
  try {
    const res = await fetch('https://lite-api.jup.ag/tokens/v2/tag?query=verified', {
      headers: UA,
    });
    if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
    const json = (await res.json()) as JupToken[];
    if (!Array.isArray(json) || !json.length) throw new Error('Jupiter empty');
    jupCache.set('verified', json);
    return { tokens: json, stale: false };
  } catch (e) {
    const stale = jupCache.getStale('verified');
    if (stale?.length) return { tokens: stale, stale: true };
    throw e instanceof Error ? e : new Error('Jupiter fetch failed');
  }
}

export async function getSolanaMovers(
  tf: Timeframe,
  limit = 50,
): Promise<{
  items: SolanaMoverRow[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
  rateLimited: boolean;
  stale: boolean;
}> {
  const cacheKey = `sol|${tf}|${limit}`;
  const cached = moversCache.get(cacheKey);
  if (cached) return cached;

  const { tokens, stale } = await fetchVerified();
  let note: string | null = null;
  let effectiveTf = tf;

  const rows: SolanaMoverRow[] = [];
  for (const t of tokens) {
    const sym = (t.symbol || '').toUpperCase();
    if (!sym || STABLE.has(sym)) continue;
    if ((t.tags || []).some((x) => /stable|wrapped-stable/i.test(x))) continue;
    const { stats, effective, note: n } = pickStats(t, tf);
    if (n && !note) note = n;
    effectiveTf = effective;
    const pct = stats?.priceChange;
    if (pct == null || !Number.isFinite(pct)) continue;
    const volume = volUsd(stats);
    rows.push({
      id: `solana:${t.id}`,
      symbol: sym,
      name: t.name || sym,
      image: t.icon ?? null,
      price: t.usdPrice != null && Number.isFinite(t.usdPrice) ? t.usdPrice : null,
      changePercent: pct,
      volume,
      volumeIsUsd: true,
      marketCap: t.mcap != null && Number.isFinite(t.mcap) ? t.mcap : null,
      ok: true,
    });
  }

  // Drop dust volume so bubble sizes stay meaningful (Birdeye-like)
  const MIN_VOL = 25_000;
  const liquid = rows.filter((r) => (r.volume ?? 0) >= MIN_VOL);
  const pool = liquid.length >= Math.min(15, limit) ? liquid : rows.filter((r) => (r.volume ?? 0) > 0);
  pool.sort((a, b) => {
    const d = Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0);
    if (d !== 0) return d;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });
  const items = pool.slice(0, limit);

  const result = {
    items,
    effectiveTf,
    tfLabel: effectiveTf,
    note,
    limitation: `Source: Jupiter verified Solana tokens (lite-api). Ranked by abs ${effectiveTf} %. Volume = buy+sell USD on that window. Cached ~2.5m.${stale ? ' Stale token list.' : ''}`,
    rateLimited: false,
    stale,
  };
  if (items.length) moversCache.set(cacheKey, result);
  return result;
}
