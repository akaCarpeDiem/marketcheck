import type { TrendingItem } from '../types';
import { DEFAULT_FETCH_MS, fetchSignal } from './fetchTimeout';

export type TrendingTf = '1h' | '4h' | '8h' | '12h' | '24h' | '7d' | '30d' | '1y';

export type TrendingResponse = {
  tf?: TrendingTf;
  limit?: number;
  pumps: TrendingItem[];
  dumps: TrendingItem[];
  items: TrendingItem[];
  note?: string;
  rateLimited?: boolean;
  stale?: boolean;
  source?: string;
  supportedTfs?: TrendingTf[];
  error?: string;
  fetchedAt?: string;
};

export async function fetchTrending(
  tf: TrendingTf,
  signal?: AbortSignal,
  limit: 10 | 25 = 10,
): Promise<TrendingResponse> {
  const qs = new URLSearchParams({ tf, limit: String(limit) });
  const res = await fetch(`/api/trending?${qs}`, { signal: fetchSignal(DEFAULT_FETCH_MS, signal) });
  if (!res.ok) throw new Error(`Trending HTTP ${res.status}`);
  const data = (await res.json()) as TrendingResponse;
  const pumps = Array.isArray(data.pumps) ? data.pumps : [];
  const dumps = Array.isArray(data.dumps) ? data.dumps : [];
  const items =
    Array.isArray(data.items) && data.items.length ? data.items : [...pumps, ...dumps];
  return { ...data, pumps, dumps, items };
}
