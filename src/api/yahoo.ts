import type { MarketQuote, YahooApiResponse } from '../types';
import { DEFAULT_FETCH_MS, fetchSignal } from './fetchTimeout';
import { STOCK_UNIVERSE, ETF_UNIVERSE } from '../../functions/_shared/universes';

const ETF_YAHOO = new Set(ETF_UNIVERSE.map((s) => s.yahoo.toUpperCase()));

export type HeroUnit = 'usd' | 'oz' | 'oil' | 'index';

export type HeroAssetDef = {
  id: string;
  yahoo: string;
  label: string;
  name?: string;
  unit: HeroUnit;
};

export const HERO_SYMBOLS: HeroAssetDef[] = [
  { id: 'btc', yahoo: 'BTC-USD', label: 'BTC-USD', unit: 'usd' as const },
  { id: 'gold', yahoo: 'GC=F', label: 'Gold', unit: 'oz' as const },
  { id: 'silver', yahoo: 'SI=F', label: 'Silver', unit: 'oz' as const },
  { id: 'wti', yahoo: 'CL=F', label: 'WTI Oil', unit: 'oil' as const },
  { id: 'spx', yahoo: '^GSPC', label: 'S&P 500', unit: 'index' as const },
  { id: 'ndx', yahoo: '^IXIC', label: 'Nasdaq', unit: 'index' as const },
];

/** Large liquid US-listed stock universe; display Top 10/25 sorted by live marketCap. */
function stockId(yahoo: string): string {
  return yahoo.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const TOP_STOCK_SYMBOLS = STOCK_UNIVERSE.map((s) => ({
  id: stockId(s.yahoo),
  yahoo: s.yahoo,
  label: s.label,
  name: s.name,
  unit: 'usd' as const,
}));

/** Large liquid ETF universe; display Top 10/25 sorted by live marketCap/AUM. */
export const TOP_ETF_SYMBOLS = ETF_UNIVERSE.map((s) => ({
  id: `etf-${stockId(s.yahoo)}`,
  yahoo: s.yahoo,
  label: s.label,
  name: s.name,
  unit: 'usd' as const,
}));

/**
 * Indexes / ETFs row (exact order). Hero already covers S&P + Nasdaq Composite.
 * Labels match the tile display; Yahoo symbols are used for quotes + sparklines.
 */
export const INDEX_SYMBOLS = [
  { id: 'idx-dji', yahoo: '^DJI', label: 'DOW', name: 'Dow Jones Industrial Average', unit: 'index' as const },
  { id: 'idx-ndx', yahoo: '^NDX', label: 'Nasdaq-100', name: 'Nasdaq-100', unit: 'index' as const },
  { id: 'idx-qqq', yahoo: 'QQQ', label: 'QQQ', name: 'Invesco QQQ', unit: 'usd' as const },
  { id: 'idx-bnd', yahoo: 'BND', label: 'BND', name: 'Vanguard Total Bond Market ETF', unit: 'usd' as const },
  { id: 'idx-vnq', yahoo: 'VNQ', label: 'VNQ', name: 'Vanguard Real Estate ETF', unit: 'usd' as const },
  { id: 'idx-smh', yahoo: 'SMH', label: 'SMH', name: 'VanEck Semiconductor ETF', unit: 'usd' as const },
  {
    id: 'idx-usd',
    yahoo: 'USD',
    label: 'USD',
    name: 'ProShares Ultra Semiconductors',
    unit: 'usd' as const,
  },
  { id: 'idx-gltr', yahoo: 'GLTR', label: 'GLTR', name: 'abrdn Physical Precious Metals Basket ETF', unit: 'usd' as const },
  { id: 'idx-cper', yahoo: 'CPER', label: 'CPER', name: 'United States Copper Index Fund', unit: 'usd' as const },
  { id: 'idx-copx', yahoo: 'COPX', label: 'COPX', name: 'Global X Copper Miners ETF', unit: 'usd' as const },
];

export const ALL_YAHOO = [...HERO_SYMBOLS, ...TOP_STOCK_SYMBOLS, ...TOP_ETF_SYMBOLS, ...INDEX_SYMBOLS];

export function uniqueYahooSymbols(): string[] {
  return [...new Set(ALL_YAHOO.map((s) => s.yahoo))];
}

type QuoteRow = YahooApiResponse['quotes'][0] & { requested?: string };

const MARKETS_CHUNK = 20;

function chunkSymbols(symbols: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += MARKETS_CHUNK) {
    chunks.push(symbols.slice(i, i + MARKETS_CHUNK));
  }
  return chunks;
}

async function fetchMarketsChunk(
  symbols: string[],
  phase: 'quotes' | 'mcaps',
  asset: 'etf' | 'equity' | undefined,
  signal?: AbortSignal,
): Promise<Map<string, QuoteRow>> {
  const params = new URLSearchParams({ symbols: symbols.join(','), phase });
  if (phase === 'mcaps' && asset) params.set('asset', asset);
  const res = await fetch(`/api/markets?${params}`, { signal: fetchSignal(DEFAULT_FETCH_MS, signal) });
  if (!res.ok) throw new Error(`Yahoo proxy HTTP ${res.status}`);
  const data = (await res.json()) as { quotes: QuoteRow[]; fetchedAt: string };
  const map = new Map<string, QuoteRow>();
  for (const q of data.quotes) {
    if (q.requested) map.set(q.requested, q);
    map.set(q.symbol, q);
  }
  return map;
}

export function symbolWantsMarketCap(symbol: string): boolean {
  if (!symbol) return false;
  if (symbol.startsWith('^')) return false;
  if (symbol.includes('=')) return false;
  if (/-USD$/i.test(symbol)) return false;
  return true;
}

/**
 * Price chunks run in parallel. Each chunk is one server spark call (not 15 serial charts).
 * onChunk fires as each chunk lands so the dashboard can paint before the slowest one.
 */
export async function fetchYahooQuotes(
  symbols: string[],
  signal?: AbortSignal,
  hooks?: { onChunk?: (partial: Map<string, QuoteRow>) => void },
): Promise<Map<string, QuoteRow>> {
  const uniq = [...new Set(symbols.filter(Boolean))];
  if (!uniq.length) return new Map();
  const map = new Map<string, QuoteRow>();
  const chunks = chunkSymbols(uniq);
  const parts = await Promise.all(
    chunks.map(async (c) => {
      try {
        const part = await fetchMarketsChunk(c, 'quotes', undefined, signal);
        for (const [k, v] of part) map.set(k, v);
        hooks?.onChunk?.(map);
        return part;
      } catch {
        return new Map<string, QuoteRow>();
      }
    }),
  );
  if (!parts.some((p) => p.size)) {
    throw new Error('Yahoo proxy failed');
  }
  return map;
}

/** Nasdaq/ETF caps (and any equity trailing misses). Does not block the first price paint. */
export async function fetchYahooMarketCaps(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const uniq = [...new Set(symbols.filter(symbolWantsMarketCap))];
  const etf: string[] = [];
  const equity: string[] = [];
  for (const sym of uniq) {
    if (ETF_YAHOO.has(sym.toUpperCase())) etf.push(sym);
    else equity.push(sym);
  }
  const out = new Map<string, number>();
  const pull = async (list: string[], asset: 'etf' | 'equity') => {
    await Promise.all(
      chunkSymbols(list).map(async (c) => {
        try {
          const part = await fetchMarketsChunk(c, 'mcaps', asset, signal);
          for (const [k, v] of part) {
            if (v.marketCap != null && Number.isFinite(v.marketCap)) out.set(k, v.marketCap);
          }
        } catch {
          /* keep prices already painted */
        }
      }),
    );
  };
  await Promise.all([pull(etf, 'etf'), pull(equity, 'equity')]);
  return out;
}

export function toMarketQuote(
  def: { id: string; yahoo: string; label: string; unit: string; name?: string },
  raw: QuoteRow | undefined,
  prev?: MarketQuote,
): MarketQuote {
  if (raw?.ok && raw.price != null) {
    return {
      id: def.id,
      symbol: def.yahoo,
      label: def.label,
      name: def.name,
      price: raw.price,
      changePercent: raw.changePercent,
      marketCap: raw.marketCap ?? prev?.marketCap ?? null,
      unit: def.unit,
      ok: true,
      stale: false,
      source: 'yahoo',
      sparkline: prev?.sparkline ?? null,
    };
  }
  if (prev && prev.price != null) {
    return { ...prev, stale: true, ok: false };
  }
  return {
    id: def.id,
    symbol: def.yahoo,
    label: def.label,
    name: def.name,
    price: null,
    changePercent: null,
    marketCap: null,
    unit: def.unit,
    ok: false,
    stale: true,
    source: 'yahoo',
    sparkline: prev?.sparkline ?? null,
  };
}
