/**
 * Headlines by topic (from /api/headlines) and the podcast directory (from
 * /api/podcasts). The topics and content types are defined once, in
 * functions/_shared/newsTopics.ts.
 */
import {
  DEFAULT_TOPIC,
  TOPICS,
  topicFrom,
  type ContentType,
  type PodcastShow,
  type TopicId,
} from '../../functions/_shared/newsTopics';
import { getJson } from '../lib/api';
import { signal } from '../lib/store';

export { DEFAULT_TOPIC, TOPICS, topicFrom, type ContentType, type TopicId };
/** Kept as a name for the topic id; older parts of the code call it a category. */
export type NewsCategory = TopicId;
export const NEWS_CATEGORIES = TOPICS;

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
  /** Topic the item is filed under. */
  topic?: TopicId | null;
  /** Article, video or podcast episode: independent of the topic. */
  type?: ContentType;
  /** For a podcast episode, the show's id in the directory. */
  show?: string;
  views?: number | null;
};

/** The content type of an item, whichever generation of the API it came from. */
export const typeOf = (h: Headline): ContentType => h.type ?? (h.mediaType === 'video' ? 'video' : 'article');

export type NewsState = {
  items: Headline[];
  at: number;
  status: 'loading' | 'ok' | 'stale' | 'error';
  note: string;
};

type Payload = { items?: Headline[]; stale?: boolean; thin?: boolean; note?: string | null; fetchedAt?: string };

/** Topic -> its headlines. A new Map is set on every change. */
export const news = signal<Map<TopicId, NewsState>>(new Map());

const FRESH_MS = 6 * 60_000;
const busy = new Map<TopicId, Promise<void>>();

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

function clean(list: Headline[] | undefined): Headline[] {
  const items: Headline[] = [];
  for (const raw of list ?? []) {
    const link = safeUrl(raw.link);
    if (!link || !raw.title) continue;
    items.push({ ...raw, link, image: safeUrl(raw.image) });
  }
  return items;
}

function put(topic: TopicId, state: NewsState): void {
  const next = new Map(news.get());
  next.set(topic, state);
  news.set(next);
}

/** Load a topic if it is missing or older than six minutes. */
export function loadNews(topic: TopicId, force = false): Promise<void> {
  const have = news.get().get(topic);
  if (!force && have && have.status !== 'error' && Date.now() - have.at < FRESH_MS) return Promise.resolve();
  const running = busy.get(topic);
  if (running) return running;
  if (!have) put(topic, { items: [], at: 0, status: 'loading', note: '' });
  const job = (async () => {
    try {
      const d = await getJson<Payload>(`/api/headlines?topic=${topic}`, { timeout: 25_000 });
      const items = clean(d.items);
      if (!items.length && have?.items.length) {
        put(topic, { ...have, status: 'stale', at: Date.now() });
      } else {
        put(topic, {
          items,
          at: Date.now(),
          status: items.length ? (d.stale ? 'stale' : 'ok') : 'error',
          note: d.note ?? '',
        });
      }
    } catch {
      const prev = news.get().get(topic);
      put(topic, prev?.items.length ? { ...prev, status: 'stale' } : { items: [], at: Date.now(), status: 'error', note: '' });
    } finally {
      busy.delete(topic);
    }
  })();
  busy.set(topic, job);
  return job;
}

/* ── Podcast directory ─────────────────────────────────────────────────── */

export type Show = PodcastShow & { url: string; episodes: Headline[] };

export type PodcastState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  shows: Show[];
  latest: Headline[];
  /** Topics that have at least one show, in the site's order. */
  topics: { id: TopicId; label: string; short: string }[];
  at: number;
};

export const podcasts = signal<PodcastState>({ status: 'idle', shows: [], latest: [], topics: [], at: 0 });

type PodcastPayload = { ok?: boolean; shows?: Show[]; latest?: Headline[]; topics?: PodcastState['topics'] };

let podcastsBusy: Promise<void> | null = null;

/** Load the directory unless a copy from the last twenty minutes is in hand. */
export function loadPodcasts(): Promise<void> {
  const have = podcasts.get();
  if (have.status === 'ok' && Date.now() - have.at < 20 * 60_000) return Promise.resolve();
  podcastsBusy ??= (async () => {
    if (have.status !== 'ok') podcasts.set({ ...have, status: 'loading' });
    try {
      const d = await getJson<PodcastPayload>('/api/podcasts', { timeout: 25_000 });
      const shows = (d.shows ?? [])
        .map((s) => ({ ...s, url: safeUrl(s.url) ?? '#', episodes: clean(s.episodes) }))
        .filter((s) => s.episodes.length > 0);
      if (!shows.length) throw new Error('empty');
      podcasts.set({ status: 'ok', shows, latest: clean(d.latest), topics: d.topics ?? [], at: Date.now() });
    } catch {
      podcasts.set({ ...podcasts.get(), status: podcasts.get().shows.length ? 'ok' : 'error' });
    }
  })().finally(() => {
    podcastsBusy = null;
  });
  return podcastsBusy;
}
