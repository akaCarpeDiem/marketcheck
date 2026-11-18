/**
 * News leaderboard: rank news stories per topic by real popularity signals
 * instead of listing recent headlines.
 *
 *   1. Cluster the RSS pool into stories (the same event reported by several outlets).
 *   2. Attach signals: outlet coverage, Hacker News, Reddit, Google Trends.
 *   3. Score. "live" decays with age; "today" and "yesterday" use the best each
 *      signal reached during the day, plus how long a story stayed near the top.
 *   4. Keep a per-day accumulator, a noon snapshot and a final snapshot in KV.
 *
 * Pure logic lives here so it can be tested with fixtures. The HTTP side is
 * functions/api/newsboard.ts. Nothing in this file throws on a failed signal.
 */

import { cached, type KvLike, type WaitUntil } from './edgeCache';
import { topicLabel, type TopicId } from './newsTopics';
import { outletOf, type HeadlineItem } from './rssHeadlines';
import { illustrate } from './storyImage';

/* ── Tuning knobs ─────────────────────────────────────────────────────────── */

export const SCORE = {
  /** coverage = base + log * log2(outlets) */
  coverageBase: 5,
  coverageLog: 10,
  /** hn = k * log10(1 + points + comments) */
  hn: 8,
  reddit: 8,
  /** trends = k * log10(traffic) */
  trends: 4,
  /** Live score halves every this many hours of story age. */
  halfLifeHours: 18,
  /** Day score: bonus per recorded sweep (capped), and for the best rank reached. */
  sweepBonus: 1.5,
  sweepCap: 12,
  peakRankCeil: 11,
  peakRankDiv: 2,
};

export const TIMING = {
  responseFreshMs: 10 * 60_000,
  hnFreshMs: 20 * 60_000,
  redditFreshMs: 20 * 60_000,
  trendsFreshMs: 30 * 60_000,
  /** At most one accumulator write per topic in this time (KV free tier: 1000 writes a day for the whole site). */
  accWriteEveryMs: 60 * 60_000,
  kvTtlSec: 14 * 86_400,
  fetchTimeoutMs: 9_000,
  poolTimeoutMs: 25_000,
};

export const LIMITS = {
  boardSize: 10,
  accStories: 60,
  /** Only the top of each sweep is recorded in the accumulator. */
  accRecord: 30,
  accOutlets: 8,
  hnWindowHours: 36,
  hnMinPoints: 15,
  daysShown: 7,
  daysKept: 14,
};

export const KV_PREFIX = 'newsboard:v1:';
export const TREND_GEOS = ['US', 'GB', 'IN', 'CA', 'AU'] as const;
export const REDDIT_UA = 'MarketCheck/1.0 (+https://marketcheck.money)';

export const REDDIT_SUBS: Record<TopicId, string[]> = {
  markets: ['economics', 'stocks', 'StockMarket'],
  investing: ['investing', 'stocks', 'ValueInvesting', 'wallstreetbets'],
  'personal-finance': ['personalfinance', 'financialindependence', 'povertyfinance'],
  crypto: ['CryptoCurrency', 'Bitcoin', 'ethereum', 'solana'],
  'real-estate': ['RealEstate', 'REBubble', 'realestateinvesting'],
  technology: ['technology', 'artificial', 'singularity', 'hardware'],
  policy: ['politics', 'Economics', 'law'],
  business: ['business', 'Entrepreneur', 'economy'],
  commodities: ['energy', 'oil', 'Gold', 'commodities'],
  healthcare: ['health', 'medicine', 'biotech', 'longevity'],
};

export const SIGNAL_INFO = [
  { id: 'coverage', label: 'Coverage', about: 'How many different news outlets ran the story.' },
  { id: 'hn', label: 'Hacker News', about: 'Hacker News points and comments in the last 36 hours.' },
  { id: 'reddit', label: 'Reddit', about: 'Reddit score and comments in the topic’s main subreddits over the last day.' },
  { id: 'trends', label: 'Google Trends', about: 'Search traffic for matching daily trending searches in the US, UK, India, Canada and Australia.' },
] as const;

/* ── Types ────────────────────────────────────────────────────────────────── */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Outlet = { source: string; title: string; link: string; publishedAt: string | null };
export type HnSignal = { points: number; comments: number; url: string };
export type RedditSignal = { score: number; comments: number; url: string; sub: string };
export type TrendSignal = { query: string; traffic: number; geo: string };
export type StorySignals = { outlets: number; hn?: HnSignal; reddit?: RedditSignal; trends?: TrendSignal };

export type SignalMeta = { id: 'coverage' | 'hn' | 'reddit' | 'trends'; label: string; ok: boolean; about: string };

export type BoardStory = {
  id: string;
  rank: number;
  prevRank: number | null;
  title: string;
  link: string;
  source: string;
  image: string | null;
  summary: string;
  publishedAt: string | null;
  score: number;
  heat: number;
  firstSeenAt: string | null;
  peakRank: number | null;
  sweeps: number;
  outlets: Outlet[];
  signals: StorySignals;
};

export type BoardName = 'live' | 'today' | 'yesterday' | 'day';
export type BoardStatus = 'live' | 'final' | 'provisional' | 'empty';

export type BoardResponse = {
  topic: string;
  label: string;
  board: BoardName;
  date: string;
  status: BoardStatus;
  generatedAt: string;
  nextUpdateAt: string;
  lockedAt?: string;
  signals: SignalMeta[];
  days?: string[];
  stories: BoardStory[];
};

/** A story as kept in the accumulator and used for day-level ranking. */
export type AccStory = {
  id: string;
  title: string;
  link: string;
  source: string;
  image: string | null;
  summary: string;
  publishedAt: string | null;
  outlets: Outlet[];
  signals: StorySignals;
  sweeps: number;
  firstSeenAt: string | null;
  peakRank: number | null;
  lastRank: number | null;
  /** Significant tokens of the lead title, for matching a later sighting. */
  tokens: string[];
};

export type Acc = { date: string; topic: string; updatedAt: number; stories: AccStory[] };
export type Snapshot = { date: string; topic: string; lockedAt: string; signals: SignalMeta[]; stories: BoardStory[] };

/* ── Tokens, URLs, same-story rule ────────────────────────────────────────── */

const STOP = new Set(
  (
    'a an the and or but nor of to in on at for with from by as is are was were be been being am it its this that these those ' +
    'his her their our your you we they he she them than then there here what which who whom whose why how when where will would ' +
    'could should can may might must do does did done has have had not no so if into over after before about out up down off more ' +
    'most also just very amid per via vs new says say said saying report reports reported update updates updated live news today ' +
    'latest breaking watch exclusive analysis opinion explained'
  ).split(/\s+/),
);

/** Lowercase, punctuation-free, significant tokens of a headline (unique, in order). */
export function tokenize(title: string): string[] {
  const plain = String(title ?? '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of plain.split(' ')) {
    if (!raw || STOP.has(raw)) continue;
    let t = raw;
    if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
    else if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
    if (t.length < 3 || STOP.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Two headlines tell the same story: 3+ shared tokens covering half the shorter one, or a Jaccard of 0.4. */
export function sameStory(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const sb = new Set(b);
  let shared = 0;
  for (const t of a) if (sb.has(t)) shared++;
  if (shared < 2) return false;
  const overlap = shared / Math.min(a.length, b.length);
  if (shared >= 3 && overlap >= 0.5) return true;
  const jaccard = shared / (a.length + b.length - shared);
  return jaccard >= 0.4;
}

/**
 * Canonical form of a link: lowercase host without www, path without a trailing
 * slash, no query or hash, no scheme. '' when it is not an http(s) link.
 */
export function canonicalUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return '';
  }
}

/** A canonical link that points at an article, not at a site's front page. */
const urlKey = (raw: unknown): string => {
  const c = canonicalUrl(raw);
  return c.includes('/') ? c : '';
};

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Stable id: short hash of the five longest significant tokens of the lead title, sorted. */
export function storyId(title: string): string {
  const toks = tokenize(title);
  const top = [...toks].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, 5).sort();
  return fnv(top.join('|') || String(title).toLowerCase());
}

/* ── Clustering ───────────────────────────────────────────────────────────── */

export type Cluster = {
  lead: HeadlineItem;
  items: HeadlineItem[];
  outlets: Outlet[];
  /** Tokens of each member's title. */
  tokenSets: string[][];
  /** Tokens of every member's title together. */
  allTokens: Set<string>;
  urlKeys: Set<string>;
  /** Earliest publication among members (ms). */
  earliestMs: number | null;
};

export function clusterPool(pool: HeadlineItem[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const it of pool) {
    if (!it || !it.title || !isHttp(it.link)) continue;
    const toks = tokenize(it.title);
    const key = urlKey(it.link);
    let home: Cluster | undefined;
    for (const c of clusters) {
      if ((key && c.urlKeys.has(key)) || c.tokenSets.some((t) => sameStory(toks, t))) {
        home = c;
        break;
      }
    }
    if (!home) {
      home = { lead: it, items: [], outlets: [], tokenSets: [], allTokens: new Set(), urlKeys: new Set(), earliestMs: null };
      clusters.push(home);
    }
    home.items.push(it);
    home.tokenSets.push(toks);
    for (const t of toks) home.allTokens.add(t);
    if (key) home.urlKeys.add(key);
    if (it.publishedMs != null && (home.earliestMs == null || it.publishedMs < home.earliestMs)) home.earliestMs = it.publishedMs;
    const outlet = outletOf(it.source);
    if (!home.outlets.some((o) => outletOf(o.source) === outlet)) {
      home.outlets.push({ source: it.source, title: it.title, link: it.link, publishedAt: it.publishedAt ?? null });
    }
  }
  return clusters;
}

/* ── Signal fetchers ──────────────────────────────────────────────────────── */

export type SignalOpts = {
  fetchFn: FetchLike;
  waitUntil?: WaitUntil;
  /** Added to cache keys; lets tests keep their fixtures apart. */
  ns?: string;
};

async function fetchText(fetchFn: FetchLike, url: string, headers?: Record<string, string>): Promise<string> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMING.fetchTimeoutMs) : null;
  try {
    const res = await fetchFn(url, { headers, signal: ctl?.signal });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return await res.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ExternalPost = { title: string; url: string | null; a: number; b: number; link: string; sub?: string };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function parseHn(json: unknown): ExternalPost[] {
  const hits = (json as { hits?: unknown[] })?.hits;
  if (!Array.isArray(hits)) throw new Error('unexpected Hacker News payload');
  const out: ExternalPost[] = [];
  for (const h of hits as Record<string, unknown>[]) {
    const title = typeof h.title === 'string' ? h.title : '';
    const id = typeof h.objectID === 'string' ? h.objectID : '';
    if (!title || !id) continue;
    out.push({
      title,
      url: typeof h.url === 'string' ? h.url : null,
      a: num(h.points),
      b: num(h.num_comments),
      link: `https://news.ycombinator.com/item?id=${id}`,
    });
  }
  return out;
}

export function parseReddit(json: unknown): ExternalPost[] {
  const kids = (json as { data?: { children?: unknown[] } })?.data?.children;
  if (!Array.isArray(kids)) throw new Error('unexpected Reddit payload');
  const out: ExternalPost[] = [];
  for (const k of kids as { data?: Record<string, unknown> }[]) {
    const d = k?.data;
    if (!d || typeof d.title !== 'string' || typeof d.permalink !== 'string') continue;
    out.push({
      title: d.title,
      url: typeof d.url_overridden_by_dest === 'string' ? d.url_overridden_by_dest : typeof d.url === 'string' ? d.url : null,
      a: num(d.score),
      b: num(d.num_comments),
      link: `https://www.reddit.com${d.permalink}`,
      sub: typeof d.subreddit === 'string' ? d.subreddit : '',
    });
  }
  return out;
}

/** One request for every topic, shared for 20 minutes. Throws when it cannot be read. */
export async function fetchHn(opts: SignalOpts, now: number): Promise<ExternalPost[]> {
  const since = Math.floor(now / 1000) - LIMITS.hnWindowHours * 3600;
  const url =
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>${since},points>${LIMITS.hnMinPoints}&hitsPerPage=500`;
  const hit = await cached<ExternalPost[]>(`newsboard:hn:v1${opts.ns ?? ''}`, {
    freshMs: TIMING.hnFreshMs,
    keepSec: 6 * 3600,
    retryMs: 60_000,
    waitUntil: opts.waitUntil,
    load: async () => parseHn(JSON.parse(await fetchText(opts.fetchFn, url))),
  });
  return hit.data;
}

/** One request per topic. Reddit often turns cloud addresses away; the caller carries on without it. */
export async function fetchReddit(topic: TopicId, opts: SignalOpts): Promise<ExternalPost[]> {
  const subs = REDDIT_SUBS[topic].join('+');
  const url = `https://www.reddit.com/r/${subs}/top.json?t=day&limit=100`;
  const hit = await cached<ExternalPost[]>(`newsboard:reddit:v1:${topic}${opts.ns ?? ''}`, {
    freshMs: TIMING.redditFreshMs,
    keepSec: 6 * 3600,
    retryMs: 2 * 60_000,
    waitUntil: opts.waitUntil,
    load: async () => parseReddit(JSON.parse(await fetchText(opts.fetchFn, url, { 'User-Agent': REDDIT_UA, Accept: 'application/json' }))),
  });
  return hit.data;
}

export type Trend = { query: string; traffic: number; urls: string[]; geo: string };

/** "200K+" -> 200000, "1M+" -> 1000000, "2,000+" -> 2000. 0 when unreadable. */
export function parseTraffic(raw: unknown): number {
  const m = /([\d][\d,]*(?:\.\d+)?)\s*([kmb])?/i.exec(String(raw ?? ''));
  if (!m) return 0;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return Math.round(n * mult);
}

const unxml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

function tagText(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? unxml(m[1]!) : '';
}

/** Google Trends daily-trending RSS: the search query, its traffic and the news links under it. */
export function parseTrendsRss(xml: string, geo: string): Trend[] {
  const out: Trend[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const query = tagText(block, 'title');
    if (!query) continue;
    const urls: string[] = [];
    for (const n of block.matchAll(/<ht:news_item_url(?:\s[^>]*)?>([\s\S]*?)<\/ht:news_item_url>/gi)) {
      const u = unxml(n[1]!);
      if (isHttp(u)) urls.push(u);
    }
    out.push({ query, traffic: parseTraffic(tagText(block, 'ht:approx_traffic')), urls, geo });
  }
  return out;
}

/** One geo, shared for 30 minutes. Each geo is cached on its own so one failure does not drop the rest. */
export async function fetchTrendsGeo(geo: string, opts: SignalOpts): Promise<Trend[]> {
  const url = `https://trends.google.com/trending/rss?geo=${geo}`;
  const hit = await cached<Trend[]>(`newsboard:trends:v1:${geo}${opts.ns ?? ''}`, {
    freshMs: TIMING.trendsFreshMs,
    keepSec: 6 * 3600,
    retryMs: 2 * 60_000,
    waitUntil: opts.waitUntil,
    load: async () => {
      const xml = await fetchText(opts.fetchFn, url);
      if (!/<rss|<feed/i.test(xml)) throw new Error('not a feed');
      return parseTrendsRss(xml, geo);
    },
  });
  return hit.data;
}

/* ── Matching signals to stories ──────────────────────────────────────────── */

const clusterMatchesPost = (c: Cluster, postTokens: string[], postUrl: string): boolean =>
  (!!postUrl && c.urlKeys.has(postUrl)) || c.tokenSets.some((t) => sameStory(postTokens, t));

/** For every cluster, the best-scoring matching post (by a+b), or undefined. */
export function matchPosts(clusters: Cluster[], posts: ExternalPost[]): (ExternalPost | undefined)[] {
  const prepared = posts.map((p) => ({ p, toks: tokenize(p.title), key: urlKey(p.url) }));
  return clusters.map((c) => {
    let best: ExternalPost | undefined;
    for (const { p, toks, key } of prepared) {
      if (!clusterMatchesPost(c, toks, key)) continue;
      if (!best || p.a + p.b > best.a + best.b) best = p;
    }
    return best;
  });
}

export function matchTrends(clusters: Cluster[], trends: Trend[]): (TrendSignal | undefined)[] {
  const prepared = trends.map((t) => ({ t, toks: t.query.length >= 4 ? tokenize(t.query) : [], keys: t.urls.map(urlKey).filter(Boolean) }));
  return clusters.map((c) => {
    let best: TrendSignal | undefined;
    for (const { t, toks, keys } of prepared) {
      const byUrl = keys.some((k) => c.urlKeys.has(k));
      const byWords = toks.length >= 1 && toks.every((w) => c.allTokens.has(w));
      if (!byUrl && !byWords) continue;
      if (!best || t.traffic > best.traffic) best = { query: t.query, traffic: t.traffic, geo: t.geo };
    }
    return best;
  });
}

export type Gathered = {
  hn: (HnSignal | undefined)[];
  reddit: (RedditSignal | undefined)[];
  trends: (TrendSignal | undefined)[];
  ok: { hn: boolean; reddit: boolean; trends: boolean };
};

/** Fetch every external signal at once. A failure marks that signal not ok and nothing else. */
export async function gatherSignals(clusters: Cluster[], topic: TopicId, opts: SignalOpts, now: number): Promise<Gathered> {
  const [hn, reddit, ...geos] = await Promise.allSettled([
    fetchHn(opts, now),
    fetchReddit(topic, opts),
    ...TREND_GEOS.map((g) => fetchTrendsGeo(g, opts)),
  ]);
  const hnPosts = hn.status === 'fulfilled' ? hn.value : [];
  const redditPosts = reddit.status === 'fulfilled' ? reddit.value : [];
  const trends: Trend[] = [];
  let trendsOk = false;
  for (const g of geos) {
    if (g.status === 'fulfilled') {
      trendsOk = true;
      trends.push(...(g.value as Trend[]));
    }
  }
  return {
    hn: matchPosts(clusters, hnPosts).map((p) => (p ? { points: p.a, comments: p.b, url: p.link } : undefined)),
    reddit: matchPosts(clusters, redditPosts).map((p) => (p ? { score: p.a, comments: p.b, url: p.link, sub: p.sub ?? '' } : undefined)),
    trends: matchTrends(clusters, trends),
    ok: { hn: hn.status === 'fulfilled', reddit: reddit.status === 'fulfilled', trends: trendsOk },
  };
}

export function signalMeta(ok: Partial<Record<'hn' | 'reddit' | 'trends', boolean>>): SignalMeta[] {
  return SIGNAL_INFO.map((s) => ({ id: s.id, label: s.label, about: s.about, ok: s.id === 'coverage' ? true : ok[s.id] === true }));
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

export const coverageScore = (outlets: number): number => SCORE.coverageBase + SCORE.coverageLog * Math.log2(Math.max(1, outlets));
export const hnScore = (s?: HnSignal): number => (s ? SCORE.hn * Math.log10(1 + s.points + s.comments) : 0);
export const redditScore = (s?: RedditSignal): number => (s ? SCORE.reddit * Math.log10(1 + s.score + s.comments) : 0);
export const trendsScore = (s?: TrendSignal): number => (s && s.traffic > 1 ? SCORE.trends * Math.log10(s.traffic) : 0);

/** Sum of the four signal parts, no time decay. */
export function baseScore(s: StorySignals): number {
  return coverageScore(s.outlets) + hnScore(s.hn) + redditScore(s.reddit) + trendsScore(s.trends);
}

/** Live: the sum, halved every `halfLifeHours` of age. */
export function liveScore(s: StorySignals, ageHours: number): number {
  return baseScore(s) * Math.pow(0.5, Math.max(0, ageHours) / SCORE.halfLifeHours);
}

/** Day / final: best each signal reached, no decay, plus staying power and the best rank reached. */
export function dayScore(s: StorySignals, sweeps: number, peakRank: number | null): number {
  const stay = SCORE.sweepBonus * Math.min(Math.max(0, sweeps), SCORE.sweepCap);
  const peak = peakRank == null ? 0 : Math.max(0, SCORE.peakRankCeil - peakRank) / SCORE.peakRankDiv;
  return baseScore(s) + stay + peak;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
export const heatOf = (score: number, top: number): number => (top > 0 ? Math.max(0, Math.round((100 * score) / top)) : 0);

/** Larger value of each signal field. */
export function mergeSignals(a: StorySignals, b?: StorySignals): StorySignals {
  if (!b) return a;
  const out: StorySignals = { outlets: Math.max(a.outlets, b.outlets) };
  const hn = a.hn && b.hn ? { points: Math.max(a.hn.points, b.hn.points), comments: Math.max(a.hn.comments, b.hn.comments), url: (b.hn.points > a.hn.points ? b.hn : a.hn).url } : (a.hn ?? b.hn);
  if (hn) out.hn = hn;
  const rd =
    a.reddit && b.reddit
      ? { score: Math.max(a.reddit.score, b.reddit.score), comments: Math.max(a.reddit.comments, b.reddit.comments), ...pickRedditMeta(a.reddit, b.reddit) }
      : (a.reddit ?? b.reddit);
  if (rd) out.reddit = rd;
  const tr = a.trends && b.trends ? (b.trends.traffic > a.trends.traffic ? b.trends : a.trends) : (a.trends ?? b.trends);
  if (tr) out.trends = tr;
  return out;
}
const pickRedditMeta = (a: RedditSignal, b: RedditSignal) => {
  const w = b.score > a.score ? b : a;
  return { url: w.url, sub: w.sub };
};

/* ── America/New_York time ────────────────────────────────────────────────── */

const etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function etParts(ms: number): { date: string; hour: number; minute: number } {
  const p: Record<string, string> = {};
  for (const x of etFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) };
}
export const etDate = (ms: number): string => etParts(ms).date;
export const etHour = (ms: number): number => etParts(ms).hour;

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Offset of New York from UTC at an instant, in ms (negative). */
function etOffset(ms: number): number {
  const p = etParts(ms);
  const [y, m, d] = p.date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, p.hour, p.minute, 0);
  return wall - Math.floor(ms / 60_000) * 60_000;
}

/** The instant (ms) at which New York's clock reads `hour:minute` on `date`. */
export function etWallToMs(date: string, hour = 0, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0);
  const first = wall - etOffset(wall);
  return wall - etOffset(first);
}

export const isDateKey = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function nextEtMidnight(now: number): number {
  return etWallToMs(addDays(etDate(now), 1), 0, 0);
}
export function nextEtNoon(now: number): number {
  const today = etDate(now);
  const noon = etWallToMs(today, 12, 0);
  return now < noon ? noon : etWallToMs(addDays(today, 1), 12, 0);
}

/* ── KV with an in-memory fallback ────────────────────────────────────────── */

const memKv = new Map<string, string>();
export const memoryKv: KvLike = {
  async get(key) {
    return memKv.get(key) ?? null;
  },
  async put(key, value) {
    memKv.set(key, value);
  },
};

export const accKey = (date: string, topic: string) => `${KV_PREFIX}acc:${date}:${topic}`;
export const noonKey = (date: string, topic: string) => `${KV_PREFIX}noon:${date}:${topic}`;
export const finalKey = (date: string, topic: string) => `${KV_PREFIX}final:${date}:${topic}`;
export const daysKey = (topic: string) => `${KV_PREFIX}days:${topic}`;

async function kvRead<T>(kv: KvLike, key: string): Promise<T | null> {
  try {
    const raw = await kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
async function kvWrite(kv: KvLike, key: string, value: unknown): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: TIMING.kvTtlSec });
  } catch {
    /* write allowance used up, or KV down: the board still works */
  }
}

/* ── Candidates, accumulator ──────────────────────────────────────────────── */

export type Candidate = {
  cluster: Cluster;
  signals: StorySignals;
  tokens: string[];
  id: string;
  publishedMs: number | null;
};

export function buildCandidates(clusters: Cluster[], g: Gathered | null): Candidate[] {
  return clusters.map((cluster, i) => {
    const signals: StorySignals = { outlets: cluster.outlets.length };
    const hn = g?.hn[i];
    const rd = g?.reddit[i];
    const tr = g?.trends[i];
    if (hn) signals.hn = hn;
    if (rd) signals.reddit = rd;
    if (tr) signals.trends = tr;
    return { cluster, signals, tokens: tokenize(cluster.lead.title), id: storyId(cluster.lead.title), publishedMs: cluster.earliestMs ?? cluster.lead.publishedMs ?? null };
  });
}

/** The accumulated story that is this one, by id, link or headline. */
export function findAccStory(acc: Acc | null, c: { id: string; tokens: string[]; urlKeys?: Set<string> }): AccStory | undefined {
  if (!acc) return undefined;
  return (
    acc.stories.find((s) => s.id === c.id) ??
    acc.stories.find((s) => (c.urlKeys && c.urlKeys.size && c.urlKeys.has(urlKey(s.link))) || sameStory(c.tokens, s.tokens))
  );
}

const iso = (ms: number): string => new Date(ms).toISOString();

function mergeOutlets(a: Outlet[], b: Outlet[]): Outlet[] {
  const out = [...a];
  for (const o of b) if (!out.some((x) => outletOf(x.source) === outletOf(o.source))) out.push(o);
  return out.slice(0, LIMITS.accOutlets);
}

/** A candidate as an accumulator-shaped story, merged with what was already kept. */
export function candidateEntry(c: Candidate, prev: AccStory | undefined, rank: number | null, nowMs: number, counted: boolean): AccStory {
  const lead = c.cluster.lead;
  return {
    id: prev?.id ?? c.id,
    title: lead.title,
    link: lead.link,
    source: lead.source,
    // The lead's picture, else any other outlet's for the same story.
    image: safeImage(lead.image) ?? c.cluster.items.map((it) => safeImage(it.image)).find(Boolean) ?? prev?.image ?? null,
    summary: lead.summary ?? '',
    publishedAt: c.publishedMs != null ? iso(c.publishedMs) : (lead.publishedAt ?? null),
    outlets: mergeOutlets(c.cluster.outlets.slice(0, LIMITS.accOutlets), prev?.outlets ?? []),
    signals: mergeSignals(c.signals, prev?.signals),
    sweeps: (prev?.sweeps ?? 0) + (counted ? 1 : 0),
    firstSeenAt: prev?.firstSeenAt ?? (counted ? iso(nowMs) : null),
    peakRank: rank != null ? Math.min(prev?.peakRank ?? Infinity, rank) : (prev?.peakRank ?? null),
    lastRank: counted ? rank : (prev?.lastRank ?? null),
    tokens: c.tokens,
  };
}

/**
 * Fold one sweep into the day's accumulator. `ranked` is the live ranking,
 * best first. Returns the same accumulator untouched when it was written less
 * than `accWriteEveryMs` ago (`written: false`).
 */
export function recordSweep(
  prev: Acc | null,
  date: string,
  topic: string,
  ranked: Candidate[],
  nowMs: number,
  force = false,
): { acc: Acc; written: boolean } {
  const base: Acc = prev ?? { date, topic, updatedAt: 0, stories: [] };
  if (!force && prev && nowMs - prev.updatedAt < TIMING.accWriteEveryMs) return { acc: prev, written: false };
  const stories = base.stories.map((s) => ({ ...s }));
  const touched = new Set<string>();
  ranked.slice(0, LIMITS.accRecord).forEach((c, i) => {
    const idx = stories.findIndex((s) => s.id === c.id || sameStory(c.tokens, s.tokens) || (c.cluster.urlKeys.has(urlKey(s.link)) && urlKey(s.link) !== ''));
    const old = idx >= 0 ? stories[idx] : undefined;
    if (old && touched.has(old.id)) return;
    const entry = candidateEntry(c, old, i + 1, nowMs, true);
    touched.add(entry.id);
    if (idx >= 0) stories[idx] = entry;
    else stories.push(entry);
  });
  stories.sort((a, b) => dayScore(b.signals, b.sweeps, b.peakRank) - dayScore(a.signals, a.sweeps, a.peakRank));
  return { acc: { date, topic, updatedAt: nowMs, stories: stories.slice(0, LIMITS.accStories) }, written: true };
}

/* ── Building output ──────────────────────────────────────────────────────── */

const safeImage = (u: unknown): string | null => (isHttp(u) || (typeof u === 'string' && /^\/(?!\/)/.test(u)) ? (u as string) : null);

/** Rank accumulator-shaped stories by day score and shape the best ten for the response. */
export function rankDayStories(entries: AccStory[], prevRanks?: Map<string, number>): BoardStory[] {
  const scored = entries
    .filter((e) => isHttp(e.link))
    .map((e) => ({ e, score: dayScore(e.signals, e.sweeps, e.peakRank) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMITS.boardSize);
  return shape(scored, prevRanks);
}

function shape(scored: { e: AccStory; score: number }[], prevRanks?: Map<string, number>): BoardStory[] {
  const top = scored[0]?.score ?? 0;
  return scored.map(({ e, score }, i) => ({
    id: e.id,
    rank: i + 1,
    prevRank: prevRanks?.get(e.id) ?? null,
    title: e.title,
    link: e.link,
    source: e.source,
    image: safeImage(e.image),
    summary: e.summary ?? '',
    publishedAt: e.publishedAt,
    score: round1(score),
    heat: heatOf(score, top),
    firstSeenAt: e.firstSeenAt,
    peakRank: e.peakRank,
    sweeps: e.sweeps,
    outlets: e.outlets.filter((o) => isHttp(o.link)),
    signals: e.signals,
  }));
}

/* ── The board ────────────────────────────────────────────────────────────── */

export type BoardDeps = {
  topic: TopicId;
  board: BoardName;
  /** Only for board=day. */
  date?: string;
  sweep?: boolean;
  now?: number;
  kv?: KvLike | null;
  fetchFn: FetchLike;
  /** URL of this request; the pool is fetched from /api/headlines on the same origin. */
  origin: string;
  waitUntil?: WaitUntil;
  ns?: string;
};

export async function fetchPool(topic: TopicId, origin: string, fetchFn: FetchLike): Promise<HeadlineItem[]> {
  const url = new URL(`/api/headlines?topic=${encodeURIComponent(topic)}&pool=1`, origin).toString();
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), TIMING.poolTimeoutMs) : null;
  try {
    const res = await fetchFn(url, { signal: ctl?.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { pool?: HeadlineItem[]; items?: HeadlineItem[] };
    const list = Array.isArray(body.pool) ? body.pool : Array.isArray(body.items) ? body.items : [];
    return list.filter((it) => it && typeof it.title === 'string' && it.mediaType !== 'video' && isHttp(it.link));
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function head(d: BoardDeps, now: number, board: BoardName, date: string) {
  return { topic: d.topic, label: topicLabel(d.topic), board, date, generatedAt: iso(now) };
}

/** Never throws: whatever is missing just shows up as a thinner board. */
export async function buildBoard(d: BoardDeps): Promise<BoardResponse> {
  try {
    return await buildBoardInner(d);
  } catch (e) {
    const now = d.now ?? Date.now();
    console.error('newsboard failed', e);
    const date = etDate(now);
    return { ...head(d, now, d.board, date), status: 'empty', nextUpdateAt: iso(now + TIMING.responseFreshMs), signals: signalMeta({}), stories: [] };
  }
}

async function buildBoardInner(d: BoardDeps): Promise<BoardResponse> {
  const now = d.now ?? Date.now();
  const kv = d.kv ?? memoryKv;
  const topic = d.topic;
  const today = etDate(now);
  const yesterday = addDays(today, -1);
  const midnightToday = etWallToMs(today, 0, 0);
  const midnightYesterday = etWallToMs(yesterday, 0, 0);
  const pending: Promise<unknown>[] = [];
  const defer = (p: Promise<unknown>) => {
    if (d.waitUntil) d.waitUntil(p);
    else pending.push(p);
  };
  const finish = async <T>(v: T): Promise<T> => {
    await Promise.all(pending);
    return v;
  };
  /** Stories without a picture get their article's preview picture (cached per article; see storyImage.ts). */
  const pics = (stories: BoardStory[]): Promise<BoardStory[]> => illustrate(stories, { fetchFn: d.fetchFn, waitUntil: d.waitUntil });
  const respond = async (r: BoardResponse): Promise<BoardResponse> => finish(r.stories.length ? { ...r, stories: await pics(r.stories) } : r);

  const memo = new Map<string, Promise<unknown>>();
  const read = <T>(key: string): Promise<T | null> => {
    if (!memo.has(key)) memo.set(key, kvRead<T>(kv, key));
    return memo.get(key) as Promise<T | null>;
  };
  const write = (key: string, value: unknown) => {
    memo.set(key, Promise.resolve(value));
    defer(kvWrite(kv, key, value));
  };

  /* Archive: only stored snapshots. */
  if (d.board === 'day') {
    const date = isDateKey(d.date) ? d.date : yesterday;
    const [snap, days] = await Promise.all([read<Snapshot>(finalKey(date, topic)), read<string[]>(daysKey(topic))]);
    const list = (Array.isArray(days) ? days : []).filter(isDateKey).sort().reverse().slice(0, LIMITS.daysShown);
    return respond({
      ...head(d, now, 'day', date),
      status: snap?.stories?.length ? 'final' : 'empty',
      nextUpdateAt: iso(nextEtMidnight(now)),
      ...(snap ? { lockedAt: snap.lockedAt } : {}),
      signals: snap?.signals ?? signalMeta({}),
      days: list,
      stories: snap?.stories ?? [],
    });
  }

  /* Quick answers from a stored snapshot, when this is not a sweep. */
  if (!d.sweep && d.board === 'yesterday') {
    const snap = await read<Snapshot>(finalKey(yesterday, topic));
    if (snap?.stories?.length) {
      return respond({ ...head(d, now, 'yesterday', yesterday), status: 'final', nextUpdateAt: iso(nextEtMidnight(now)), lockedAt: snap.lockedAt, signals: snap.signals, stories: snap.stories });
    }
  }
  if (!d.sweep && d.board === 'today') {
    const snap = await read<Snapshot>(noonKey(today, topic));
    if (snap?.stories?.length) {
      return respond({ ...head(d, now, 'today', today), status: 'final', nextUpdateAt: iso(nextEtMidnight(now)), lockedAt: snap.lockedAt, signals: snap.signals, stories: snap.stories });
    }
  }

  /* Gather. */
  const poolItems = await fetchPool(topic, d.origin, d.fetchFn);
  const clusters = clusterPool(poolItems);
  const sig = await gatherSignals(clusters, topic, { fetchFn: d.fetchFn, waitUntil: d.waitUntil, ns: d.ns }, now);
  const meta = signalMeta(sig.ok);
  const cands = buildCandidates(clusters, sig);
  const accToday = await read<Acc>(accKey(today, topic));

  /* Live ranking: stories from the last 24 hours, decayed by age. */
  const dayAgo = now - 24 * 3_600_000;
  const liveRanked = cands
    .filter((c) => isHttp(c.cluster.lead.link) && (c.publishedMs == null || c.publishedMs >= dayAgo))
    .map((c) => ({ c, score: liveScore(c.signals, c.publishedMs == null ? 0 : (now - c.publishedMs) / 3_600_000) }))
    .sort((a, b) => b.score - a.score);
  const liveCands = liveRanked.map((x) => x.c);
  const liveRankOf = new Map(liveCands.map((c, i) => [c, i + 1] as const));

  const prevRanks = new Map<string, number>();
  const entryOf = (c: Candidate): AccStory => {
    const prev = findAccStory(accToday, { id: c.id, tokens: c.tokens, urlKeys: c.cluster.urlKeys });
    if (prev?.lastRank != null) prevRanks.set(prev.id, prev.lastRank);
    return candidateEntry(c, prev, liveRankOf.get(c) ?? null, now, false);
  };

  /* Side effects: accumulator, noon snapshot, yesterday's final. */
  if (liveCands.length) {
    const { acc, written } = recordSweep(accToday, today, topic, liveCands, now);
    if (written) write(accKey(today, topic), acc);
  }

  const todayEntries = (): AccStory[] => {
    const fromPool = cands.filter((c) => isHttp(c.cluster.lead.link) && c.publishedMs != null && c.publishedMs >= midnightToday).map(entryOf);
    const seen = new Set(fromPool.map((e) => e.id));
    const fromAcc = (accToday?.stories ?? []).filter((s) => !seen.has(s.id) && !fromPool.some((e) => sameStory(e.tokens, s.tokens)) && s.publishedAt && Date.parse(s.publishedAt) >= midnightToday);
    return [...fromPool, ...fromAcc];
  };

  let noon = await read<Snapshot>(noonKey(today, topic));
  if (!noon && etHour(now) >= 12) {
    const stories = rankDayStories(todayEntries());
    if (stories.length) {
      noon = { date: today, topic, lockedAt: iso(now), signals: meta, stories: await pics(stories.map((s) => ({ ...s, prevRank: null }))) };
      write(noonKey(today, topic), noon);
    }
  }

  let fin = await read<Snapshot>(finalKey(yesterday, topic));
  if (!fin) {
    const accY = await read<Acc>(accKey(yesterday, topic));
    if (accY?.stories.length) {
      const inDay = accY.stories.filter((s) => {
        const t = s.publishedAt ? Date.parse(s.publishedAt) : NaN;
        return Number.isNaN(t) || (t >= midnightYesterday && t < midnightToday);
      });
      const stories = rankDayStories(inDay);
      if (stories.length) {
        const accMeta = signalMeta({
          hn: inDay.some((s) => s.signals.hn),
          reddit: inDay.some((s) => s.signals.reddit),
          trends: inDay.some((s) => s.signals.trends),
        });
        fin = { date: yesterday, topic, lockedAt: iso(now), signals: accMeta, stories: await pics(stories) };
        write(finalKey(yesterday, topic), fin);
        defer(
          (async () => {
            const days = (await kvRead<string[]>(kv, daysKey(topic))) ?? [];
            const next = [...new Set([yesterday, ...days.filter(isDateKey)])].sort().reverse().slice(0, LIMITS.daysKept);
            await kvWrite(kv, daysKey(topic), next);
          })(),
        );
      }
    }
  }

  /* Respond. */
  const empty = (board: BoardName, date: string, next: number): BoardResponse => ({
    ...head(d, now, board, date),
    status: 'empty',
    nextUpdateAt: iso(next),
    signals: meta,
    stories: [],
  });

  if (d.board === 'live') {
    // Live shows the signals as they are now; staying power (sweeps, peak) still comes from the day so far.
    const scored = liveRanked.slice(0, LIMITS.boardSize).map(({ c, score }) => ({ e: { ...entryOf(c), signals: c.signals }, score }));
    const stories = shape(scored, prevRanks);
    return respond(
      stories.length
        ? { ...head(d, now, 'live', today), status: 'live', nextUpdateAt: iso(now + TIMING.responseFreshMs), signals: meta, stories }
        : empty('live', today, now + TIMING.responseFreshMs),
    );
  }

  if (d.board === 'today') {
    if (noon?.stories.length) {
      return respond({ ...head(d, now, 'today', today), status: 'final', nextUpdateAt: iso(nextEtMidnight(now)), lockedAt: noon.lockedAt, signals: noon.signals, stories: noon.stories });
    }
    const stories = rankDayStories(todayEntries(), prevRanks);
    return respond(
      stories.length
        ? { ...head(d, now, 'today', today), status: 'provisional', nextUpdateAt: iso(etHour(now) >= 12 ? now + TIMING.responseFreshMs : nextEtNoon(now)), signals: meta, stories }
        : empty('today', today, etHour(now) >= 12 ? now + TIMING.responseFreshMs : nextEtNoon(now)),
    );
  }

  // yesterday
  if (fin?.stories.length) {
    return respond({ ...head(d, now, 'yesterday', yesterday), status: 'final', nextUpdateAt: iso(nextEtMidnight(now)), lockedAt: fin.lockedAt, signals: fin.signals, stories: fin.stories });
  }
  const yEntries = cands
    .filter((c) => isHttp(c.cluster.lead.link) && c.publishedMs != null && c.publishedMs >= midnightYesterday && c.publishedMs < midnightToday)
    .map((c) => candidateEntry(c, undefined, liveRankOf.get(c) ?? null, now, false));
  const stories = rankDayStories(yEntries);
  return respond(
    stories.length
      ? { ...head(d, now, 'yesterday', yesterday), status: 'provisional', nextUpdateAt: iso(nextEtMidnight(now)), signals: meta, stories }
      : empty('yesterday', yesterday, nextEtMidnight(now)),
  );
}
