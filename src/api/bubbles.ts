import type { BubbleCategory, BubbleItem, Timeframe } from '../types';
import { DEFAULT_FETCH_MS, fetchSignal } from './fetchTimeout';

export type BubblesResponse = {
  category: BubbleCategory;
  tf: Timeframe;
  items: BubbleItem[];
  effectiveTf?: string;
  tfLabel?: string;
  note?: string | null;
  limitation?: string;
  error?: string;
  rateLimited?: boolean;
  stale?: boolean;
  fetchedAt?: string;
};

export async function fetchBubbles(
  category: BubbleCategory,
  tf: Timeframe,
  signal?: AbortSignal,
): Promise<BubblesResponse> {
  const qs = new URLSearchParams({ category, tf, limit: '50' });
  const res = await fetch(`/api/bubbles?${qs}`, { signal: fetchSignal(DEFAULT_FETCH_MS, signal) });
  if (!res.ok) throw new Error(`Bubbles HTTP ${res.status}`);
  const data = (await res.json()) as BubblesResponse;
  return {
    ...data,
    items: Array.isArray(data.items) ? data.items : [],
  };
}
