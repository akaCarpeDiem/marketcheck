/**
 * Solana movers from Jupiter's verified token list (free, no key). Jupiter
 * publishes price change and buy/sell volume for 1h, 6h and 24h windows.
 *
 * Only tokens with real size are ranked: a market cap of at least $2M and a
 * minimum traded volume for the window. Without those floors the list fills
 * with dust tokens whose percentages mean nothing.
 */
import { cached } from './edgeCache';

export type SolanaMoverRow = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  changePercent: number | null;
  /** Buy + sell volume in USD over the window. */
  volume: number | null;
  volumeIsUsd: true;
  marketCap: number | null;
  ok: boolean;
};

type JupStats = { priceChange?: number; buyVolume?: number; sellVolume?: number };

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
};

/** What we keep from each token: the full list is several MB. */
type Slim = {
  id: string;
  s: string;
  n: string;
  i: string | null;
  p: number | null;
  m: number | null;
  /** [change %, volume USD] per window */
  h1: [number, number] | null;
  h6: [number, number] | null;
  h24: [number, number] | null;
};

const UA = { Accept: 'application/json', 'User-Agent': 'MarketCheckDash/1.0 (+https://marketcheck.money)' };

const STABLE = new Set([
  'USDC', 'USDT', 'USD1', 'PYUSD', 'DAI', 'USDS', 'USDE', 'FDUSD', 'TUSD', 'FRAX', 'EURC', 'JLUSDC',
  'CUSD', 'USDG', 'USDY', 'SUSD', 'UXD', 'USDH', 'ZUSD',
]);
const WRAPPED = /\b(wrapped|staked|bridged|wormhole|portal|liquid staking)\b/i;
const WRAPPED_SYMBOLS = new Set([
  'WBTC', 'WETH', 'CBBTC', 'TBTC', 'ZBTC', 'JITOSOL', 'MSOL', 'BNSOL', 'JUPSOL', 'BSOL', 'INF', 'JLP',
  'DSOL', 'HSOL', 'VSOL', 'BBSOL', 'STSOL', 'LST',
]);

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function pack(s?: JupStats): [number, number] | null {
  if (!s || !fin(s.priceChange)) return null;
  return [s.priceChange, Math.max(0, (s.buyVolume ?? 0) + (s.sellVolume ?? 0))];
}

async function loadVerified(): Promise<Slim[]> {
  const res = await fetch('https://lite-api.jup.ag/tokens/v2/tag?query=verified', { headers: UA });
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
  const json = (await res.json()) as JupToken[];
  if (!Array.isArray(json)) throw new Error('Jupiter sent an unexpected response');
  const out: Slim[] = [];
  for (const t of json) {
    const sym = (t.symbol || '').toUpperCase();
    if (!sym || !t.id) continue;
    if (STABLE.has(sym) || WRAPPED_SYMBOLS.has(sym)) continue;
    if ((t.tags || []).some((x) => /stable/i.test(x))) continue;
    const name = t.name || sym;
    if (WRAPPED.test(name)) continue;
    if (!fin(t.mcap) || t.mcap < 2_000_000) continue;
    out.push({
      id: t.id,
      s: sym,
      n: name,
      i: t.icon ?? null,
      p: fin(t.usdPrice) ? t.usdPrice : null,
      m: t.mcap,
      h1: pack(t.stats1h),
      h6: pack(t.stats6h),
      h24: pack(t.stats24h),
    });
  }
  return out;
}

export const SOLANA_TFS = ['1h', '6h', '24h'] as const;
export type SolanaTf = (typeof SOLANA_TFS)[number];

/** Jupiter has 1h, 6h and 24h. Anything else maps to the nearest of those. */
export function solanaTf(tf: string): SolanaTf {
  if (tf === '1h') return '1h';
  if (tf === '6h' || tf === '4h' || tf === '8h' || tf === '12h') return '6h';
  return '24h';
}

/** Least traded volume (USD) in the window for a token to be ranked. */
const MIN_VOLUME: Record<SolanaTf, number> = { '1h': 60_000, '6h': 250_000, '24h': 750_000 };

export async function getSolanaMovers(
  tf: string,
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
  const eff = solanaTf(tf);
  const hit = await cached<Slim[]>('solana-verified:v1', {
    freshMs: 150_000,
    keepSec: 6 * 3600,
    load: loadVerified,
    valid: (rows) => rows.length >= 20,
    retryMs: 45_000,
  });
  const key = eff === '1h' ? 'h1' : eff === '6h' ? 'h6' : 'h24';
  const rows = hit.data
    .filter((t) => t[key] != null && t[key]![1] >= MIN_VOLUME[eff] && t.p != null)
    .sort((a, b) => Math.abs(b[key]![0]) - Math.abs(a[key]![0]) || b[key]![1] - a[key]![1])
    .slice(0, limit)
    .map(
      (t): SolanaMoverRow => ({
        id: `solana:${t.id}`,
        symbol: t.s,
        name: t.n,
        image: t.i,
        price: t.p,
        changePercent: t[key]![0],
        volume: t[key]![1],
        volumeIsUsd: true,
        marketCap: t.m,
        ok: true,
      }),
    );
  return {
    items: rows,
    effectiveTf: eff,
    tfLabel: eff,
    note: eff !== tf ? `Solana data comes in 1h, 6h and 24h windows; showing ${eff}.` : null,
    limitation:
      `Jupiter verified tokens with a market cap of at least $2M and at least ` +
      `$${(MIN_VOLUME[eff] / 1000).toFixed(0)}k traded in the window.`,
    rateLimited: false,
    stale: hit.stale,
  };
}
