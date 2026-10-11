import type { HeadlineCategory, HeadlineItem } from '../types';
import { DEFAULT_FETCH_MS, fetchSignal } from './fetchTimeout';

export type { HeadlineCategory };

export type HeadlinesResponse = {
  category: HeadlineCategory;
  items: HeadlineItem[];
  feedsUsed?: string[];
  feedsFailed?: string[];
  thin?: boolean;
  note?: string | null;
  stale?: boolean;
  source?: string;
  error?: string;
  fetchedAt?: string;
};

export async function fetchHeadlines(
  category: HeadlineCategory,
  signal?: AbortSignal,
): Promise<HeadlinesResponse> {
  const qs = new URLSearchParams({ category });
  const res = await fetch(`/api/headlines?${qs}`, { signal: fetchSignal(DEFAULT_FETCH_MS, signal) });
  if (!res.ok) throw new Error(`Headlines HTTP ${res.status}`);
  const data = (await res.json()) as HeadlinesResponse;
  return {
    ...data,
    items: Array.isArray(data.items) ? data.items : [],
    thin: Boolean(data.thin),
    stale: Boolean(data.stale),
  };
}
