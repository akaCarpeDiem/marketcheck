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

import { attachIntraday, recordSnapshot } from './cryptoHistory';
import { cached, type KvLike, type WaitUntil } from './edgeCache';

/** Public CoinGecko list. Also called straight from the browser when this server is turned away (see src/data/market.ts). */
export const CG_MARKETS =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc' +
  '&per_page=250&page=1&sparkline=false&price_change_percentage=1h%2C24h%2C7d%2C30d%2C1y';

const CG_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'MarketCheckDash/1.0 (+https://marketcheck.money)',
};

export type CryptoTf = '1h' | '4h' | '8h' | '24h' | '7d' | '30d' | '1y';
export const CRYPTO_TF_LIST: CryptoTf[] = ['1h', '4h', '8h', '24h', '7d', '30d', '1y'];

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
  /**
   * Percent change per timeframe; null when there is none (new listings have no 1y).
   * 4h and 8h come from the site's own hourly price record (cryptoHistory.ts): absent
   * unless that record is switched on, and null until it reaches back far enough.
   */
  ch: { '1h': number | null; '24h': number | null; '7d': number | null; '30d': number | null; '1y': number | null; '4h'?: number | null; '8h'?: number | null };
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
  'USDC.E', 'BSC-USD', 'OUSG', 'USTB', 'USDA', 'USR', 'USDO', 'USX', 'SATUSD', 'MIM', 'USAT', 'YLDS',
  'REUSD', 'APYUSD', 'USTBL', 'JTRSY', 'JAAA', 'EUTBL', 'JPYC',
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

/**
 * A price that has barely moved over a day, a week and a month is pegged to
 * something: a stablecoin in another currency, or a tokenized fund (treasury
 * bills, private credit) that CoinGecko lists among coins. No freely traded
 * coin outside the very largest is this still for a whole month, so these are
 * grouped with stablecoins. The 30 largest are never judged this way: a quiet
 * month for Bitcoin must not hide Bitcoin.
 */
function barelyMoves(ch: Coin['ch']): boolean {
  const d = ch['24h'];
  const w = ch['7d'];
  const m = ch['30d'];
  if (d == null || w == null || m == null) return false;
  return Math.abs(d) < 0.35 && Math.abs(w) < 0.6 && Math.abs(m) < 1.6;
}

function classify(
  symbol: string,
  name: string,
  price: number | null,
  ch: Coin['ch'],
  rank: number,
): { stable: boolean; wrapped: boolean } {
  const stable =
    STABLE_SYMBOLS.has(symbol) ||
    (price != null && price > 0.97 && price < 1.03 && STABLE_NAME.test(`${name} ${symbol}`)) ||
    (rank > 30 && barelyMoves(ch));
  const wrapped = !stable && (WRAPPED_SYMBOLS.has(symbol) || WRAPPED_NAME.test(name));
  return { stable, wrapped };
}

function toCoin(row: CgRow, index: number): Coin | null {
  if (!row || typeof row.id !== 'string' || typeof row.symbol !== 'string') return null;
  const symbol = row.symbol.toUpperCase();
  const name = row.name || symbol;
  const price = num(row.current_price);
  const ch: Coin['ch'] = {
    '1h': num(row.price_change_percentage_1h_in_currency),
    '24h': num(row.price_change_percentage_24h_in_currency) ?? num(row.price_change_percentage_24h),
    '7d': num(row.price_change_percentage_7d_in_currency),
    '30d': num(row.price_change_percentage_30d_in_currency),
    '1y': num(row.price_change_percentage_1y_in_currency),
  };
  const rank = num(row.market_cap_rank) ?? index + 1;
  const { stable, wrapped } = classify(symbol, name, price, ch, rank);
  const coin: Coin = {
    id: row.id,
    symbol,
    name,
    image: row.image || null,
    rank,
    price,
    marketCap: num(row.market_cap),
    volume: num(row.total_volume),
    ch,
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

/** CoinGecko's rows -> our coins. Shared by the server and the browser fallback. */
export function coinsFromCoinGecko(rows: unknown): Coin[] {
  if (!Array.isArray(rows)) throw new Error('CoinGecko sent an unexpected response');
  const coins: Coin[] = [];
  (rows as CgRow[]).forEach((row, i) => {
    const coin = toCoin(row, i);
    if (coin && coin.price != null) coins.push(coin);
  });
  return coins;
}

/**
 * CoinGecko limits its free API per address, and Cloudflare's outgoing
 * addresses are shared with every other site hosted there, so a 429 here says
 * nothing about how often this site asks. One retry after a pause; then, if a
 * free "demo" key has been set as the secret COINGECKO_API_KEY, once more with
 * the key. The key is only spent when the keyless call is refused.
 */
async function loadFromCoinGecko(url: string, apiKey?: string): Promise<Coin[]> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: CG_HEADERS });
    lastStatus = res.status;
    if (res.ok) return coinsFromCoinGecko(await res.json());
    if (res.status !== 429 || attempt === 1) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  const key = apiKey?.trim();
  if (key && (lastStatus === 429 || lastStatus === 403)) {
    const res = await fetch(url, { headers: { ...CG_HEADERS, 'x-cg-demo-api-key': key } });
    lastStatus = res.status;
    if (res.ok) return coinsFromCoinGecko(await res.json());
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

export type DataEnv = {
  LAYOUTS?: KvLike;
  COINGECKO_API_KEY?: string;
  /**
   * "1" turns on the hourly price record that 4h and 8h changes are worked out
   * from (cryptoHistory.ts). Off unless set: the record is only complete if
   * something loads the site at least once an hour, day and night.
   */
  PRICE_HISTORY?: string;
};

const historyOn = (env: DataEnv | undefined): boolean => /^(1|on|true|yes)$/i.test((env?.PRICE_HISTORY ?? '').trim());

/** Refresh from CoinGecko at most every 2 minutes; keep the last good copy for a day. */
const FRESH_MS = 120_000;

export async function getCryptoUniverse(
  env: DataEnv | undefined,
  waitUntil?: WaitUntil,
): Promise<CryptoUniverse> {
  const hit = await cached<Coin[]>('crypto-universe:v2', {
    freshMs: FRESH_MS,
    keepSec: 86_400,
    load: async () => {
      const coins = await loadFromCoinGecko(CG_MARKETS, env?.COINGECKO_API_KEY);
      const kv = historyOn(env) ? env?.LAYOUTS : undefined;
      const now = Date.now();
      if (kv) await attachIntraday(coins, kv, now, waitUntil).catch(() => undefined);
      if (kv && coins.length >= 50) {
        const job = recordSnapshot(kv, coins, now);
        if (waitUntil) waitUntil(job);
        else await job;
      }
      return coins;
    },
    valid: (coins) => coins.length >= 50,
    waitUntil,
    kv: env?.LAYOUTS ?? null,
    kvKey: 'cache:crypto-universe:v2',
    kvEveryMs: 6 * 3_600_000,
    retryMs: 45_000,
  });
  return { coins: hit.data, at: hit.at, stale: hit.stale, source: 'coingecko' };
}

/** Lists of their own besides the main one: Ethereum and BNB Chain tokens, and layer-2 networks. */
export type Chain = 'eth' | 'bnb' | 'l2';
export const CHAINS: Chain[] = ['eth', 'bnb', 'l2'];

/** Tokens CoinGecko files under each chain's ecosystem category, largest first. Same shape as the main list. */
export const CG_MARKETS_CHAIN: Record<Chain, string> = {
  eth: `${CG_MARKETS}&category=ethereum-ecosystem`,
  bnb: `${CG_MARKETS}&category=binance-smart-chain`,
  l2: `${CG_MARKETS}&category=layer-2`,
};

/** Coins CoinGecko files under a list's category that the site leaves out (Nervos is a layer 1). */
const CHAIN_EXCLUDE: Partial<Record<Chain, Set<string>>> = { l2: new Set(['nervos-network']) };

/** A list's coins without the ones it leaves out. */
export function chainCoins(chain: Chain, coins: Coin[]): Coin[] {
  const out = CHAIN_EXCLUDE[chain];
  return out ? coins.filter((c) => !out.has(c.id)) : coins;
}
export const CG_MARKETS_ETH = CG_MARKETS_CHAIN.eth;

/**
 * The list for a chain's tab ("ETH", "BNB"). Asked for only when someone opens
 * that tab, kept five minutes. 4h and 8h changes are copied from the main list
 * for coins that are in both (the hourly record covers the main list only).
 *
 * The last good list is also written to KV (twice a day at most), so a part of
 * the network that has never fetched it still has an older copy to show when
 * CoinGecko refuses. The browser has two more fallbacks of its own: asking
 * CoinGecko itself, and chainFromMain() below.
 */
export async function getChainUniverse(chain: Chain, env: DataEnv | undefined, waitUntil?: WaitUntil): Promise<CryptoUniverse> {
  const hit = await cached<Coin[]>(`crypto-${chain}:v1`, {
    freshMs: 5 * 60_000,
    keepSec: 86_400,
    load: async () => chainCoins(chain, await loadFromCoinGecko(CG_MARKETS_CHAIN[chain], env?.COINGECKO_API_KEY)),
    valid: (coins) => coins.length >= 20,
    waitUntil,
    kv: env?.LAYOUTS ?? null,
    kvKey: `cache:crypto-${chain}:v1`,
    kvEveryMs: 12 * 3_600_000,
    retryMs: 60_000,
  });
  let coins = chainCoins(chain, hit.data);
  try {
    const main = await getCryptoUniverse(env, waitUntil);
    coins = withIntradayFrom(coins, main.coins);
  } catch {
    /* without the main list the 4h and 8h columns stay empty */
  }
  return { coins, at: hit.at, stale: hit.stale, source: 'coingecko' };
}

export const getEthUniverse = (env: DataEnv | undefined, waitUntil?: WaitUntil): Promise<CryptoUniverse> => getChainUniverse('eth', env, waitUntil);

/**
 * Tokens issued on Ethereum, by CoinGecko id: ether itself, the large DeFi,
 * layer-2, stablecoin and meme tokens. Not the whole ecosystem (CoinGecko's
 * category has thousands) but the ones big enough to be in the top 250.
 * An id that is no longer listed is simply never matched.
 */
const ETH_KNOWN_IDS = new Set([
  'ethereum', 'tether', 'usd-coin', 'dai', 'usds', 'ethena-usde', 'paypal-usd', 'first-digital-usd', 'true-usd', 'frax',
  'ripple-usd', 'usd1-wlfi', 'staked-ether', 'wrapped-steth', 'weth', 'wrapped-bitcoin', 'wrapped-eeth', 'rocket-pool-eth',
  'chainlink', 'uniswap', 'aave', 'maker', 'sky', 'lido-dao', 'ethena', 'ondo-finance', 'pendle', 'morpho', 'eigenlayer',
  'ether-fi', 'curve-dao-token', 'compound-governance-token', 'convex-finance', 'frax-share', 'rocket-pool', 'havven',
  '1inch', 'sushi', 'yearn-finance', 'balancer', 'cow-protocol', 'uma', 'bancor', '0x', 'dydx', 'dydx-chain', 'syrup', 'usual',
  'arbitrum', 'optimism', 'mantle', 'polygon-ecosystem-token', 'matic-network', 'immutable-x', 'starknet', 'zksync', 'linea',
  'scroll', 'taiko', 'metis-token', 'loopring', 'skale', 'gnosis', 'layerzero',
  'shiba-inu', 'pepe', 'floki', 'mog-coin', 'spx6900', 'turbo',
  'worldcoin-wld', 'fetch-ai', 'render-token', 'the-graph', 'quant-network', 'ethereum-name-service', 'livepeer', 'ankr',
  'api3', 'band-protocol', 'ssv-network', 'safe', 'arkham', 'aethir', 'golem', 'storj', 'numeraire', 'iexec-rlc', 'origintrail',
  'threshold-network-token', 'celer-network', 'reserve-rights-token', 'amp-token', 'holotoken', 'mask-network', 'request-network',
  'basic-attention-token', 'decentraland', 'the-sandbox', 'apecoin', 'axie-infinity', 'gala', 'enjincoin', 'chiliz', 'illuvium',
  'blur', 'beam-2', 'world-liberty-financial',
  'leo-token', 'crypto-com-chain', 'okb', 'bitget-token', 'nexo', 'pax-gold', 'tether-gold',
]);

/**
 * Tokens issued on BNB Chain, by CoinGecko id: BNB itself and the large BNB
 * Chain DeFi, exchange and meme tokens. Like the Ethereum set, only the ones
 * big enough to turn up in the top 250.
 */
const BNB_KNOWN_IDS = new Set([
  'binancecoin', 'tether', 'usd-coin', 'first-digital-usd', 'usd1-wlfi', 'binance-usd',
  'pancakeswap-token', 'trust-wallet-token', 'venus', 'aster-2', 'four', 'baby-doge-coin', 'floki', 'safepal',
  'alpaca-finance', 'biswap', 'coin98', 'alchemy-pay', 'mobox', 'bakerytoken', 'apenft', 'listapie', 'lista',
  'world-liberty-financial', 'cheems-token', 'broccoli-714', 'mubarak', 'tst-token', 'bnb48-club-token',
]);

/** CoinGecko ids of well-known layer-2 networks. Stands in for the layer-2 list when CoinGecko cannot be reached. */
export const L2_KNOWN_IDS = new Set<string>([
  'arbitrum', 'optimism', 'mantle', 'polygon-ecosystem-token', 'matic-network', 'immutable-x', 'starknet', 'zksync',
  'linea', 'scroll', 'taiko', 'metis-token', 'loopring', 'skale', 'blast', 'manta-network', 'mode', 'zora', 'celo',
  'lisk', 'boba-network', 'cartesi', 'zircuit', 'merlin-chain', 'bob-build-first', 'hemi', 'sophon', 'kinto',
  'swell-network', 'soon-2', 'morph-l2', 'xai-blockchain',
]);

const KNOWN_IDS: Record<Chain, Set<string>> = { eth: ETH_KNOWN_IDS, bnb: BNB_KNOWN_IDS, l2: L2_KNOWN_IDS };

/**
 * A chain's tokens found in the main list. Shown on that chain's tab when
 * the full list cannot be had from anywhere: fewer tokens, but the same live
 * prices as the rest of the site, so the tab is filled whenever the site has
 * coin prices at all.
 */
export function chainFromMain(chain: Chain, main: Coin[]): Coin[] {
  return main.filter((c) => KNOWN_IDS[chain].has(c.id));
}

export const ethFromMain = (main: Coin[]): Coin[] => chainFromMain('eth', main);

/** Least the main list must offer before its share of a chain stands in for the full list. */
export const CHAIN_FROM_MAIN_MIN: Record<Chain, number> = { eth: 8, bnb: 3, l2: 3 };

/** The coins with the most 24h trading volume (CoinGecko publishes volume for 24h only). */
export function topByVolume(coins: Coin[], limit: number): Coin[] {
  return coins
    .filter((c) => isMoverCandidate(c))
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit);
}

/** Copies of `coins` carrying the 4h and 8h changes of the same coins in `main`. */
export function withIntradayFrom(coins: Coin[], main: Coin[]): Coin[] {
  const byId = new Map(main.map((c) => [c.id, c]));
  return coins.map((c) => {
    const m = byId.get(c.id);
    return { ...c, ch: { ...c.ch, '4h': m?.ch['4h'] ?? null, '8h': m?.ch['8h'] ?? null } };
  });
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

/** A timeframe a saved layout or another tab may ask for -> one this list has. */
export function cryptoTf(tf: string): CryptoTf {
  if ((CRYPTO_TF_LIST as string[]).includes(tf)) return tf as CryptoTf;
  return tf === '6h' || tf === '12h' ? '8h' : '24h';
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
