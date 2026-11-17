/**
 * The news leaderboard: ranked stories per topic from /api/newsboard, plus the
 * "caught up" tracker (story ids read, per New York date, in this browser).
 */
import { addDays, etDate, type BoardName, type BoardResponse, type BoardStory } from '../../functions/_shared/newsBoard';
import { DEFAULT_TOPIC, TOPICS, topicFrom, type TopicId } from '../../functions/_shared/newsTopics';
import { getJson } from '../lib/api';
import { pruneRead, readSet, setRead, type ReadLog } from '../lib/leaderboard';
import { readJson, writeJson } from '../lib/storage';
import { signal } from '../lib/store';

export { DEFAULT_TOPIC, TOPICS, topicFrom, type BoardName, type BoardResponse, type BoardStory, type TopicId };

export type BoardState = {
  data: BoardResponse | null;
  /** The live result before this one, so rank changes between the reader's own refreshes can be shown. */
  previous: BoardResponse | null;
  at: number;
  status: 'loading' | 'ok' | 'error';
};

/** Key -> state. A new Map is set on every change. */
export const boards = signal<Map<string, BoardState>>(new Map());

export const boardKey = (topic: string, board: BoardName, date?: string | null): string => `${topic}:${board}:${date ?? ''}`;

export const LIVE_FRESH_MS = 4.5 * 60_000;
const RETRY_MS = 60_000;
const busy = new Map<string, Promise<void>>();

/** Only http(s) links (and site paths) are allowed through to the page. */
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

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function cleanStory(s: BoardStory): BoardStory | null {
  const link = safeUrl(s.link);
  if (!link || !s.title) return null;
  const sig = s.signals ?? { outlets: 1 };
  return {
    ...s,
    link,
    image: safeUrl(s.image),
    rank: num(s.rank),
    heat: Math.max(0, Math.min(100, num(s.heat))),
    score: num(s.score),
    sweeps: num(s.sweeps),
    outlets: (s.outlets ?? []).flatMap((o) => {
      const l = safeUrl(o.link);
      return l ? [{ ...o, link: l }] : [];
    }),
    signals: {
      outlets: num(sig.outlets) || (s.outlets?.length ?? 1),
      hn: sig.hn && safeUrl(sig.hn.url) ? { ...sig.hn, url: safeUrl(sig.hn.url)! } : undefined,
      reddit: sig.reddit && safeUrl(sig.reddit.url) ? { ...sig.reddit, url: safeUrl(sig.reddit.url)! } : undefined,
      trends: sig.trends,
    },
  };
}

function clean(d: BoardResponse): BoardResponse {
  const stories = (d.stories ?? []).flatMap((s) => {
    const c = cleanStory(s);
    return c ? [c] : [];
  });
  return { ...d, signals: d.signals ?? [], stories, days: Array.isArray(d.days) ? d.days.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) : undefined };
}

function put(key: string, state: BoardState): void {
  const next = new Map(boards.get());
  next.set(key, state);
  boards.set(next);
}

/** Is the copy in hand still good? Live boards for 4.5 minutes; others until their next update. */
export function isFresh(s: BoardState | undefined, now = Date.now()): boolean {
  if (!s || s.status === 'loading') return false;
  if (s.status === 'error' || !s.data) return now - s.at < RETRY_MS;
  if (s.data.board === 'live') return now - s.at < LIVE_FRESH_MS;
  const next = Date.parse(s.data.nextUpdateAt);
  // A finished day does not change; give it an hour. Anything else follows its own next update.
  if (s.data.status === 'final') return now - s.at < 60 * 60_000;
  return now - s.at < RETRY_MS || (Number.isFinite(next) && now < next && now - s.at < 10 * 60_000);
}

/** Load one board. Requests for the same board run once. */
export function loadBoard(topic: TopicId, board: BoardName, date?: string | null, force = false): Promise<void> {
  const key = boardKey(topic, board, date);
  const have = boards.get().get(key);
  if (!force && isFresh(have)) return Promise.resolve();
  const running = busy.get(key);
  if (running) return running;
  if (!have) put(key, { data: null, previous: null, at: 0, status: 'loading' });
  const job = (async () => {
    try {
      const q = `topic=${encodeURIComponent(topic)}&board=${board}${date ? `&date=${encodeURIComponent(date)}` : ''}`;
      const d = clean(await getJson<BoardResponse>(`/api/newsboard?${q}`, { timeout: 25_000 }));
      const prev = boards.get().get(key);
      const old = prev?.data && prev.data.status !== 'empty' && prev.data.generatedAt !== d.generatedAt ? prev.data : (prev?.previous ?? null);
      put(key, { data: d, previous: board === 'live' ? old : null, at: Date.now(), status: 'ok' });
    } catch {
      const prev = boards.get().get(key);
      put(key, prev?.data ? { ...prev, at: Date.now() } : { data: null, previous: null, at: Date.now(), status: 'error' });
    } finally {
      busy.delete(key);
    }
  })();
  busy.set(key, job);
  return job;
}

export const boardState = (topic: string, board: BoardName, date?: string | null): BoardState | undefined =>
  boards.get().get(boardKey(topic, board, date));

/** The New York date a day before today: the one the "yesterday" board shows. */
export const yesterdayEt = (now = Date.now()): string => addDays(etDate(now), -1);

/* ── Caught up ─────────────────────────────────────────────────────────── */

const READ_KEY = 'mc-news-read-v1';
const loadLog = (): ReadLog => pruneRead(readJson<unknown>(READ_KEY, {}), etDate(Date.now()));

let log: ReadLog = loadLog();
/** Ids of stories the reader has read (any of the last three days). */
export const readIds = signal<Set<string>>(readSet(log));

export function markRead(id: string, read = true): void {
  const today = etDate(Date.now());
  log = setRead(pruneRead(log, today), today, id, read);
  writeJson(READ_KEY, log);
  readIds.set(readSet(log));
}

/** Pick up changes made in another tab. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== READ_KEY) return;
    log = loadLog();
    readIds.set(readSet(log));
  });
}
