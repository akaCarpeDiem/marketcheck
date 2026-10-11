/**
 * The crypto universe: the 250 largest coins by market cap from CoinGecko, in
 * one request, with 1h / 24h / 7d / 30d / 1y changes for each.
 *
 * Every crypto view (top table, movers, bubbles) is cut from this one list, so
 * they always agree with each other. Movers are ranked only among coins that
 * are real, liquid markets: stablecoins and wrapped/staked copies of other
 * coins are left out, and so is anything with thin trading.
 *
 * (Before this, movers came from exchange tickers ranked by percent change
 * with no liquidity floor, which surfaced delisted pairs showing -99%.)
 */

import { cached, type KvLike, type WaitUntil } from './edgeCache';

const CG_MARKETS =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc' +
  '&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C30d%2C1y';

const CG_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'MarketCheckDash/1.0 (+https://marketcheck.money)',
};

export type CryptoTf = '1h' | '24h' | '7d' | '30d' | '1y';
export const CRYPTO_TF_LIST: CryptoTf[] = ['1h', '24h', '7d', '30d', '1y'];

export type Coin = {
  /** CoinGecko id, e.g. "bitcoin". */
  id: string;
  /** Upper-case ticker. */
  symbol: string;
  name: string;
  image: string | null;
  /** Market-cap rank (1 = largest). */
  rank: number;
  price: number | null;
  marketCap: number | null;
  /** 24h traded volume in USD. */
  volume: number | null;
  /** Percent change per timeframe; null when CoinGecko has none (new listings have no 1y). */
  ch: Record<CryptoTf, number | null>;
  high24: number | null;
  low24: number | null;
  /** All-time high and how far below it the price is (percent, negative). */
  ath: number | null;
  athChange: number | null;
  supply: number | null;
  /** 1 = stablecoin */
  stable?: 1;
  /** 1 = wrapped, staked or bridged copy of another coin */
  wrapped?: 1;
};

type CgRow = {
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  current_price?: number | null;
  market_cap?: number | null;
  market_cap_rank?: number | null;
  total_volume?: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  ath?: number | null;
  ath_change_percentage?: number | null;
  circulating_supply?: number | null;
  price_change_percentage_24h?: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  price_change_percentage_1y_in_currency?: number | null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const STABLE_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'USDS', 'USDE', 'FDUSD', 'PYUSD', 'TUSD', 'USD1', 'USDD', 'FRAX', 'FRXUSD',
  'GUSD', 'USDP', 'LUSD', 'RLUSD', 'BUSD', 'USD0', 'USDG', 'USDX', 'USDB', 'USDL', 'USDF', 'USDTB',
  'BFUSD', 'USYC', 'USDY', 'BUIDL', 'EURC', 'EURS', 'EURT', 'CRVUSD', 'GHO', 'DOLA', 'SUSD', 'USDT0',
  'USDC.E', 'BSC-USD', 'OUSG', 'USTB', 'USDA', 'USR', 'USDO', 'USX', 'SATUSD', 'MIM',
]);

const WRAPPED_SYMBOLS = new Set([
  'WBTC', 'WETH', 'WBNB', 'WEETH', 'WSTETH', 'STETH', 'RETH', 'CBBTC', 'CBETH', 'METH', 'EZETH',
  'RSETH', 'WBETH', 'BETH', 'LBTC', 'SOLVBTC', 'TBTC', 'FBTC', 'BTCB', 'JITOSOL', 'MSOL', 'BNSOL',
  'JUPSOL', 'SUSDE', 'SUSDS', 'SDAI', 'EETH', 'OSETH', 'SWETH', 'ETHX', 'LSETH', 'CMETH', 'STSOL',
  'WTRX', 'WHYPE', 'KHYPE', 'STHYPE', 'WSOL', 'WAVAX', 'SAVAX', 'STKAAVE', 'CLBTC', 'EBTC', 'PUMPBTC',
  'UNIBTC', 'ENZOBTC', 'XSOLVBTC', 'TETH', 'RSWETH', 'PUFETH', 'WFLR', 'SFRXETH', 'FRXETH', 'ANKRETH',
  'BBSOL', 'DSOL', 'INF', 'JLP',
]);

const WRAPPED_NAME = /\b(wrapped|staked|restaked|bridged|liquid staking|staking pool|peg(?:ged)?)\b/i;
const STABLE_NAME = /usd|dollar|stable|\beur/i;

function classify(symbol: string, name: string, price: number | null): { stable: boolean; wrapped: boolean } {
  const stable =
    STABLE_SYMBOLS.has(symbol) ||
    (price != null && price > 0.97 && price < 1.03 && STABLE_NAME.test(`${name} ${symbol}`));
  const wrapped = !stable && (WRAPPED_SYMBOLS.has(symbol) || WRAPPED_NAME.test(name));
  return { stable, wrapped };
}

function toCoin(row: CgRow, index: number): Coin | null {
  if (!row || typeof row.id !== 'string' || typeof row.symbol !== 'string') return null;
  const symbol = row.symbol.toUpperCase();
  const name = row.name || symbol;
  const price = num(row.current_price);
  const { stable, wrapped } = classify(symbol, name, price);
  const coin: Coin = {
    id: row.id,
    symbol,
    name,
    image: row.image || null,
    rank: num(row.market_cap_rank) ?? index + 1,
    price,
    marketCap: num(row.market_cap),
    volume: num(row.total_volume),
    ch: {
      '1h': num(row.price_change_percentage_1h_in_currency),
      '24h': num(row.price_change_percentage_24h_in_currency) ?? num(row.price_change_percentage_24h),
      '7d': num(row.price_change_percentage_7d_in_currency),
      '30d': num(row.price_change_percentage_30d_in_currency),
      '1y': num(row.price_change_percentage_1y_in_currency),
    },
    high24: num(row.high_24h),
    low24: num(row.low_24h),
    ath: num(row.ath),
    athChange: num(row.ath_change_percentage),
    supply: num(row.circulating_supply),
  };
  if (stable) coin.stable = 1;
  if (wrapped) coin.wrapped = 1;
  return coin;
}

async function loadFromCoinGecko(): Promise<Coin[]> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(CG_MARKETS, { headers: CG_HEADERS });
    lastStatus = res.status;
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (!res.ok) break;
    const rows = (await res.json()) as CgRow[];
    if (!Array.isArray(rows)) throw new Error('CoinGecko sent an unexpected response');
    const coins: Coin[] = [];
    rows.forEach((row, i) => {
      const coin = toCoin(row, i);
      if (coin && coin.price != null) coins.push(coin);
    });
    return coins;
  }
  throw new Error(`CoinGecko HTTP ${lastStatus}`);
}

export type CryptoUniverse = {
  coins: Coin[];
  /** When CoinGecko was last read (ms). */
  at: number;
  /** True when CoinGecko is failing and this is an older copy. */
  stale: boolean;
  source: 'coingecko';
};

export type DataEnv = { LAYOUTS?: KvLike };

/** Refresh from CoinGecko at most every 2 minutes; keep the last good copy for a day. */
const FRESH_MS = 120_000;

export async function getCryptoUniverse(
  env: DataEnv | undefined,
  waitUntil?: WaitUntil,
): Promise<CryptoUniverse> {
  const hit = await cached<Coin[]>('crypto-universe:v1', {
    freshMs: FRESH_MS,
    keepSec: 86_400,
    load: loadFromCoinGecko,
    valid: (coins) => coins.length >= 50,
    waitUntil,
    kv: env?.LAYOUTS ?? null,
    kvKey: 'cache:crypto-universe:v1',
    kvEveryMs: 2 * 3_600_000,
    retryMs: 45_000,
  });
  return { coins: hit.data, at: hit.at, stale: hit.stale, source: 'coingecko' };
}

/** Least 24h volume (USD) for a coin to count as a mover. */
export const MOVER_MIN_VOLUME = 2_000_000;

/** Coins that may appear in movers lists and on the bubble map. */
export function isMoverCandidate(c: Coin): boolean {
  if (c.stable || c.wrapped) return false;
  if (c.price == null || c.price <= 0) return false;
  if (c.marketCap == null || c.marketCap <= 0) return false;
  return (c.volume ?? 0) >= MOVER_MIN_VOLUME;
}

/** Saved layouts may hold 4h/8h/12h, which CoinGecko does not publish. They show 24h. */
export function cryptoTf(tf: string): CryptoTf {
  return (CRYPTO_TF_LIST as string[]).includes(tf) ? (tf as CryptoTf) : '24h';
}

/** The coins that moved most (either direction) over a timeframe. */
export function topMovers(coins: Coin[], tf: CryptoTf, limit: number): Coin[] {
  return coins
    .filter((c) => isMoverCandidate(c) && c.ch[tf] != null)
    .sort((a, b) => Math.abs(b.ch[tf]!) - Math.abs(a.ch[tf]!) || (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit);
}

export function gainersAndLosers(
  coins: Coin[],
  tf: CryptoTf,
  limit: number,
): { gainers: Coin[]; losers: Coin[] } {
  const pool = coins.filter((c) => isMoverCandidate(c) && c.ch[tf] != null);
  const gainers = pool
    .filter((c) => c.ch[tf]! > 0)
    .sort((a, b) => b.ch[tf]! - a.ch[tf]!)
    .slice(0, limit);
  const losers = pool
    .filter((c) => c.ch[tf]! < 0)
    .sort((a, b) => a.ch[tf]! - b.ch[tf]!)
    .slice(0, limit);
  return { gainers, losers };
}
