import { DEFAULT_FETCH_MS, fetchSignal } from './fetchTimeout';
import type { CryptoRow } from '../types';

/** Fetch a wide top-markets page so L1 filtering can still fill Top 25. */
/** Curated CoinGecko ids for layer-1 base assets (no stables/L2s/memes/DeFi). */
export const L1_ALLOWLIST = new Set<string>([
  'bitcoin',
  'ethereum',
  'solana',
  'binancecoin',
  'ripple',
  'cardano',
  'avalanche-2',
  'tron',
  'toncoin',
  'the-open-network',
  'polkadot',
  'near',
  'internet-computer',
  'aptos',
  'sui',
  'stellar',
  'hedera-hashgraph',
  'litecoin',
  'bitcoin-cash',
  'cosmos',
  'injective-protocol',
  'celestia',
  'sei-network',
  'algorand',
  'elrond-erd-2',
  'fantom',
  'sonic-3',
  'kaspa',
  'stacks',
  'filecoin',
  'tezos',
  'eos',
  'vechain',
  'theta-token',
  'flow',
  'mina-protocol',
  'coredaoorg',
  'conflux-token',
  'kadena',
  'zilliqa',
  'harmony',
  'secret',
  'oasis-network',
  'akash-network',
  'thorchain',
  'berachain-bera',
  'hyperliquid',
  'kaia',
  'klay-token',
  'flare-networks',
  'iota',
  'helium',
  'monero',
  'zcash',
  'dash',
  'neo',
  'qtum',
  'waves',
  'icon',
  'ontology',
  'nervos-network',
  'casper-network',
  'aleo',
  'movement',
  'ronin',
  'canto',
  'kava',
  'osmosis',
  'terra-luna-2',
  'crypto-com-chain',
]);

/** Hardcoded fallback if CoinGecko is unreachable (illustrative placeholders) */
export const CRYPTO_FALLBACK: CryptoRow[] = [
  { rank: 1, id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: null, price: 67421, changePercent: 0, marketCap: 1.32e12, ok: false, fallback: true },
  { rank: 2, id: 'ethereum', symbol: 'ETH', name: 'Ethereum', image: null, price: 3450, changePercent: 0, marketCap: 4.15e11, ok: false, fallback: true },
  { rank: 3, id: 'tether', symbol: 'USDT', name: 'Tether', image: null, price: 1, changePercent: 0, marketCap: 1.2e11, ok: false, fallback: true },
  { rank: 4, id: 'binancecoin', symbol: 'BNB', name: 'BNB', image: null, price: 580, changePercent: 0, marketCap: 8.5e10, ok: false, fallback: true },
  { rank: 5, id: 'solana', symbol: 'SOL', name: 'Solana', image: null, price: 145, changePercent: 0, marketCap: 6.5e10, ok: false, fallback: true },
  { rank: 6, id: 'usd-coin', symbol: 'USDC', name: 'USDC', image: null, price: 1, changePercent: 0, marketCap: 3.5e10, ok: false, fallback: true },
  { rank: 7, id: 'ripple', symbol: 'XRP', name: 'XRP', image: null, price: 0.55, changePercent: 0, marketCap: 3.0e10, ok: false, fallback: true },
  { rank: 8, id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', image: null, price: 0.12, changePercent: 0, marketCap: 1.7e10, ok: false, fallback: true },
  { rank: 9, id: 'cardano', symbol: 'ADA', name: 'Cardano', image: null, price: 0.45, changePercent: 0, marketCap: 1.6e10, ok: false, fallback: true },
  { rank: 10, id: 'tron', symbol: 'TRX', name: 'TRON', image: null, price: 0.14, changePercent: 0, marketCap: 1.2e10, ok: false, fallback: true },
  { rank: 11, id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', image: null, price: 28, changePercent: 0, marketCap: 1.1e10, ok: false, fallback: true },
  { rank: 12, id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu', image: null, price: 0.000018, changePercent: 0, marketCap: 1.05e10, ok: false, fallback: true },
  { rank: 13, id: 'toncoin', symbol: 'TON', name: 'Toncoin', image: null, price: 5.2, changePercent: 0, marketCap: 1.3e10, ok: false, fallback: true },
  { rank: 14, id: 'chainlink', symbol: 'LINK', name: 'Chainlink', image: null, price: 14, changePercent: 0, marketCap: 8.5e9, ok: false, fallback: true },
  { rank: 15, id: 'polkadot', symbol: 'DOT', name: 'Polkadot', image: null, price: 6.5, changePercent: 0, marketCap: 9e9, ok: false, fallback: true },
  { rank: 16, id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', image: null, price: 380, changePercent: 0, marketCap: 7.5e9, ok: false, fallback: true },
  { rank: 17, id: 'uniswap', symbol: 'UNI', name: 'Uniswap', image: null, price: 8, changePercent: 0, marketCap: 5e9, ok: false, fallback: true },
  { rank: 18, id: 'litecoin', symbol: 'LTC', name: 'Litecoin', image: null, price: 75, changePercent: 0, marketCap: 5.5e9, ok: false, fallback: true },
  { rank: 19, id: 'near', symbol: 'NEAR', name: 'NEAR Protocol', image: null, price: 5, changePercent: 0, marketCap: 5.2e9, ok: false, fallback: true },
  { rank: 20, id: 'internet-computer', symbol: 'ICP', name: 'Internet Computer', image: null, price: 8, changePercent: 0, marketCap: 3.8e9, ok: false, fallback: true },
  { rank: 21, id: 'stellar', symbol: 'XLM', name: 'Stellar', image: null, price: 0.12, changePercent: 0, marketCap: 3.5e9, ok: false, fallback: true },
  { rank: 22, id: 'hedera-hashgraph', symbol: 'HBAR', name: 'Hedera', image: null, price: 0.08, changePercent: 0, marketCap: 3.2e9, ok: false, fallback: true },
  { rank: 23, id: 'aptos', symbol: 'APT', name: 'Aptos', image: null, price: 7, changePercent: 0, marketCap: 3.1e9, ok: false, fallback: true },
  { rank: 24, id: 'sui', symbol: 'SUI', name: 'Sui', image: null, price: 1.5, changePercent: 0, marketCap: 2.8e9, ok: false, fallback: true },
  { rank: 25, id: 'cosmos', symbol: 'ATOM', name: 'Cosmos', image: null, price: 8, changePercent: 0, marketCap: 2.5e9, ok: false, fallback: true },
];

export async function fetchTopCryptos(signal?: AbortSignal): Promise<CryptoRow[]> {
  const res = await fetch('/api/cryptos', {
    signal: fetchSignal(DEFAULT_FETCH_MS, signal),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Crypto HTTP ${res.status}`);
  const json = (await res.json()) as { items?: CryptoRow[]; error?: string };
  if (!json.items?.length) {
    throw new Error(json.error || 'No crypto rows');
  }
  return json.items.map((r, i) => ({
    ...r,
    rank: r.rank ?? i + 1,
    ok: r.ok ?? r.price != null,
    fallback: false,
    stale: !!r.stale,
  }));
}

export function filterL1Cryptos(rows: CryptoRow[]): CryptoRow[] {
  return rows
    .filter((r) => L1_ALLOWLIST.has(r.id))
    .sort((a, b) => {
      const am = a.marketCap;
      const bm = b.marketCap;
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return bm - am;
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
