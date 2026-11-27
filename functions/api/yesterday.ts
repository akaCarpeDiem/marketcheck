/**
 * GET /api/yesterday
 * "Yesterday's best buys": the coins and stocks that gained most over the last
 * complete day, from the whole market, each group above a $1M market cap floor.
 * Rules and dates are in functions/_shared/bestBuys.ts.
 *
 * Each group's list is worked out once per day and saved in KV, so every visitor and
 * every Cloudflare location shows the same list:
 * - Stocks: Yahoo's stock screener of every US-listed share (Nasdaq's full list when that
 *   fails). Until the newest session's list is saved it is looked at again at most every
 *   20 minutes, and the newest saved session is shown, labelled with its date.
 * - Crypto: Yahoo's list of every coin gives each one's close at the last 00:00 UTC. Those
 *   closes are saved once a day (best:closes:<day>), and the next day's are compared with
 *   them. When the day before's were not saved, each coin's start is read from Yahoo's daily
 *   bars instead, 560 coins a request, the progress kept in KV (best:fill:<day>).
 *   (CoinPaprika and CoinGecko sit behind Cloudflare and often refuse Cloudflare Functions,
 *   which reach them from shared addresses; Yahoo does not.)
 *   CoinGecko's full coin list is added from a file written outside Cloudflare shortly after 00:00 UTC
 *   (scripts/coingecko-day.mjs, published on the repo's coin-data branch), so coins Yahoo does not
 *   carry are compared too; a coin on both is counted once, and CoinGecko's figure for what it traded
 *   over the day is used for the $100K floor.
 * Every Yahoo row is checked against Yahoo's hourly closes before it is shown (hourly for every coin:
 * daily bars round prices to six decimals, and on 2026-11-20 the daily check turned away every coin
 * priced over $0.001), and the next biggest gainers are checked until at least five pass. A lookup
 * that fails is retried, then skipped for now and logged, never taken as a coin that failed the check;
 * when many fail, or most do not check out, the list is not published and the last one stays up.
 * At most one list is worked out per request, to stay inside the free plan's CPU and
 * sub-request limits. When a list cannot be worked out, the reason is in the group's `why`.
 */
import {
  BEST_KEEP,
  coinCheckVerdict,
  mergeCoinGecko,
  parseCgDay,
  yahooTickers,
  type CgDay,
  type CoinCheck,
  type YahooCoinId,
  BEST_MIN_CAP_CRYPTO,
  BEST_MIN_CAP_STOCK,
  minCapFor,
  BEST_MIN_TRADED,
  BEST_SHOW,
  YAHOO_COIN_FIELDS,
  barsAgree,
  coinDayRows,
  coinLabel,
  coinRow,
  commonDay,
  cryptoDay,
  dailyFromHourly,
  dayCloses,
  detectSession,
  etKey,
  fillFromBars,
  fillRows,
  isCommonStock,
  largestStocks,
  listIsPast,
  nextDayKey,
  parseNasdaqScreener,
  parseYahooCoins,
  parseYahooStocks,
  prevDayKey,
  rankBest,
  samePrice,
  sessionBefore,
  startFill,
  stockDay,
  tidyStockName,
  trailFrom,
  utcKey,
  yahooOfNasdaq,
  yahooStockQuery,
  type BestAnswer,
  type BestGroup,
  type BestRow,
  type Bars,
  type CoinFill,
  type DayCloses,
  type ScreenRow,
  type YahooCoin,
} from '../_shared/bestBuys';
import { mapPool } from '../_shared/cache';
import { getCryptoUniverse, type DataEnv } from '../_shared/cryptoUniverse';
import { cacheGet, cachePut, jsonResponse, type KvLike, type WaitUntil } from '../_shared/edgeCache';
import { SPARK_MAX, fetchSparkAll } from '../_shared/yahoo';

const NASDAQ_SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true';
const YAHOO_COINS = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=all_cryptocurrencies_us&count=250&fields=${YAHOO_COIN_FIELDS}`;
/** Pages of 250 coins, largest first. Read on until coins are a quarter of the floor, so a coin that quadrupled in a day is still in the day-before closes. */
const YAHOO_FIRST_PAGES = 10;
const YAHOO_MAX_PAGES = 14;
/** How often a location looks at a source while the day's list is missing. */
const PROBE_MS = 20 * 60_000;
/** While coins are being read from Yahoo's daily bars, the next share is read this soon. */
const SOON_MS = 50_000;
/** Calls for Yahoo's daily bars (20 coins each) per request while filling in a day, and for coins it skipped; the free plan allows 50 sub-requests. */
const FILL_CALLS = 28;
const FILL_RETRY_CALLS = 6;
/** A fill's last share this small leaves room to finish the list in the same request. */
const FILL_FINISH_CALLS = 14;
/** Rows checked against Yahoo's hourly closes per round (twenty), and rounds at most: coins, then stocks. */
const COIN_ROUNDS = 8;
/** CoinGecko's list for a day, written outside Cloudflare (scripts/coingecko-day.mjs). */
const CG_DAY_URL = (day: string) => `https://raw.githubusercontent.com/akaCarpeDiem/marketcheck/coin-data/coingecko/${day}.json`;
/** Hours into the next UTC day that a list waits for CoinGecko's file before going ahead with Yahoo's alone. */
const CG_WAIT_H = 2;
const STOCK_BATCH = 40;
const STOCK_ROUNDS = 4;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};
/** Saved lists are kept two weeks, so an older day can stand in while a new one is missing. */
const SNAP_TTL = 14 * 86_400;
/** A day's coin closes are needed for one day; kept a few in case a day is missed. */
const CLOSES_TTL = 4 * 86_400;
const FILL_TTL = 2 * 86_400;
/** The assembled answer is kept this long per location; less while a list is still to be saved. */
const ANSWER_MS = 10 * 60_000;
const PENDING_MS = 60_000;

type Kind = 'crypto' | 'stocks';
type Env = DataEnv & { LAYOUTS?: KvLike };
type Ctx = { request: Request; env?: Env; waitUntil?: WaitUntil };
/** Not finished yet, but under way: the next request carries on. */
type Later = { later: string };
/** A list, or why there is none (yet). */
type Capture = BestGroup | string | Later;

// v3 for coins: lists saved before hourly checks and CoinGecko's coins are worked out again.
const snapKey = (kind: Kind, day: string) => `best:${kind === 'crypto' ? 'v3' : 'v2'}:${kind}:${day}`;
const closesKey = (day: string) => `best:closes:${day}`;
const fillKey = (day: string) => `best:fill:${day}`;
const mem = new Map<string, BestGroup>();
const memFill = new Map<string, CoinFill>();
/** Lists being worked out in this isolate right now. */
const running = new Map<string, Promise<{ g: BestGroup | null; later: boolean }>>();
/** Why the last try for a group's day found no list (this isolate). */
const lastWhy = new Map<string, string>();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The group without rows under its kind's size floor. */
function overFloor(kind: Kind, g: BestGroup): BestGroup {
  const floor = minCapFor(kind === 'stocks' ? 'stock' : 'crypto');
  const items = g.items.filter((r) => r.marketCap >= floor);
  return items.length === g.items.length ? g : { ...g, items };
}

async function readSnap(kv: KvLike | undefined, kind: Kind, day: string): Promise<BestGroup | null> {
  const key = snapKey(kind, day);
  const held = mem.get(key);
  if (held) return held;
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BestGroup;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    // Lists saved under an older, lower size floor: drop rows under today's floor (a short list is worked out again).
    const g = overFloor(kind, parsed);
    if (mem.size > 40) mem.clear();
    mem.set(key, g);
    return g;
  } catch {
    return null;
  }
}

async function saveSnap(kv: KvLike | undefined, kind: Kind, g: BestGroup): Promise<void> {
  const key = snapKey(kind, g.day);
  mem.set(key, g);
  if (!kv) return;
  try {
    // Another location may have saved it first; the first full copy stands. A short one is replaced.
    const raw = await kv.get(key);
    const have = raw ? overFloor(kind, JSON.parse(raw) as BestGroup) : null;
    if (!have?.items || have.items.length < Math.min(BEST_SHOW, g.items.length)) await kv.put(key, JSON.stringify(g), { expirationTtl: SNAP_TTL });
  } catch {
    /* write allowance used up: this location still has it in memory */
  }
}

/** Fewer than five passed although there were more gainers to look at: not a list to save. */
function short(items: BestRow[], looked: number, total: number, what: string): string | null {
  if (items.length >= BEST_SHOW || looked >= total) return null;
  return `Only ${items.length} of the ${looked} biggest ${what} checked out against Yahoo's daily closes`;
}

/* ── Stocks ───────────────────────────────────────────────────────────────── */

async function nasdaqRows(): Promise<ScreenRow[] | string> {
  try {
    const res = await fetch(NASDAQ_SCREENER, {
      headers: { ...HEADERS, Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/market-activity/stocks/screener' },
    });
    return res.ok ? parseNasdaqScreener(await res.text()) : `Nasdaq's stock list answered HTTP ${res.status}`;
  } catch (e) {
    return `Nasdaq's stock list could not be read: ${errText(e)}`;
  }
}

/**
 * Yahoo's screener needs a session: a cookie from fc.yahoo.com and a "crumb" that goes with it.
 * Kept per isolate for an hour.
 */
let yahooAuth: { cookie: string; crumb: string; at: number } | null = null;

async function yahooSession(now: number): Promise<{ cookie: string; crumb: string } | string> {
  if (yahooAuth && now - yahooAuth.at < 3_600_000) return yahooAuth;
  try {
    const first = await fetch('https://fc.yahoo.com/', { headers: HEADERS, redirect: 'manual' });
    const h = first.headers as Headers & { getSetCookie?: () => string[] };
    const set = h.getSetCookie?.() ?? (first.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    const cookie = set.map((c) => c.split(';')[0]!.trim()).filter((c) => c.includes('=')).join('; ');
    if (!cookie) return `Yahoo gave no session cookie (HTTP ${first.status})`;
    const res = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { ...HEADERS, Accept: 'text/plain', Cookie: cookie } });
    const crumb = (await res.text()).trim();
    if (!res.ok || !crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) return `Yahoo's session check answered HTTP ${res.status}`;
    yahooAuth = { cookie, crumb, at: now };
    return yahooAuth;
  } catch (e) {
    return `Yahoo's session could not be set up: ${errText(e)}`;
  }
}

async function yahooScreen(auth: { cookie: string; crumb: string }, query: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://query2.finance.yahoo.com/v1/finance/screener?crumb=${encodeURIComponent(auth.crumb)}&formatted=false&lang=en-US&region=US`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Cookie: auth.cookie },
    body: JSON.stringify(query),
  });
  if (!res.ok) {
    if (res.status === 401) yahooAuth = null;
    throw new Error(`Yahoo's stock screener answered HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * The session from Yahoo's screener: every US-listed share that rose, biggest first, each with the
 * session its price belongs to, so there is no guessing which day it shows. Until a session has
 * closed (and settled) Yahoo shows it trading, so that is refused and the list is taken after the close.
 */
async function stocksFromYahoo(latest: string, now: number): Promise<Capture> {
  const auth = await yahooSession(now);
  if (typeof auth === 'string') return auth;
  let gainers: unknown;
  let count: unknown;
  try {
    [gainers, count] = await Promise.all([yahooScreen(auth, yahooStockQuery(250, true)), yahooScreen(auth, yahooStockQuery(1, false)).catch(() => null)]);
  } catch (e) {
    return errText(e);
  }
  const rows = parseYahooStocks(gainers);
  const day = commonDay(rows);
  if (!day || rows.length < 20) return `Yahoo's stock screener gave only ${rows.length} rows`;
  if (day > latest) return `Yahoo's stock screener shows ${day}, a session not finished yet`;
  const total = Number((count as { finance?: { result?: Array<{ total?: number }> } } | null)?.finance?.result?.[0]?.total) || 0;
  return stockList(
    rows.filter((r) => r.day === day),
    day,
    now,
    total,
    'Yahoo Finance (all US-listed stocks)',
  );
}

/**
 * Read Nasdaq's list, work out which session it shows, and build that session's list, or say why not
 * (`latest`: the newest finished session).
 */
async function stocksFromNasdaq(latest: string, now: number): Promise<Capture> {
  const rows = await nasdaqRows();
  if (typeof rows === 'string') return rows;
  if (rows.length < 500) return `Nasdaq's stock list had only ${rows.length} rows`;
  // Which session? One Yahoo call for the fifteen largest companies.
  const big = largestStocks(rows);
  const bigSeries = await fetchSparkAll(big.map((r) => yahooOfNasdaq(r.sym)), '1mo', '1d').catch(() => new Map());
  const day = detectSession(big, bigSeries);
  if (!day) return `Could not tell which session Nasdaq's list shows (Yahoo had ${bigSeries.size} of the ${big.length} largest)`;
  if (day > latest) return `Nasdaq's list shows ${day}, a session not finished yet`;
  return stockList(rows, day, now, 0, 'Nasdaq (all US-listed stocks)');
}

/** Yahoo's screener first (it is current the evening of the session); Nasdaq's full list if that fails. */
async function captureStocks(latest: string, now: number): Promise<Capture> {
  const y = await stocksFromYahoo(latest, now);
  if (typeof y !== 'string') return y;
  const n = await stocksFromNasdaq(latest, now);
  return typeof n === 'string' ? `${y}; ${n}` : n;
}

/** A session's list from market-wide rows (`checked`: how many were compared, when the rows are not all of them). */
async function stockList(rows: ScreenRow[], day: string, now: number, checked: number, source: string): Promise<Capture> {
  const eligible = rows.filter((r) => isCommonStock(r.sym, r.name) && r.marketCap >= BEST_MIN_CAP_STOCK);
  // The likeliest gainers by the list's own figures...
  const pool = eligible.filter((r) => r.change > 0 && r.price * r.volume >= BEST_MIN_TRADED).sort((a, b) => b.change - a.change);
  if (!pool.length) return `No stock in the list gained on ${day}`;

  // ...each measured again from Yahoo's daily closes, because a list's figures can be wrong: Yahoo's
  // screener has shown a 1% day as +908% (a previous close from before a share consolidation). Forty
  // at a time (two Yahoo calls), biggest first, until ten are measured; the same closes give the trend
  // line. A stock Yahoo has no bar for on the day cannot be checked and is left out.
  const items: BestRow[] = [];
  let looked = 0;
  let answered = false;
  for (let round = 0; round < STOCK_ROUNDS && looked < pool.length && rankBest(items).length < BEST_KEEP; round++) {
    const batch = pool.slice(looked, looked + STOCK_BATCH);
    looked += batch.length;
    const symbols = batch.map((r) => yahooOfNasdaq(r.sym));
    const series = await fetchSparkAll(symbols, '1mo', '1d').catch(() => new Map());
    answered ||= series.size > 0;
    batch.forEach((r, i) => {
      const s = series.get(symbols[i]!);
      const d = dayCloses(s, day, etKey);
      if (!s || !d) return;
      items.push({
        kind: 'stock',
        sym: r.sym,
        name: tidyStockName(r.name),
        yahoo: symbols[i]!,
        marketCap: r.marketCap,
        from: d.from,
        to: d.to,
        change: (d.to / d.from - 1) * 100,
        traded: d.to * r.volume,
        now: null,
        trail: trailFrom(s.c.slice(0, d.k), d.from, d.to),
      });
    });
  }
  if (!answered) return `Yahoo's daily closes could not be read to check the stocks`;
  const best = rankBest(items);
  const notEnough = short(best, looked, pool.length, 'stock gainers');
  if (notEnough) return notEnough;
  return { day, items: best, checked: Math.max(checked, eligible.length), at: new Date(now).toISOString(), source };
}

/* ── Crypto ───────────────────────────────────────────────────────────────── */

const COIN_SOURCE = 'Yahoo Finance (CoinMarketCap prices for every coin)';
const COIN_SOURCE_CG = 'Yahoo Finance (CoinMarketCap prices) and CoinGecko';

/** CoinGecko's file for the day: the file, null when there is none (yet), or why it could not be read. */
async function cgDay(day: string): Promise<CgDay | null | string> {
  try {
    const res = await fetch(CG_DAY_URL(day), { headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) return `CoinGecko's list for ${day} answered HTTP ${res.status}`;
    const f = parseCgDay(await res.json(), day);
    return f ?? `CoinGecko's list for ${day} is not in the expected form`;
  } catch (e) {
    return `CoinGecko's list for ${day} could not be read: ${errText(e)}`;
  }
}

/** The coins on Yahoo's list that share a ticker with one in CoinGecko's file, as Yahoo names them. */
function yahooTwins(coins: { yahoo: string; label: () => YahooCoinId }[], cg: CgDay | null): YahooCoinId[] {
  if (!cg?.rows.length) return [];
  const syms = new Set(cg.rows.map((r) => r.symbol.toUpperCase()));
  const out: YahooCoinId[] = [];
  for (const c of coins) if (yahooTickers(c.yahoo).some((t) => syms.has(t))) out.push(c.label());
  return out;
}

/** Every coin on Yahoo's list down to a quarter of the size floor, largest first. */
async function yahooCoins(): Promise<YahooCoin[] | string> {
  const page = async (i: number): Promise<YahooCoin[]> => {
    const res = await fetch(`${YAHOO_COINS}&start=${i * 250}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Yahoo's coin list answered HTTP ${res.status}`);
    return parseYahooCoins(await res.text());
  };
  const deepEnough = (list: YahooCoin[]) => list.length < 200 || list[list.length - 1]!.marketCap < BEST_MIN_CAP_CRYPTO / 4;
  try {
    const pages = await mapPool(Array.from({ length: YAHOO_FIRST_PAGES }, (_, i) => i), 5, page);
    let last = pages[pages.length - 1]!;
    for (let i = YAHOO_FIRST_PAGES; i < YAHOO_MAX_PAGES && !deepEnough(last); i++) pages.push((last = await page(i)));
    // The list is sorted live, so a coin can turn up on two pages.
    const bySym = new Map<string, YahooCoin>();
    for (const c of pages.flat()) if (!bySym.has(c.yahoo)) bySym.set(c.yahoo, c);
    return [...bySym.values()];
  } catch (e) {
    return errText(e);
  }
}

async function readJson<T>(kv: KvLike | undefined, key: string): Promise<T | null> {
  try {
    const raw = kv ? await kv.get(key) : null;
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function readCloses(kv: KvLike | undefined, day: string): Promise<DayCloses | null> {
  const v = await readJson<DayCloses>(kv, closesKey(day));
  return v && v.c && typeof v.c === 'object' ? v : null;
}

async function saveCloses(kv: KvLike | undefined, day: string, coins: YahooCoin[], now: number): Promise<void> {
  if (!kv) return;
  const c: Record<string, number> = {};
  for (const coin of coins) c[coin.yahoo] = coin.prevClose;
  try {
    if (!(await kv.get(closesKey(day)))) await kv.put(closesKey(day), JSON.stringify({ day, at: new Date(now).toISOString(), c }), { expirationTtl: CLOSES_TTL });
  } catch {
    /* write allowance used up: tomorrow is read from Yahoo's daily bars instead */
  }
}

/**
 * Each coin's daily closes (UTC) from Yahoo's hourly bars over five days, for every coin: daily bars round
 * prices to six decimals, and hourly ones carry the same closes as Yahoo's coin list. 20 coins a call.
 * A coin Yahoo sent nothing for is not in the map.
 */
async function coinBars(coins: { y: string }[]): Promise<Map<string, Bars>> {
  const hourly = await fetchSparkAll(
    coins.map((c) => c.y),
    '5d',
    '1h',
    4,
  ).catch(() => new Map<string, Bars>());
  const out = new Map<string, Bars>();
  for (const [k, v] of hourly) if (v.c.length) out.set(k, dailyFromHourly(v));
  return out;
}

/** coinBars, asked once more for the coins the first answer left out. */
async function coinBarsRetry(coins: { y: string }[]): Promise<Map<string, Bars>> {
  const series = await coinBars(coins);
  const gaps = coins.filter((c) => !series.has(c.y));
  if (gaps.length) for (const [k, v] of await coinBars(gaps)) series.set(k, v);
  return series;
}

/** A day being filled in from Yahoo's daily bars: this isolate's copy or the saved one, whichever is further on. */
async function readFill(kv: KvLike | undefined, day: string): Promise<CoinFill | null> {
  const held = memFill.get(day) ?? null;
  const saved = await readJson<CoinFill>(kv, fillKey(day));
  const ok = saved && Array.isArray(saved.coins) && saved.day === day ? saved : null;
  return ok && (!held || ok.next > held.next) ? ok : held;
}

async function saveFill(kv: KvLike | undefined, fill: CoinFill): Promise<void> {
  if (memFill.size > 3) memFill.clear();
  memFill.set(fill.day, fill);
  try {
    await kv?.put(fillKey(fill.day), JSON.stringify(fill), { expirationTtl: FILL_TTL });
  } catch {
    /* this location carries on from memory */
  }
}

/**
 * Yahoo's hourly closes for the coins, biggest gainer first, 20 a call, until ten agree with them (or the
 * gainers run out). A coin whose closes disagree with the list is left out: every coin shown has been
 * checked twice. A coin whose closes could not be read is asked for once more, then skipped for now and
 * logged; it is never counted as one that failed the check. When too many could not be read, or most did
 * not check out, there is no list (coinCheckVerdict). The same closes give the trend line.
 */
async function checkCoins(rows: BestRow[], day: string): Promise<({ ok: BestRow[] } & CoinCheck) | string> {
  const ok: BestRow[] = [];
  const c: CoinCheck = { looked: 0, failed: 0, rejected: 0 };
  let answered = false;
  for (let round = 0; round < COIN_ROUNDS && c.looked < rows.length && rankBest(ok).length < BEST_KEEP; round++) {
    const batch = rows.slice(c.looked, c.looked + SPARK_MAX);
    c.looked += batch.length;
    const series = await coinBarsRetry(batch.map((r) => ({ y: r.yahoo! })));
    answered ||= series.size > 0;
    for (const r of batch) {
      const s = series.get(r.yahoo!);
      const d = dayCloses(s, day, utcKey, prevDayKey(day));
      if (!s || !d) {
        c.failed++;
        console.warn(`best-buys ${day}: no hourly closes for ${r.yahoo} (${s ? 'none reaching the day' : 'no answer'}); skipped for now`);
        continue;
      }
      if (!barsAgree(r, d)) {
        c.rejected++;
        console.log(`best-buys ${day}: ${r.yahoo} left out, closes disagree (list ${r.from} → ${r.to}, hourly ${d.from} → ${d.to})`);
        continue;
      }
      r.trail = trailFrom(s.c.slice(0, d.k), r.from, r.to);
      ok.push(r);
    }
  }
  // No closes at all (rather than none for some coins): Yahoo did not answer.
  if (!answered) return `Yahoo's hourly closes could not be read to check the coins`;
  const verdict = coinCheckVerdict(c);
  if (verdict) {
    console.warn(`best-buys ${day}: ${verdict}`);
    return verdict;
  }
  return { ok, ...c };
}

/**
 * The list from the day's gainers (biggest first): checked, CoinGecko's coins added (`cg`, `twins`: Yahoo's
 * coins that may be the same as one of them), the ten best kept, and named after the site's own coins.
 */
async function coinList(
  gainers: BestRow[],
  total: number,
  day: string,
  checked: number,
  now: number,
  env: Env | undefined,
  waitUntil: WaitUntil | undefined,
  cg: CgDay | null,
  twins: YahooCoinId[],
): Promise<Capture> {
  const got = await checkCoins(gainers.slice(0, COIN_ROUNDS * SPARK_MAX), day);
  if (typeof got === 'string') return got;
  const merged = mergeCoinGecko(got.ok, cg, twins);
  const items = rankBest(merged.rows);
  const notEnough = short(items, got.looked, total, 'coin gainers');
  if (notEnough) return notEnough;

  // Coins the site already lists open their own panel and use its logo.
  const cu = await getCryptoUniverse(env, waitUntil).catch(() => null);
  for (const r of items) {
    const match = cu?.coins.find((c) => c.symbol === r.sym && (c.name.toLowerCase() === r.name.toLowerCase() || samePrice(c.price, r.now, 0.03)));
    if (match) {
      r.cg = match.id;
      if (match.image) r.image = match.image;
    }
  }
  return { day, items, // Coins over the floor on either list; most are on both, so the larger count is the honest one.
    checked: Math.max(checked, cg?.compared ?? 0), at: new Date(now).toISOString(), source: cg ? COIN_SOURCE_CG : COIN_SOURCE };
}

/** The next share of a day being filled in from Yahoo's daily bars, and the list once all are in. */
async function continueFill(fill: CoinFill, kv: KvLike | undefined, now: number, env: Env | undefined, waitUntil: WaitUntil | undefined, cg: CgDay | null): Promise<Capture> {
  if (fill.next < fill.coins.length) {
    const start = fill.next;
    const upto = start + FILL_CALLS * SPARK_MAX;
    const todo = fill.coins.slice(start, upto);
    const series = await coinBars(todo);
    // A call that failed leaves twenty coins out: asked once more.
    const gaps = todo.filter((f) => !series.has(f.y));
    if (gaps.length && gaps.length <= FILL_RETRY_CALLS * SPARK_MAX) {
      for (const [k, v] of await coinBars(gaps)) series.set(k, v);
    }
    const missing = fillFromBars(fill, upto, series);
    if (missing > todo.length / 4) {
      fill.next = start;
      return `Yahoo had no daily bars for ${missing} of ${todo.length} coins`;
    }
    await saveFill(kv, fill);
    const calls = Math.ceil(todo.length / SPARK_MAX);
    if (fill.next < fill.coins.length || calls > FILL_FINISH_CALLS) {
      return { later: `Coin closes for ${prevDayKey(fill.day)} were not saved, so each coin's start is read from Yahoo's daily bars: ${fill.next} of ${fill.coins.length} read` };
    }
  }
  const rows = fillRows(fill);
  const twins = yahooTwins(
    fill.coins.map((f) => ({ yahoo: f.y, label: () => ({ sym: f.sym, name: f.name, price: f.to }) })),
    cg,
  );
  return coinList(rows, rows.length, fill.day, fill.checked, now, env, waitUntil, cg, twins);
}

/** Yesterday (UTC) for every coin: Yahoo's closes compared with the day before's saved ones, else with Yahoo's daily bars. */
async function captureCrypto(day: string, now: number, env: Env | undefined, waitUntil: WaitUntil | undefined): Promise<Capture> {
  const kv = env?.LAYOUTS;
  const hoursIn = (now - Date.parse(`${nextDayKey(day)}T00:00:00Z`)) / 3_600_000;
  if (hoursIn < 0.25) return 'The UTC day has only just ended; closes are read from 00:15 UTC';

  // CoinGecko's file for the day: waited for up to CG_WAIT_H hours into the next day, then gone ahead without.
  const cgGot = await cgDay(day);
  if (typeof cgGot === 'string') console.warn(`best-buys ${day}: ${cgGot}`);
  const cg = typeof cgGot === 'string' ? null : cgGot;
  if (!cg && hoursIn < CG_WAIT_H) return `Waiting for CoinGecko's list for ${day} (until ${String(CG_WAIT_H).padStart(2, '0')}:00 UTC)`;

  const before = await readCloses(kv, prevDayKey(day));
  if (!before) {
    const fill = await readFill(kv, day);
    if (fill) return continueFill(fill, kv, now, env, waitUntil, cg);
  }
  const coins = await yahooCoins();
  if (typeof coins === 'string') return coins;
  if (coins.length < 100) return `Yahoo's coin list had only ${coins.length} coins`;
  const notYet = `Yahoo's coin list has not moved on to ${nextDayKey(day)} yet`;

  if (before) {
    const got = coinDayRows(coins, before.c);
    // Read too early: Yahoo still gives the day before's closes. Nothing saved; looked at again later.
    if (!got) return notYet;
    await saveCloses(kv, day, coins, now);
    const twins = yahooTwins(
      coins.map((c) => ({
        yahoo: c.yahoo,
        label: () => {
          const l = coinLabel(c);
          return { sym: l.sym, name: l.name, price: c.prevClose };
        },
      })),
      cg,
    );
    return coinList(got.gained.slice(0, COIN_ROUNDS * SPARK_MAX).map(coinRow), got.gained.length, day, got.compared, now, env, waitUntil, cg, twins);
  }

  // The day before's closes were not saved (the first day, or a day nobody visited): each coin's start is
  // read from Yahoo's daily bars over the next few requests. One call for the largest coins first, to be
  // sure the list's closes are the day's own before saving them as tomorrow's starting point.
  const big = coins.slice(0, SPARK_MAX);
  const series = await fetchSparkAll(big.map((c) => c.yahoo), '5d', '1d').catch(() => new Map());
  if (!series.size) return `Yahoo's daily closes could not be read`;
  if (!listIsPast(big, series, day)) return notYet;
  await saveCloses(kv, day, coins, now);
  const fill = startFill(coins, day, new Date(now).toISOString());
  await saveFill(kv, fill);
  return { later: `Coin closes for ${prevDayKey(day)} were not saved, so each coin's start is read from Yahoo's daily bars: 0 of ${fill.coins.length} read` };
}

/* ── The answer ───────────────────────────────────────────────────────────── */

type GroupResult = { g: BestGroup; captured: boolean; retrySoon: boolean; later: boolean };

/**
 * A group's list for `day`: the saved one, or worked out now if allowed and possible, or the most
 * recent saved day before it (the page labels the real date), or an empty pending group.
 * A stock run can find an earlier session than `day` (the source not caught up yet); that list is
 * saved under its own date and shown as the most recent one.
 */
async function group(
  kind: Kind,
  day: string,
  /** Work the list out now; null when that is not possible (or not this request's turn). */
  capture: (() => Promise<Capture>) | null,
  /** Whether it could be worked out now, even if this request leaves it to the next one. */
  possible: boolean,
  kv: KvLike | undefined,
): Promise<GroupResult> {
  const saved = await readSnap(kv, kind, day);
  // A list saved with fewer than five (by an older version) is worked out again while that is possible.
  if (saved && (saved.items.length >= BEST_SHOW || !capture)) return { g: saved, captured: false, retrySoon: false, later: false };
  // Requests arriving together share one run rather than each reading the whole market.
  const key = snapKey(kind, day);
  let job = running.get(key);
  const mine = !job && !!capture;
  if (!job && capture) {
    job = capture()
      .catch((e): Capture => `Failed: ${errText(e)}`)
      .then(async (g) => {
        if (typeof g === 'string' || 'later' in g) {
          lastWhy.set(key, typeof g === 'string' ? g : g.later);
          return { g: null, later: typeof g !== 'string' };
        }
        if (g.day !== day) lastWhy.set(key, `The source still shows ${g.day}`);
        const have = await readSnap(kv, kind, g.day);
        if (!have || have.items.length < Math.min(BEST_SHOW, g.items.length)) await saveSnap(kv, kind, g);
        return { g, later: false };
      })
      .finally(() => running.delete(key));
    running.set(key, job);
  }
  let worked = false;
  let later = false;
  if (job) {
    const r = await job;
    worked = mine;
    if (r.g && r.g.day === day) return { g: r.g, captured: mine, retrySoon: false, later: false };
    // Looked, and the list is not there yet: not worth asking again until the next look is due,
    // unless it is under way (coins being read from Yahoo's daily bars), when the next request carries on.
    if (mine) {
      later = r.later;
      possible = r.later;
    }
  }
  const why = lastWhy.get(key);
  const extra = why ? { why } : {};
  if (saved) return { g: { ...saved, pending: true, ...extra }, captured: worked, retrySoon: possible, later };
  let earlier = day;
  for (let i = 0; i < 5; i++) {
    earlier = kind === 'stocks' ? sessionBefore(earlier) : prevDayKey(earlier);
    const old = await readSnap(kv, kind, earlier);
    if (old) return { g: { ...old, pending: true, ...extra }, captured: worked, retrySoon: possible, later };
  }
  return {
    g: { day, items: [], checked: 0, at: new Date().toISOString(), source: '', pending: true, ...extra },
    captured: worked,
    retrySoon: possible,
    later,
  };
}

/** Latest prices for "since": one Yahoo call for the stocks and the coins with a known pair, the site's coin list for the rest. */
async function refreshNow(a: BestAnswer, env: Env | undefined, waitUntil: WaitUntil | undefined, now: number): Promise<void> {
  const rows = [...a.crypto.items, ...a.stocks.items];
  const symbols = [...new Set(rows.map((r) => r.yahoo).filter((s): s is string => !!s))].slice(0, 20);
  const [spark, cu] = await Promise.all([
    symbols.length ? fetchSparkAll(symbols, '5d', '1d').catch(() => new Map()) : Promise.resolve(new Map()),
    a.crypto.items.some((r) => r.cg && !r.yahoo) ? getCryptoUniverse(env, waitUntil).catch(() => null) : Promise.resolve(null),
  ]);
  const fresh = (g: BestGroup) => now - Date.parse(g.at) < 3 * 3_600_000;
  for (const g of [a.crypto, a.stocks]) {
    for (const r of g.items) {
      const p = (r.yahoo && spark.get(r.yahoo)?.price) || (r.cg && cu?.coins.find((c) => c.id === r.cg)?.price) || null;
      // Without a current price, an old one would make "since" wrong: leave it out.
      r.now = p ?? (fresh(g) ? r.now : null);
    }
  }
}

type Answer = BestAnswer & { minCap: number; minCapStock: number; minCapCrypto: number; minTraded: number; at: number; retrySoon: boolean };

/** Forget what this isolate holds in memory (saved lists, fills, reasons, Yahoo's session). For the tests only. */
export function forgetForTests(): void {
  mem.clear();
  memFill.clear();
  lastWhy.clear();
  yahooAuth = null;
}

/** The answer at `now`. Exported for the tests, which run it at chosen times. */
export async function answerAt(ctx: Ctx, now: number): Promise<Answer> {
  const cDay = cryptoDay(now);
  const sDay = stockDay(now);
  const cacheKey = `best-answer:v3:${cDay}:${sDay}`;
  const hit = await cacheGet<Answer>(cacheKey);
  if (hit && now - hit.data.at < (hit.data.retrySoon ? PENDING_MS : ANSWER_MS)) return hit.data;

  const kv = ctx.env?.LAYOUTS;
  // One list worked out per request at most; crypto's can be worked out any time on the next UTC day.
  // Each source is looked at no more than every PROBE_MS per location until the day's list is saved,
  // so a source that is down, rate-limited or not caught up yet is not asked on every request.
  const probe = async (kind: Kind, day: string) => {
    const key = `best-probe:${kind}:${day}`;
    const soonKey = `best-soon:${kind}:${day}`;
    const last = (await cacheGet<number>(key))?.data ?? 0;
    // When a list is under way (coins being read from Yahoo's daily bars), the time the next share is due.
    const soonAt = (await cacheGet<number>(soonKey))?.data ?? 0;
    // Kept well past PROBE_MS: the time of the last try also decides which group goes first.
    const keep = { keepSec: 86_400, waitUntil: ctx.waitUntil };
    return {
      due: now - last >= PROBE_MS || (soonAt > 0 && now >= soonAt),
      last,
      mark: () => cachePut(key, now, keep),
      soon: (yes: boolean) => {
        if (yes || soonAt) cachePut(soonKey, yes ? now + SOON_MS : 0, keep);
      },
    };
  };
  const cp = await probe('crypto', cDay);
  const sp = await probe('stocks', sDay);
  const run = async (kind: Kind, day: string, p: typeof cp, allowed: boolean) => {
    const r = await group(
      kind,
      day,
      p.due && allowed
        ? () => {
            p.mark();
            return kind === 'crypto' ? captureCrypto(cDay, now, ctx.env, ctx.waitUntil) : captureStocks(sDay, now);
          }
        : null,
      p.due,
      kv,
    );
    // After this request's own try: due again soon while under way, else at the usual time.
    if (r.captured) p.soon(r.later);
    return r;
  };
  // When both are due, the one tried longer ago goes first, so a source that keeps failing cannot
  // take every request's turn from the other (stocks were stuck a day behind that way).
  let c: GroupResult;
  let s: GroupResult;
  if (!(cp.due && sp.due && sp.last < cp.last)) {
    c = await run('crypto', cDay, cp, true);
    s = await run('stocks', sDay, sp, !c.captured);
  } else {
    s = await run('stocks', sDay, sp, true);
    c = await run('crypto', cDay, cp, !s.captured);
  }

  const answer: Answer = {
    crypto: structuredClone(c.g),
    stocks: structuredClone(s.g),
    minCap: BEST_MIN_CAP_CRYPTO,
    minCapStock: BEST_MIN_CAP_STOCK,
    minCapCrypto: BEST_MIN_CAP_CRYPTO,
    minTraded: BEST_MIN_TRADED,
    at: now,
    retrySoon: c.retrySoon || s.retrySoon,
  };
  await refreshNow(answer, ctx.env, ctx.waitUntil, now);
  cachePut(cacheKey, answer, { keepSec: 86_400, waitUntil: ctx.waitUntil });
  return answer;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const now = Date.now();
  try {
    const a = await answerAt(context, now);
    return jsonResponse(
      { ...a, ok: true, fetchedAt: new Date(now).toISOString() },
      { cacheControl: a.retrySoon ? 'public, max-age=60' : 'public, max-age=600' },
    );
  } catch (e) {
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : 'fetch failed', fetchedAt: new Date(now).toISOString() },
      { cacheControl: 'public, max-age=30' },
    );
  }
}
