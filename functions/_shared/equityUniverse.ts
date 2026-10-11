/**
 * The equity universe: every stock in STOCK_UNIVERSE and ETF in ETF_UNIVERSE
 * with price, day / week / month / year-to-date / year changes, market cap and
 * a small sparkline — built from 8 Yahoo spark requests (20 symbols each, one
 * year of daily closes).
 *
 * How each change is measured:
 *   1D   last price vs the previous session's close
 *   1W   last price vs the close 7 calendar days before the latest session
 *   1M   …30 calendar days before
 *   YTD  …the last close of the previous calendar year
 *   1Y   …the first close in the one-year window
 * When no session fell exactly on the reference date, the last close before it
 * is used.
 *
 * (Before this, the "24h" figure used the close before a 5-day chart window,
 * so it was a 5-day change, and "7d" / "30d" were measured over 1 and 3 months.)
 */

import { cached, cacheGet, cachePut, type KvLike, type WaitUntil } from './edgeCache';
import { mapPool } from './cache';
import { etParts, marketStatus } from './marketCalendar';
import { ETF_UNIVERSE, STOCK_UNIVERSE } from './universes';
import { SEED_DATE, SEED_SHARES, groupOf } from './sectors';
import { fetchNasdaqSize, fetchSparkAll, fetchTrailingMarketCap, type Series } from './yahoo';

export type EquityTf = '24h' | '7d' | '30d' | 'ytd' | '1y';
export const EQUITY_TF_LIST: EquityTf[] = ['24h', '7d', '30d', 'ytd', '1y'];

export type Equity = {
  /** Yahoo symbol, e.g. "BRK-B". */
  symbol: string;
  name: string;
  kind: 'stock' | 'etf';
  /** GICS sector (stocks) or fund group (ETFs). */
  group: string;
  price: number | null;
  prevClose: number | null;
  ch: Record<EquityTf, number | null>;
  /** Market cap (stocks) or assets under management (ETFs), USD. Null until known. */
  marketCap: number | null;
  /** Highest and lowest daily close in the past year. */
  high52: number | null;
  low52: number | null;
  /** Last ~30 daily closes, oldest first. */
  spark: number[];
  /** Unix seconds of the last trade. */
  time: number | null;
  ok: boolean;
};

export type EquityUniverse = {
  items: Equity[];
  at: number;
  stale: boolean;
  source: 'yahoo';
};

type DataEnv = { LAYOUTS?: KvLike };

const pct = (now: number | null, then: number | null | undefined): number | null =>
  now != null && then != null && then > 0 ? (now / then - 1) * 100 : null;

/** The last close at or before a time (unix seconds). Bars are oldest first. */
function closeAtOrBefore(t: number[], c: number[], limitSec: number): number | null {
  let lo = 0;
  let hi = t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= limitSec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? c[found]! : null;
}

const round = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  const digits = n >= 1000 ? 1 : n >= 10 ? 2 : 4;
  return Number(n.toFixed(digits));
};

const DAY = 86_400;

function toEquity(
  def: { yahoo: string; name: string },
  kind: 'stock' | 'etf',
  s: Series | undefined,
): Equity {
  const base: Equity = {
    symbol: def.yahoo,
    name: def.name,
    kind,
    group: groupOf(def.yahoo),
    price: null,
    prevClose: null,
    ch: { '24h': null, '7d': null, '30d': null, ytd: null, '1y': null },
    marketCap: null,
    high52: null,
    low52: null,
    spark: [],
    time: null,
    ok: false,
  };
  if (!s || !s.ok || s.price == null) return base;

  const { t, c } = s;
  const n = c.length;
  const price = s.price;
  base.price = price;
  base.prevClose = s.prevClose;
  base.time = s.time;
  base.ok = true;
  base.ch['24h'] = s.changePercent;

  if (n >= 2 && t.length === n) {
    // Measure back from the latest session, not from "now", so a weekend does not shorten the window.
    const lastBar = t[n - 1]!;
    base.ch['7d'] = pct(price, closeAtOrBefore(t, c, lastBar - 7 * DAY + 3600));
    base.ch['30d'] = pct(price, closeAtOrBefore(t, c, lastBar - 30 * DAY + 3600));
    base.ch['1y'] = pct(price, c[0]);
    const year = new Date(lastBar * 1000).getUTCFullYear();
    base.ch.ytd = pct(price, closeAtOrBefore(t, c, Date.UTC(year, 0, 1) / 1000 - 1));
    let hi = -Infinity;
    let lo = Infinity;
    for (const v of c) {
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    base.high52 = Math.max(hi, price);
    base.low52 = Math.min(lo, price);
    base.spark = c.slice(-30).map(round);
  }
  return base;
}

/* ── Share counts (for market cap) ─────────────────────────────────────── */

type ShareBook = {
  /** symbol -> shares or ETF units outstanding */
  shares: Record<string, number>;
  /** symbol -> when that count was last confirmed (ms) */
  at: Record<string, number>;
  /** When the book was last written to KV (ms) */
  kvAt?: number;
};

const SHARES_KEY = 'equity-shares:v1';
const SHARES_KV_KEY = 'cache:equity-shares:v1';
const SEED_AT = Date.parse(`${SEED_DATE}T20:00:00Z`);
/** Re-check a symbol's share count this often. */
const SHARES_MAX_AGE_MS = 7 * 86_400_000;
/** At most this many lookups per request, to stay inside the subrequest budget. */
const SHARES_PER_RUN = 10;

function seedBook(): ShareBook {
  const at: Record<string, number> = {};
  for (const sym of Object.keys(SEED_SHARES)) at[sym] = SEED_AT;
  return { shares: { ...SEED_SHARES }, at };
}

async function loadShareBook(env: DataEnv | undefined): Promise<ShareBook> {
  const hit = await cacheGet<ShareBook>(SHARES_KEY);
  if (hit?.data?.shares) return hit.data;
  if (env?.LAYOUTS) {
    try {
      const raw = await env.LAYOUTS.get(SHARES_KV_KEY);
      if (raw) {
        const book = JSON.parse(raw) as ShareBook;
        if (book?.shares && book.at) return { ...book, kvAt: book.kvAt ?? Date.now() };
      }
    } catch {
      /* fall through to the seed */
    }
  }
  return seedBook();
}

/**
 * Refresh the oldest few share counts. A new count is accepted only when it is
 * within 30% of the old one (or there was none), so one bad upstream value
 * cannot distort the tables.
 */
async function refreshShareBook(
  book: ShareBook,
  items: Equity[],
  env: DataEnv | undefined,
  waitUntil?: WaitUntil,
): Promise<boolean> {
  const now = Date.now();
  const due = items
    .filter((e) => e.ok && e.price != null && e.price > 0)
    .map((e) => ({ e, age: now - (book.at[e.symbol] ?? 0) }))
    .filter((x) => x.age > SHARES_MAX_AGE_MS)
    .sort((a, b) => b.age - a.age)
    .slice(0, SHARES_PER_RUN);
  if (!due.length) return false;

  let changed = false;
  const sessionRunning = marketStatus().state === 'open';
  await mapPool(due, 5, async ({ e }) => {
    let cap: number | null = null;
    let asOf: string | null = null;
    if (e.kind === 'stock') {
      const hit = await fetchTrailingMarketCap(e.symbol);
      cap = hit?.value ?? null;
      asOf = hit?.asOf ?? null;
      if (cap == null) cap = await fetchNasdaqSize(e.symbol, 'stocks');
    } else {
      cap = await fetchNasdaqSize(e.symbol, 'etf');
    }
    // The cap applies to a closing price. Divide by that same close: the last
    // one if the figure is dated to the latest session, otherwise the one before.
    const lastDate = e.time != null ? etParts(e.time * 1000).key : null;
    const datedToLastSession = asOf && lastDate ? asOf >= lastDate : !sessionRunning;
    const price = datedToLastSession ? e.price! : (e.prevClose ?? e.price!);
    // Mark the attempt either way so a symbol with no data is not retried on every request.
    book.at[e.symbol] = cap == null ? now - SHARES_MAX_AGE_MS + 6 * 3_600_000 : now;
    changed = true;
    if (cap == null || !(price > 0)) return;
    const next = cap / price;
    const prev = book.shares[e.symbol];
    if (prev && Math.abs(next / prev - 1) > 0.3) return;
    book.shares[e.symbol] = next;
  });

  if (changed) {
    const jobs: Promise<unknown>[] = [];
    if (env?.LAYOUTS && (!book.kvAt || now - book.kvAt > 12 * 3_600_000)) {
      book.kvAt = now;
      jobs.push(
        env.LAYOUTS.put(SHARES_KV_KEY, JSON.stringify(book), { expirationTtl: 60 * 86_400 }).catch(
          () => undefined,
        ),
      );
    }
    cachePut(SHARES_KEY, book, { keepSec: 30 * 86_400, waitUntil });
    if (jobs.length) {
      const all = Promise.all(jobs);
      if (waitUntil) waitUntil(all);
      else await all;
    }
  }
  return changed;
}

/** Market cap for universe symbols from the share book (no network). */
export async function universeMarketCaps(
  env: DataEnv | undefined,
  prices: Map<string, number>,
): Promise<Map<string, number>> {
  const book = await loadShareBook(env);
  const out = new Map<string, number>();
  for (const [sym, price] of prices) {
    const shares = book.shares[sym];
    if (shares && price > 0) out.set(sym, shares * price);
  }
  return out;
}

const UNIVERSE_SYMBOLS = new Set([...STOCK_UNIVERSE, ...ETF_UNIVERSE].map((d) => d.yahoo));
export const inEquityUniverse = (symbol: string): boolean => UNIVERSE_SYMBOLS.has(symbol);

async function loadUniverse(): Promise<Equity[]> {
  const defs = [
    ...STOCK_UNIVERSE.map((d) => ({ d, kind: 'stock' as const })),
    ...ETF_UNIVERSE.map((d) => ({ d, kind: 'etf' as const })),
  ];
  const series = await fetchSparkAll(
    defs.map((x) => x.d.yahoo),
    '1y',
    '1d',
    4,
  );
  return defs.map(({ d, kind }) => toEquity(d, kind, series.get(d.yahoo)));
}

/**
 * The universe, refreshed about once a minute while the market is open and
 * every ten minutes otherwise (regular-session prices do not move then).
 */
export async function getEquityUniverse(
  env: DataEnv | undefined,
  waitUntil?: WaitUntil,
): Promise<EquityUniverse> {
  const state = marketStatus().state;
  const freshMs = state === 'open' ? 50_000 : state === 'pre' || state === 'post' ? 5 * 60_000 : 10 * 60_000;
  const hit = await cached<Equity[]>('equity-universe:v1', {
    freshMs,
    keepSec: 3 * 86_400,
    load: loadUniverse,
    // Yahoo failing for most symbols is a failed load, not a result to cache.
    valid: (items) => items.filter((e) => e.ok).length >= items.length * 0.6,
    waitUntil,
    retryMs: 30_000,
  });

  const book = await loadShareBook(env);
  if (hit.from === 'live') {
    // Only spend lookups on requests that just refreshed prices.
    await refreshShareBook(book, hit.data, env, waitUntil).catch(() => false);
  }
  const items = hit.data.map((e) => {
    const shares = book.shares[e.symbol];
    return shares && e.price != null ? { ...e, marketCap: shares * e.price } : e;
  });
  return { items, at: hit.at, stale: hit.stale, source: 'yahoo' };
}

/** Saved layouts may hold intraday timeframes, which daily bars cannot answer. They show 1D. */
export function equityTf(tf: string): EquityTf {
  return (EQUITY_TF_LIST as string[]).includes(tf) ? (tf as EquityTf) : '24h';
}
