/**
 * Pictures for news stories.
 *
 * Many feeds carry no picture (CNBC, WSJ), or only a thumbnail too small to
 * show (BBC sends 240 px). Two fixes, cheapest first:
 *
 *   1. `biggerImage`: image services whose address says the size, so a larger
 *      copy of the same picture can be asked for (BBC's iChef).
 *   2. `lookupPageImage`: the picture the publisher chose for link previews
 *      (og:image, twitter:image) on the article page itself, which is what a
 *      link shows when it is shared. Only the top of the page is read.
 *
 * Lookups are cached per article in the Cache API (found: a week; no picture:
 * 12 hours; no answer: 2 hours), never in KV, and a board build fetches at most
 * `perBuild` pages.
 * Nothing here throws: a story without a picture is drawn with the topic's
 * artwork in the browser.
 */

import { cacheGet, cachePut, type WaitUntil } from './edgeCache';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const IMAGE_LOOKUP = {
  timeoutMs: 4_500,
  /** Stop reading an article page after this many bytes (the preview tags sit in <head>). */
  maxBytes: 320 * 1024,
  /** Article pages fetched per board build at most. Cache hits do not count. */
  perBuild: 12,
  /** Pages tried per story: its own link, then one other outlet's. */
  perStory: 2,
  foundKeepSec: 7 * 86_400,
  /** A page that answered without a picture is asked again after this long. */
  missKeepSec: 12 * 3_600,
  /** A page that timed out or refused the connection is asked again after this long. */
  failKeepSec: 2 * 3_600,
};

export const PAGE_UA = 'Mozilla/5.0 (compatible; MarketCheckDash/1.0; +https://marketcheck.money)';

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

/* ── Bigger copies from image services ────────────────────────────────────── */

export type SizedImage = { url: string; width: number | null; height: number | null };

/** The width BBC thumbnails are asked for instead of the 240 px the feeds send. */
export const BBC_WIDTH = 976;

/**
 * A larger copy of the same picture when the address carries its size, or null.
 * BBC iChef: https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/… -> …/976/…
 */
export function biggerImage(url: string): SizedImage | null {
  const bbc = /^(https?:\/\/ichef\.bbci\.co\.uk\/(?:ace\/(?:standard|ws)|news))\/(\d{2,4})\/(.+)$/i.exec(url);
  if (bbc && Number(bbc[2]) < BBC_WIDTH) return { url: `${bbc[1]}/${BBC_WIDTH}/${bbc[3]}`, width: BBC_WIDTH, height: null };
  return null;
}

/* ── Preview pictures on article pages ────────────────────────────────────── */

/** Site furniture rather than a picture of the story: logos, icons, placeholders, tracking pixels. */
const JUNK_RE =
  /favicon|apple-touch-icon|sprite|spacer|1x1|pixel\.|blank\.(?:gif|png)|placeholder|default[-_.]?(?:image|img|share|og|social|thumb|card)|(?:og|share|social)[-_.]?default|fallback[-_.]?image|\/logos?\/|\/[^/?#]*logo[^/?#]*\.(?:png|jpe?g|webp|gif|svg)(?:[?#]|$)|\.(?:svg|ico)(?:[?#]|$)/i;

export const isJunkImage = (url: string): boolean => JUNK_RE.test(url);

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Preview tags, best first. */
const PREVIEW_KEYS: Record<string, number> = {
  'og:image:secure_url': 0,
  'og:image:url': 0,
  'og:image': 0,
  'twitter:image': 1,
  'twitter:image:src': 1,
  image: 2,
  thumbnailurl: 2,
};

/**
 * The picture an article page sets for link previews: og:image, then
 * twitter:image, then itemprop image or <link rel="image_src">. Relative
 * addresses are resolved against the page. Null when there is none, or only
 * a logo or placeholder.
 */
export function pageImage(html: string, pageUrl: string): string | null {
  let best: { url: string; rank: number } | null = null;
  const consider = (raw: string | null, rank: number) => {
    if (!raw || (best && best.rank <= rank)) return;
    let abs: string;
    try {
      abs = new URL(raw, pageUrl).href;
    } catch {
      return;
    }
    if (!isHttp(abs) || isJunkImage(abs)) return;
    best = { url: abs, rank };
  };
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? attr(tag, 'itemprop') ?? '').toLowerCase();
    const rank = PREVIEW_KEYS[key];
    if (rank === undefined) continue;
    consider(attr(tag, 'content'), rank);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if ((attr(tag, 'rel') ?? '').toLowerCase() === 'image_src') consider(attr(tag, 'href'), 2);
  }
  return best ? (best as { url: string }).url : null;
}

const SEEN_RE = /<meta\b[^>]*(?:og:image|twitter:image)[^>]*>/i;
const HEAD_END_RE = /<\/head\s*>|<body[\s>]/i;

/** The top of a page: up to the end of <head>, the first preview tag, or `maxBytes`. */
export async function readHead(res: Response, maxBytes = IMAGE_LOOKUP.maxBytes): Promise<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body || typeof body.getReader !== 'function') return (await res.text()).slice(0, maxBytes);
  const reader = body.getReader();
  const dec = new TextDecoder();
  let text = '';
  let got = 0;
  try {
    while (got < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      got += value.byteLength;
      // Look only at what is new (with an overlap for a tag split across chunks): cheap on CPU.
      const from = Math.max(0, text.length - 600);
      text += dec.decode(value, { stream: true });
      const fresh = text.slice(from);
      if (SEEN_RE.test(fresh) || HEAD_END_RE.test(fresh)) break;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return text;
}

/** Cache key for an article: the link without its fragment and tracking parameters. */
export function pageKey(link: string): string {
  try {
    const u = new URL(link);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_|cmpid$|ref$)/i.test(k)) u.searchParams.delete(k);
    return `newsimg:v1:${u.href}`;
  } catch {
    return `newsimg:v1:${link}`;
  }
}

export type LookupOpts = {
  fetchFn: FetchLike;
  waitUntil?: WaitUntil;
  /** Shared by every lookup in one board build. */
  budget?: { left: number };
};

/** What the cache keeps per article: the picture, or until when not to ask again. */
type Found = { img: string | null; until?: number };

/** The preview picture of one article page, from the cache or the page. Never throws. */
export async function lookupPageImage(link: string, opts: LookupOpts): Promise<string | null> {
  if (!isHttp(link)) return null;
  const key = pageKey(link);
  const hit = await cacheGet<Found>(key).catch(() => null);
  if (hit?.data && (hit.data.img || Date.now() < (hit.data.until ?? 0))) return hit.data.img ?? null;
  if (opts.budget) {
    if (opts.budget.left <= 0) return null;
    opts.budget.left -= 1;
  }
  let img: string | null = null;
  let answered = false;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), IMAGE_LOOKUP.timeoutMs) : null;
  try {
    const res = await opts.fetchFn(link, {
      headers: { 'User-Agent': PAGE_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: ctl?.signal,
    });
    answered = true;
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && (!type || /html|xml/i.test(type))) img = pageImage(await readHead(res), res.url || link);
    else res.body?.cancel().catch(() => undefined);
  } catch {
    /* timed out, refused or unreachable: counts as not found */
  } finally {
    if (timer) clearTimeout(timer);
  }
  const keepSec = img ? IMAGE_LOOKUP.foundKeepSec : answered ? IMAGE_LOOKUP.missKeepSec : IMAGE_LOOKUP.failKeepSec;
  cachePut<Found>(key, img ? { img } : { img: null, until: Date.now() + keepSec * 1000 }, { keepSec, waitUntil: opts.waitUntil });
  return img;
}

type Illustratable = { image: string | null; link: string; outlets?: { link: string }[] };

/**
 * Give every story a picture where one can be found: stories that have one
 * keep it; the rest get the preview picture of their own article, or of
 * another outlet's article about the same story.
 */
export async function illustrate<T extends Illustratable>(stories: T[], opts: Omit<LookupOpts, 'budget'> & { perBuild?: number }): Promise<T[]> {
  if (!stories.some((s) => !s.image)) return stories;
  const budget = { left: opts.perBuild ?? IMAGE_LOOKUP.perBuild };
  return Promise.all(
    stories.map(async (s) => {
      if (s.image) return s;
      const links = [s.link, ...(s.outlets ?? []).map((o) => o.link).filter((l) => l !== s.link)].filter(isHttp).slice(0, IMAGE_LOOKUP.perStory);
      for (const link of links) {
        const img = await lookupPageImage(link, { ...opts, budget });
        if (img) return { ...s, image: img };
      }
      return s;
    }),
  );
}
