/** Headlines by category, from /api/headlines (public RSS feeds, gathered server-side). */
import { getJson } from '../lib/api';
import { signal } from '../lib/store';

export type NewsCategory =
  | 'tradfi'
  | 'crypto'
  | 'podcasts'
  | 'politics'
  | 'housing'
  | 'web3nfts'
  | 'health'
  | 'longevity'
  | 'technology'
  | 'ai'
  | 'robotics';

export const NEWS_CATEGORIES: { id: NewsCategory; label: string; short: string }[] = [
  { id: 'tradfi', label: 'Markets & economy', short: 'Markets' },
  { id: 'crypto', label: 'Crypto', short: 'Crypto' },
  { id: 'technology', label: 'Technology', short: 'Tech' },
  { id: 'ai', label: 'AI', short: 'AI' },
  { id: 'politics', label: 'Finance in politics', short: 'Politics' },
  { id: 'housing', label: 'US housing', short: 'Housing' },
  { id: 'podcasts', label: 'Podcasts & video', short: 'Podcasts' },
  { id: 'robotics', label: 'Robotics', short: 'Robotics' },
  { id: 'web3nfts', label: 'Web3 & NFTs', short: 'Web3' },
  { id: 'health', label: 'Health', short: 'Health' },
  { id: 'longevity', label: 'Longevity', short: 'Longevity' },
];

export type Headline = {
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

export type NewsState = {
  items: Headline[];
  at: number;
  status: 'loading' | 'ok' | 'stale' | 'error';
  note: string;
};

type Payload = { items?: Headline[]; stale?: boolean; thin?: boolean; note?: string | null; fetchedAt?: string };

/** Category -> its headlines. A new Map is set on every change. */
export const news = signal<Map<NewsCategory, NewsState>>(new Map());

const FRESH_MS = 6 * 60_000;
const busy = new Map<NewsCategory, Promise<void>>();

/** Only http(s) links are allowed through to the page. */
function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function put(cat: NewsCategory, state: NewsState): void {
  const next = new Map(news.get());
  next.set(cat, state);
  news.set(next);
}

/** Load a category if it is missing or older than six minutes. */
export function loadNews(cat: NewsCategory, force = false): Promise<void> {
  const have = news.get().get(cat);
  if (!force && have && have.status !== 'error' && Date.now() - have.at < FRESH_MS) return Promise.resolve();
  const running = busy.get(cat);
  if (running) return running;
  if (!have) put(cat, { items: [], at: 0, status: 'loading', note: '' });
  const job = (async () => {
    try {
      const d = await getJson<Payload>(`/api/headlines?category=${cat}`, { timeout: 25_000 });
      const items: Headline[] = [];
      for (const raw of d.items ?? []) {
        const link = safeUrl(raw.link);
        if (!link || !raw.title) continue;
        items.push({ ...raw, link, image: safeUrl(raw.image) });
      }
      if (!items.length && have?.items.length) {
        put(cat, { ...have, status: 'stale', at: Date.now() });
      } else {
        put(cat, {
          items,
          at: Date.now(),
          status: items.length ? (d.stale ? 'stale' : 'ok') : 'error',
          note: d.note ?? '',
        });
      }
    } catch {
      const prev = news.get().get(cat);
      put(cat, prev?.items.length ? { ...prev, status: 'stale' } : { items: [], at: Date.now(), status: 'error', note: '' });
    } finally {
      busy.delete(cat);
    }
  })();
  busy.set(cat, job);
  return job;
}
