/** Hero tile asset catalog + layout normalization. */

import { STOCK_UNIVERSE, ETF_UNIVERSE } from './universes';

export type HeroUnit = 'usd' | 'oz' | 'oil' | 'index';

export type HeroAssetDef = {
  id: string;
  yahoo: string;
  label: string;
  name?: string;
  unit: HeroUnit;
};

export const DEFAULT_HERO: HeroAssetDef[] = [
  { id: 'btc', yahoo: 'BTC-USD', label: 'BTC-USD', unit: 'usd' },
  { id: 'gold', yahoo: 'GC=F', label: 'Gold', unit: 'oz' },
  { id: 'silver', yahoo: 'SI=F', label: 'Silver', unit: 'oz' },
  { id: 'wti', yahoo: 'CL=F', label: 'WTI Oil', unit: 'oil' },
  { id: 'spx', yahoo: '^GSPC', label: 'S&P 500', unit: 'index' },
  { id: 'ndx', yahoo: '^IXIC', label: 'Nasdaq', unit: 'index' },
];

const CRYPTO_EXTRAS: HeroAssetDef[] = [
  { id: 'eth', yahoo: 'ETH-USD', label: 'ETH-USD', name: 'Ethereum', unit: 'usd' },
  { id: 'sol', yahoo: 'SOL-USD', label: 'SOL-USD', name: 'Solana', unit: 'usd' },
  { id: 'xrp', yahoo: 'XRP-USD', label: 'XRP-USD', name: 'XRP', unit: 'usd' },
  { id: 'ada', yahoo: 'ADA-USD', label: 'ADA-USD', name: 'Cardano', unit: 'usd' },
  { id: 'doge', yahoo: 'DOGE-USD', label: 'DOGE-USD', name: 'Dogecoin', unit: 'usd' },
  { id: 'avax', yahoo: 'AVAX-USD', label: 'AVAX-USD', name: 'Avalanche', unit: 'usd' },
  { id: 'link', yahoo: 'LINK-USD', label: 'LINK-USD', name: 'Chainlink', unit: 'usd' },
  { id: 'dot', yahoo: 'DOT-USD', label: 'DOT-USD', name: 'Polkadot', unit: 'usd' },
  { id: 'matic', yahoo: 'MATIC-USD', label: 'MATIC-USD', name: 'Polygon', unit: 'usd' },
  { id: 'bnb', yahoo: 'BNB-USD', label: 'BNB-USD', name: 'BNB', unit: 'usd' },
  { id: 'ltc', yahoo: 'LTC-USD', label: 'LTC-USD', name: 'Litecoin', unit: 'usd' },
  { id: 'uni', yahoo: 'UNI-USD', label: 'UNI-USD', name: 'Uniswap', unit: 'usd' },
  { id: 'atom', yahoo: 'ATOM-USD', label: 'ATOM-USD', name: 'Cosmos', unit: 'usd' },
  { id: 'near', yahoo: 'NEAR-USD', label: 'NEAR-USD', name: 'NEAR Protocol', unit: 'usd' },
  { id: 'pepe', yahoo: 'PEPE-USD', label: 'PEPE-USD', name: 'Pepe', unit: 'usd' },
];

const INDEX_EXTRAS: HeroAssetDef[] = [
  { id: 'idx-dji', yahoo: '^DJI', label: 'DOW', name: 'Dow Jones Industrial Average', unit: 'index' },
  { id: 'idx-ndx', yahoo: '^NDX', label: 'Nasdaq-100', name: 'Nasdaq-100', unit: 'index' },
  { id: 'idx-rty', yahoo: '^RUT', label: 'Russell 2000', name: 'Russell 2000', unit: 'index' },
  { id: 'idx-vix', yahoo: '^VIX', label: 'VIX', name: 'CBOE Volatility Index', unit: 'index' },
  // Page index/ETF row (and peers) — full quoteable set
  { id: 'idx-qqq', yahoo: 'QQQ', label: 'QQQ', name: 'Invesco QQQ', unit: 'usd' },
  { id: 'idx-spy', yahoo: 'SPY', label: 'SPY', name: 'SPDR S&P 500', unit: 'usd' },
  { id: 'idx-iwm', yahoo: 'IWM', label: 'IWM', name: 'iShares Russell 2000', unit: 'usd' },
  { id: 'idx-dia', yahoo: 'DIA', label: 'DIA', name: 'SPDR Dow Jones', unit: 'usd' },
  { id: 'idx-bnd', yahoo: 'BND', label: 'BND', name: 'Vanguard Total Bond Market ETF', unit: 'usd' },
  { id: 'idx-vnq', yahoo: 'VNQ', label: 'VNQ', name: 'Vanguard Real Estate ETF', unit: 'usd' },
  { id: 'idx-smh', yahoo: 'SMH', label: 'SMH', name: 'VanEck Semiconductor ETF', unit: 'usd' },
  { id: 'idx-usd', yahoo: 'USD', label: 'USD', name: 'ProShares Ultra Semiconductors', unit: 'usd' },
  { id: 'idx-gltr', yahoo: 'GLTR', label: 'GLTR', name: 'abrdn Physical Precious Metals Basket ETF', unit: 'usd' },
  { id: 'idx-cper', yahoo: 'CPER', label: 'CPER', name: 'United States Copper Index Fund', unit: 'usd' },
  { id: 'idx-copx', yahoo: 'COPX', label: 'COPX', name: 'Global X Copper Miners ETF', unit: 'usd' },
  { id: 'idx-gld', yahoo: 'GLD', label: 'GLD', name: 'SPDR Gold', unit: 'usd' },
  { id: 'idx-slv', yahoo: 'SLV', label: 'SLV', name: 'iShares Silver', unit: 'usd' },
  { id: 'idx-uso', yahoo: 'USO', label: 'USO', name: 'United States Oil', unit: 'usd' },
  { id: 'idx-tlt', yahoo: 'TLT', label: 'TLT', name: 'iShares 20+ Year Treasury', unit: 'usd' },
];

const COMMODITY_EXTRAS: HeroAssetDef[] = [
  { id: 'fut-hg', yahoo: 'HG=F', label: 'Copper', name: 'Copper Futures', unit: 'usd' },
  { id: 'fut-ng', yahoo: 'NG=F', label: 'Nat Gas', name: 'Natural Gas Futures', unit: 'usd' },
  { id: 'fut-si', yahoo: 'SI=F', label: 'Silver', name: 'Silver Futures', unit: 'oz' },
  { id: 'fut-gc', yahoo: 'GC=F', label: 'Gold', name: 'Gold Futures', unit: 'oz' },
  { id: 'fut-cl', yahoo: 'CL=F', label: 'WTI Oil', name: 'WTI Crude Futures', unit: 'oil' },
];

function slugId(yahoo: string): string {
  return yahoo
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'asset';
}

function stockDefs(): HeroAssetDef[] {
  return STOCK_UNIVERSE.map((s) => ({
    id: `stk-${slugId(s.yahoo)}`,
    yahoo: s.yahoo,
    label: s.label,
    name: s.name,
    unit: 'usd' as const,
  }));
}

function etfDefs(): HeroAssetDef[] {
  // Full ETF universe we already quote for bubbles (includes GLTR, CPER, COPX, …)
  return ETF_UNIVERSE.map((s) => ({
    id: `etf-${slugId(s.yahoo)}`,
    yahoo: s.yahoo,
    label: s.label,
    name: s.name,
    unit: 'usd' as const,
  }));
}

function buildCatalog(): HeroAssetDef[] {
  const seen = new Set<string>();
  const out: HeroAssetDef[] = [];
  for (const a of [
    ...DEFAULT_HERO,
    ...CRYPTO_EXTRAS,
    ...COMMODITY_EXTRAS,
    ...INDEX_EXTRAS,
    ...stockDefs(),
    ...etfDefs(),
  ]) {
    const key = a.yahoo.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export const HERO_CATALOG: HeroAssetDef[] = buildCatalog();

const byYahoo = new Map(HERO_CATALOG.map((a) => [a.yahoo.toUpperCase(), a]));
const byId = new Map(HERO_CATALOG.map((a) => [a.id.toLowerCase(), a]));

export function findHeroAsset(yahooOrId: string): HeroAssetDef | null {
  const raw = String(yahooOrId ?? '').trim();
  if (!raw) return null;
  return byYahoo.get(raw.toUpperCase()) ?? byId.get(raw.toLowerCase()) ?? null;
}

function isHeroDef(v: unknown): v is HeroAssetDef {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.yahoo === 'string' &&
    typeof o.label === 'string' &&
    (o.unit === 'usd' || o.unit === 'oz' || o.unit === 'oil' || o.unit === 'index')
  );
}

/** Always returns exactly 6 valid defs; gaps filled from DEFAULT_HERO. */
export function normalizeHeroLayout(raw: unknown): HeroAssetDef[] {
  const slots: (HeroAssetDef | null)[] = [null, null, null, null, null, null];

  if (Array.isArray(raw)) {
    for (let i = 0; i < 6 && i < raw.length; i++) {
      const item = raw[i];
      if (typeof item === 'string') {
        slots[i] = findHeroAsset(item);
      } else if (isHeroDef(item)) {
        const found = findHeroAsset(item.yahoo) ?? findHeroAsset(item.id);
        if (found) {
          slots[i] = found;
        } else {
          // Accept custom yahoo from a previously saved layout if shape is valid
          slots[i] = {
            id: item.id,
            yahoo: item.yahoo,
            label: item.label,
            name: typeof item.name === 'string' ? item.name : undefined,
            unit: item.unit,
          };
        }
      } else if (item && typeof item === 'object' && typeof (item as { yahoo?: string }).yahoo === 'string') {
        slots[i] = findHeroAsset((item as { yahoo: string }).yahoo);
      }
    }
  }

  const used = new Set<string>();
  const result: HeroAssetDef[] = [];
  for (let i = 0; i < 6; i++) {
    let pick = slots[i];
    if (pick && used.has(pick.yahoo.toUpperCase())) pick = null;
    if (!pick) {
      pick = DEFAULT_HERO.find((d) => !used.has(d.yahoo.toUpperCase())) ?? DEFAULT_HERO[i % DEFAULT_HERO.length]!;
    }
    used.add(pick.yahoo.toUpperCase());
    result.push(pick);
  }
  return result;
}

/** Default Indexes · ETFs row (exact order; matches client INDEX_SYMBOLS). */
export const DEFAULT_INDEXES: HeroAssetDef[] = [
  { id: 'idx-dji', yahoo: '^DJI', label: 'DOW', name: 'Dow Jones Industrial Average', unit: 'index' },
  { id: 'idx-ndx', yahoo: '^NDX', label: 'Nasdaq-100', name: 'Nasdaq-100', unit: 'index' },
  { id: 'idx-qqq', yahoo: 'QQQ', label: 'QQQ', name: 'Invesco QQQ', unit: 'usd' },
  { id: 'idx-bnd', yahoo: 'BND', label: 'BND', name: 'Vanguard Total Bond Market ETF', unit: 'usd' },
  { id: 'idx-vnq', yahoo: 'VNQ', label: 'VNQ', name: 'Vanguard Real Estate ETF', unit: 'usd' },
  { id: 'idx-smh', yahoo: 'SMH', label: 'SMH', name: 'VanEck Semiconductor ETF', unit: 'usd' },
  { id: 'idx-usd', yahoo: 'USD', label: 'USD', name: 'ProShares Ultra Semiconductors', unit: 'usd' },
  { id: 'idx-gltr', yahoo: 'GLTR', label: 'GLTR', name: 'abrdn Physical Precious Metals Basket ETF', unit: 'usd' },
  { id: 'idx-cper', yahoo: 'CPER', label: 'CPER', name: 'United States Copper Index Fund', unit: 'usd' },
  { id: 'idx-copx', yahoo: 'COPX', label: 'COPX', name: 'Global X Copper Miners ETF', unit: 'usd' },
];

const INDEX_SLOT_COUNT = DEFAULT_INDEXES.length;

/** Always returns exactly INDEX_SLOT_COUNT valid defs; gaps filled from DEFAULT_INDEXES. */
export function normalizeIndexLayout(raw: unknown): HeroAssetDef[] {
  const slots: (HeroAssetDef | null)[] = Array.from({ length: INDEX_SLOT_COUNT }, () => null);

  if (Array.isArray(raw)) {
    for (let i = 0; i < INDEX_SLOT_COUNT && i < raw.length; i++) {
      const item = raw[i];
      if (typeof item === 'string') {
        slots[i] = findHeroAsset(item);
      } else if (isHeroDef(item)) {
        const found = findHeroAsset(item.yahoo) ?? findHeroAsset(item.id);
        if (found) {
          slots[i] = found;
        } else {
          slots[i] = {
            id: item.id,
            yahoo: item.yahoo,
            label: item.label,
            name: typeof item.name === 'string' ? item.name : undefined,
            unit: item.unit,
          };
        }
      } else if (item && typeof item === 'object' && typeof (item as { yahoo?: string }).yahoo === 'string') {
        slots[i] = findHeroAsset((item as { yahoo: string }).yahoo);
      }
    }
  }

  const used = new Set<string>();
  const result: HeroAssetDef[] = [];
  for (let i = 0; i < INDEX_SLOT_COUNT; i++) {
    let pick = slots[i];
    if (pick && used.has(pick.yahoo.toUpperCase())) pick = null;
    if (!pick) {
      pick =
        DEFAULT_INDEXES.find((d) => !used.has(d.yahoo.toUpperCase())) ??
        DEFAULT_INDEXES[i % DEFAULT_INDEXES.length]!;
    }
    used.add(pick.yahoo.toUpperCase());
    result.push(pick);
  }
  return result;
}
