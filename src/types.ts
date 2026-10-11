export type MarketQuote = {
  id: string;
  symbol: string;
  label: string;
  name?: string;
  price: number | null;
  changePercent: number | null;
  marketCap?: number | null;
  unit?: string;
  ok: boolean;
  stale?: boolean;
  fallback?: boolean;
  source: 'yahoo' | 'coingecko' | 'fallback';
  /** Optional 1y closes for sparklines (hero + indexes) */
  sparkline?: number[] | null;
};

export type CryptoRow = {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  volume?: number | null;
  ok: boolean;
  stale?: boolean;
  fallback?: boolean;
};

export type BubbleItem = {
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  /** When true, `volume` is already USD (e.g. Binance quoteVolume). */
  volumeIsUsd?: boolean;
  marketCap: number | null;
  ok: boolean;
};

export type BubbleCategory = 'cryptos' | 'solana' | 'stocks' | 'etfs';
export type Timeframe =
  | '1h'
  | '4h'
  | '8h'
  | '12h'
  | '24h'
  | '7d'
  | '30d'
  | '1y';

export type TrendingItem = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price?: number | null;
  rank: number | null;
  score?: number | null;
  marketCapRank?: number | null;
  changePercent: number | null;
  volume?: number | null;
  marketCap?: number | null;
  /** Yahoo ticker when row comes from curated / filter presets */
  yahoo?: string;
  chartKind?: 'crypto' | 'stock' | 'index' | 'hero' | 'etf';
};

export type HeadlineCategory =
  | 'tradfi'
  | 'crypto'
  | 'politics'
  | 'housing'
  | 'web3nfts'
  | 'health'
  | 'longevity'
  | 'technology'
  | 'ai'
  | 'robotics'
  | 'podcasts';

export type HeadlineItem = {
  id: string;
  title: string;
  link: string;
  summary: string;
  image: string | null;
  source: string;
  publishedAt: string | null;
  publishedMs: number | null;
  mediaType?: 'article' | 'video';
};

export type YahooApiQuote = {
  symbol: string;
  requested?: string;
  price: number | null;
  changePercent: number | null;
  marketCap?: number | null;
  currency?: string;
  shortName?: string;
  ok: boolean;
  error?: string;
};

export type YahooApiResponse = {
  quotes: YahooApiQuote[];
  fetchedAt: string;
};
