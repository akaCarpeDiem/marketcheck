/**
 * Binance public API — primary source for crypto bubble movers (no API key).
 * 24h: one ticker/24hr call. 1h/7d/30d/1y: klines on a high-volume USDT subset + cache.
 */
import { makeCache, mapPool } from './cache';
import type { Timeframe } from './universes';

export type BinanceMoverRow = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  /** Binance quoteVolume is already USDT (USD). */
  volumeIsUsd?: boolean;
  marketCap: number | null;
  ok: boolean;
};

// Prefer unrestricted public hosts first — api.binance.com often returns HTTP 451 by region.
const BINANCE_HOSTS = [
  'https://data-api.binance.vision',
  'https://api.binance.us',
  'https://api.binance.com',
] as const;

const tickerCache = makeCache<BinanceTicker[]>(150_000);
const moversCache = makeCache<{
  items: BinanceMoverRow[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
  rateLimited: boolean;
  stale: boolean;
}>(150_000);
const klineCache = makeCache<{ closes: number[] }>(180_000);

type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  volume: string;
};

const UA = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; MarketClock/1.0)',
};

/** Leveraged / noisy Binance products to skip. */
function isLeveragedOrNoise(base: string, symbol: string): boolean {
  const s = symbol.toUpperCase();
  const b = base.toUpperCase();
  if (/(UP|DOWN|BULL|BEAR)$/.test(b)) return true;
  if (/\d+[LS]$/.test(b)) return true; // 3L / 3S tokens
  if (s.includes('_') || s.endsWith('BUSD') || s.endsWith('TUSD')) return true;
  return false;
}

function baseFromUsdt(symbol: string): string | null {
  const s = symbol.toUpperCase();
  if (!s.endsWith('USDT')) return null;
  return s.slice(0, -4);
}

async function fetchTickers(): Promise<BinanceTicker[]> {
  const cached = tickerCache.get('all');
  if (cached?.length) return cached;

  const paths = BINANCE_HOSTS.map((h) => `${h}/api/v3/ticker/24hr`);
  let lastErr: Error | null = null;
  for (const url of paths) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) {
        lastErr = new Error(`Binance ticker HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as BinanceTicker[];
      if (!Array.isArray(json) || !json.length) {
        lastErr = new Error('Binance ticker empty');
        continue;
      }
      tickerCache.set('all', json);
      return json;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error('Binance ticker failed');
    }
  }
  const stale = tickerCache.getStale('all');
  if (stale?.length) return stale;
  throw lastErr ?? new Error('Binance ticker failed');
}

function usdtSpotTickers(all: BinanceTicker[]): {
  symbol: string;
  base: string;
  price: number;
  change24h: number;
  quoteVolume: number;
}[] {
  const out: {
    symbol: string;
    base: string;
    price: number;
    change24h: number;
    quoteVolume: number;
  }[] = [];
  for (const t of all) {
    const base = baseFromUsdt(t.symbol);
    if (!base || isLeveragedOrNoise(base, t.symbol)) continue;
    const price = Number(t.lastPrice);
    const change24h = Number(t.priceChangePercent);
    const quoteVolume = Number(t.quoteVolume);
    if (!Number.isFinite(price) || !Number.isFinite(change24h)) continue;
    out.push({
      symbol: t.symbol,
      base,
      price,
      change24h,
      quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0,
    });
  }
  return out;
}

async function fetchKlineCloses(
  symbol: string,
  interval: string,
  limit: number,
): Promise<number[]> {
  const key = `${symbol}|${interval}|${limit}`;
  const cached = klineCache.get(key);
  if (cached) return cached.closes;

  const q = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const paths = BINANCE_HOSTS.map((h) => `${h}/api/v3/klines?${q}`);
  for (const url of paths) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) continue;
      const rows = (await res.json()) as unknown[];
      if (!Array.isArray(rows) || rows.length < 2) continue;
      // [ openTime, open, high, low, close, ... ]
      const closes: number[] = [];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 5) continue;
        const c = Number(row[4]);
        if (Number.isFinite(c)) closes.push(c);
      }
      if (closes.length >= 2) {
        klineCache.set(key, { closes });
        return closes;
      }
    } catch {
      /* try next host */
    }
  }
  const stale = klineCache.getStale(key);
  return stale?.closes ?? [];
}

function pctFirstLast(closes: number[]): number | null {
  if (closes.length < 2) return null;
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  if (!first) return null;
  return ((last - first) / first) * 100;
}

/** For 1h: prefer close of bar ~1h ago → last; fall back to first→last. */
function pct1h(closes: number[]): number | null {
  if (closes.length < 2) return null;
  // With interval=15m limit=8 (~2h), use bar at index length-5 (~1h) when available
  if (closes.length >= 5) {
    const base = closes[closes.length - 5]!;
    const last = closes[closes.length - 1]!;
    if (base) return ((last - base) / base) * 100;
  }
  return pctFirstLast(closes);
}

function klineParams(tf: Timeframe): { interval: string; limit: number } | null {
  // All Crypto UI only offers 1h / 24h / 7d / 30d / 1y (no native Binance 4h/8h/12h windows)
  if (tf === '1h') return { interval: '15m', limit: 8 };
  if (tf === '7d') return { interval: '1d', limit: 8 };
  if (tf === '30d') return { interval: '1d', limit: 31 };
  if (tf === '1y') return { interval: '1d', limit: 365 };
  return null;
}


/** Strip Binance 1000/1M multipliers for icon CDNs. */
function logoSymbol(base: string): string {
  const raw = base.toUpperCase();
  const remap: Record<string, string> = {
    RNDR: 'RENDER',
    RENDER: 'RENDER',
    MATIC: 'MATIC',
    POL: 'POL',
    BTTC: 'BTT',
    FIRO: 'FIRO',
  };
  let s = remap[raw] ?? raw;
  s = s.replace(/^(1000|1000000|1M|1B)/i, '');
  return s.toLowerCase() || base.toLowerCase();
}

function cryptoLogoUrl(base: string): string {
  const sym = logoSymbol(base);
  return `https://assets.coincap.io/assets/icons/${sym}@2x.png`;
}

function toMover(row: {
  base: string;
  price: number;
  changePercent: number;
  quoteVolume: number;
}): BinanceMoverRow {
  return {
    id: `binance:${row.base}`,
    symbol: row.base,
    name: row.base,
    image: cryptoLogoUrl(row.base),
    price: row.price,
    changePercent: row.changePercent,
    volume: row.quoteVolume,
    volumeIsUsd: true,
    marketCap: null,
    ok: true,
  };
}

/** Prefer abs(%); if short of `limit`, pad with next volume pairs (small/zero % ok). */
function rankToLimit(items: BinanceMoverRow[], limit: number): BinanceMoverRow[] {
  const withPct = items.filter(
    (r) => r.changePercent != null && Number.isFinite(r.changePercent),
  );
  withPct.sort((a, b) => {
    const d = Math.abs(b.changePercent!) - Math.abs(a.changePercent!);
    if (d !== 0) return d;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });
  if (withPct.length >= limit) return withPct.slice(0, limit);

  const seen = new Set(withPct.map((r) => r.id));
  const pad = [...items]
    .filter((r) => !seen.has(r.id))
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

export function binanceSupportsTf(tf: Timeframe): boolean {
  return (
    tf === '1h' || tf === '4h' || tf === '8h' || tf === '12h' ||
    tf === '24h' || tf === '7d' || tf === '30d' || tf === '1y'
  );
}

/**
 * Primary crypto movers from Binance public market data.
 * Throws only if ticker completely unavailable (caller may fall back to CoinGecko).
 */
export async function getBinanceCryptoMovers(
  tf: Timeframe,
  limit = 50,
): Promise<{
  items: BinanceMoverRow[];
  effectiveTf: string;
  tfLabel: string;
  note: string | null;
  limitation: string;
  rateLimited: boolean;
  stale: boolean;
}> {
  if (!binanceSupportsTf(tf)) {
    return {
      items: [],
      effectiveTf: tf,
      tfLabel: tf,
      note: `Binance path does not support ${tf} for crypto bubbles.`,
      limitation: `Unsupported crypto timeframe (${tf}); use 1h, 4h, 8h, 12h, 24h, 7d, 30d, or 1y.`,
      rateLimited: false,
      stale: false,
    };
  }

  const cacheKey = `binance|${tf}|${limit}`;
  const hit = moversCache.get(cacheKey);
  if (hit) return hit;

  const tickers = await fetchTickers();
  const spot = usdtSpotTickers(tickers);
  spot.sort((a, b) => b.quoteVolume - a.quoteVolume);

  if (tf === '24h') {
    const items = rankToLimit(
      spot.slice(0, 200).map((t) =>
        toMover({
          base: t.base,
          price: t.price,
          changePercent: t.change24h,
          quoteVolume: t.quoteVolume,
        }),
      ),
      limit,
    );
    const shortNote =
      items.length < limit
        ? ` Only ${items.length}/${limit} USDT pairs available after filters.`
        : '';
    const result = {
      items,
      effectiveTf: '24h',
      tfLabel: '24h',
      note: null,
      limitation:
        `Source: Binance public /api/v3/ticker/24hr (USDT pairs; leveraged excluded). Target ${limit} bubbles by abs 24h %. Cached ~2.5m. Logos: CoinCap icons.${shortNote}`,
      rateLimited: false,
      stale: false,
    };
    moversCache.set(cacheKey, result);
    return result;
  }

  const params = klineParams(tf)!;
  // Fetch enough high-volume USDT pairs so we can always return `limit` (50) bubbles.
  const subsetSize = Math.max(limit, 80);
  const subset = spot.slice(0, subsetSize);

  const rows = await mapPool(subset, 12, async (t) => {
    const closes = await fetchKlineCloses(t.symbol, params.interval, params.limit);
    const changePercent = tf === '1h' ? pct1h(closes) : pctFirstLast(closes);
    // Keep row even without % so we can pad to `limit` by volume.
    return toMover({
      base: t.base,
      price: t.price,
      changePercent: changePercent ?? 0,
      quoteVolume: t.quoteVolume,
    });
  });

  const items = rankToLimit(rows, limit);
  const shortNote =
    items.length < limit
      ? ` Only ${items.length}/${limit} USDT pairs available after filters.`
      : '';

  const result = {
    items,
    effectiveTf: tf,
    tfLabel: tf,
    note: null,
    limitation: `Source: Binance public klines (${params.interval}) on top ${subsetSize} USDT pairs by quote volume; ranked by abs ${tf} %, padded to ${limit} when needed. Cached ~2.5–3m. Logos: CoinCap icons.${shortNote}`,
    rateLimited: false,
    stale: false,
  };
  moversCache.set(cacheKey, result);
  return result;
}
