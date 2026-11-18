/**
 * "Yesterday's best buys": the coins and stocks that gained most over the last
 * complete day, i.e. what would have paid most if bought at the start of it,
 * chosen from the whole market rather than the site's own lists.
 *
 * - Stocks: every US-listed stock (Yahoo's stock screener, or Nasdaq's full list when that
 *   fails), over one complete trading session. Each session's list is saved once, under its
 *   real date.
 * - Crypto: every coin on Yahoo's crypto list (CoinMarketCap's figures) over the size floor,
 *   over yesterday in UTC: from its close at the start of the day to its close at the end.
 *   Yahoo gives each coin's last 00:00 UTC close, so each day's closes are saved and the next
 *   day's are compared with them (coinDayRows). When the day before's closes were not saved
 *   (the first day, or a day nobody visited), every coin's start is read from Yahoo's daily
 *   bars instead, a share of the coins per request (CoinFill).
 * - Both: market cap of at least $1 million and at least $100,000 traded on the day,
 *   so a price that jumped on a handful of trades does not count. Warrants, rights,
 *   units, preferred shares and notes are not stocks and are left out.
 * - Every row shown is checked against Yahoo's daily closes; a row whose figures disagree is
 *   left out and the next biggest gainer checked, until there are at least five.
 *
 * Everything here is pure so it can be tested; the endpoint is functions/api/yesterday.ts.
 */
import { dateKey, etParts, prevTradingDay, tradingDay } from './marketCalendar';

/** Nothing smaller than this (USD) is listed, so the list is not always tiny coins that ran. */
export const BEST_MIN_CAP = 1_000_000;
/** At least this much (USD) must have traded over the day. */
export const BEST_MIN_TRADED = 100_000;
/** Rows kept per group. */
export const BEST_KEEP = 10;
/** Rows the page shows per group; a list with fewer is not saved as the day's list. */
export const BEST_SHOW = 5;
/** Daily closes kept for the small trend line, ending on the day measured. */
export const TRAIL_DAYS = 10;
/** Minutes after the close before a session's figures are taken as final. */
export const SETTLE_MIN = 15;

export type BestKind = 'crypto' | 'stock';

export type BestRow = {
  kind: BestKind;
  /** Ticker to show. */
  sym: string;
  name: string;
  /** Yahoo symbol: the stock, or a coin's pair when one is known to be the same coin. */
  yahoo?: string;
  /** CoinGecko id, when the coin is one the site already lists. */
  cg?: string;
  /** CoinPaprika id for coins. */
  paprika?: string;
  image?: string | null;
  marketCap: number;
  /** Close before the day and close at its end. */
  from: number;
  to: number;
  /** Percent change over the day. */
  change: number;
  /** USD traded over the day. */
  traded?: number;
  /** Latest price, so the page can say how it has done since; null when not known. */
  now: number | null;
  /** Daily closes, oldest first, ending with the day measured. */
  trail: number[];
};

export type BestGroup = {
  /** The day measured, YYYY-MM-DD (UTC day for crypto, New York session for stocks). */
  day: string;
  items: BestRow[];
  /** How many assets over the floors were compared. */
  checked: number;
  /** When the figures were read (ISO). */
  at: string;
  source: string;
  /** True while the day's list has not been saved yet (stocks during the next session, before the first visit after the close). */
  pending?: boolean;
  /** While pending: why the day's list could not be worked out on the last try (for checking). */
  why?: string;
};
export type BestAnswer = { crypto: BestGroup; stocks: BestGroup };

/* ── Days ─────────────────────────────────────────────────────────────────── */

const shiftKey = (key: string, days: number): string => {
  const d = new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};
export const nextDayKey = (key: string): string => shiftKey(key, 1);
export const prevDayKey = (key: string, n = 1): string => shiftKey(key, -n);

/** Yesterday's date in UTC, YYYY-MM-DD. */
export function cryptoDay(nowMs: number): string {
  const d = new Date(nowMs - 86_400_000);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The last complete trading session in New York: today's once it has closed (and settled), otherwise the one before. */
export function stockDay(nowMs: number): string {
  const p = etParts(nowMs);
  const today = tradingDay(p.y, p.m, p.d);
  if (today && p.minutes >= today.close + SETTLE_MIN) return today.key;
  return prevTradingDay(p.y, p.m, p.d, false).key;
}

/** The session before `day`. */
export function sessionBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return prevTradingDay(y, m, d, false).key;
}

export const utcKey = (sec: number): string => {
  const d = new Date(sec * 1000);
  return dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};
export const etKey = (sec: number): string => etParts(sec * 1000).key;

/* ── Reading the market-wide lists ────────────────────────────────────────── */

/** One stock from a market-wide screener. */
export type ScreenRow = { sym: string; name: string; price: number; change: number; volume: number; marketCap: number };

const num = (s: unknown): number => {
  const n = parseFloat(String(s ?? '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const unescapeJson = (s: string): string => {
  if (!s.includes('\\')) return s;
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
};

/**
 * Nasdaq's screener answer has 7,000+ rows (about 2 MB). Parsing it whole costs more CPU than a
 * Function on the free plan may use, so the fields needed are read with one pattern instead,
 * with a full parse only if Nasdaq ever changes the field order.
 */
const NASDAQ_ROW =
  /"symbol":"([^"]*)","name":"((?:[^"\\]|\\.)*)","lastsale":"([^"]*)","netchange":"[^"]*","pctchange":"([^"]*)","volume":"([^"]*)","marketCap":"([^"]*)"/g;

export function parseNasdaqScreener(text: string): ScreenRow[] {
  const out: ScreenRow[] = [];
  const push = (sym: string, name: string, last: unknown, pct: unknown, vol: unknown, cap: unknown) => {
    const row = { sym: sym.trim(), name: name.trim(), price: num(last), change: num(pct), volume: num(vol), marketCap: num(cap) };
    if (row.sym && row.price > 0 && Number.isFinite(row.change)) out.push(row);
  };
  for (const m of text.matchAll(NASDAQ_ROW)) push(m[1]!, unescapeJson(m[2]!), m[3], m[4], m[5], m[6]);
  if (out.length >= 50) return out;
  out.length = 0;
  try {
    const j = JSON.parse(text) as { data?: { rows?: Record<string, unknown>[]; table?: { rows?: Record<string, unknown>[] } } };
    for (const r of j.data?.rows ?? j.data?.table?.rows ?? []) push(String(r.symbol ?? ''), String(r.name ?? ''), r.lastsale, r.pctchange, r.volume, r.marketCap);
  } catch {
    /* not JSON: nothing */
  }
  return out;
}

const NOT_SHARES = /\b(warrants?|wts?|rights?|units?|preferred|preference|notes|debentures?|subordinated)\b/i;
/** Yahoo's suffixes for the same things: "XYZ-WT", "XYZ-UN", "XYZ-RI", "PSA-PH". */
const NOT_SHARE_SUFFIX = /-(WT|WS|U|UN|R|RI|RT|P[A-Z]?)$/;

/** Ordinary shares (and ADRs), not warrants, rights, units, preferred shares or notes. */
export const isCommonStock = (sym: string, name: string): boolean => !/[\^~]/.test(sym) && !NOT_SHARE_SUFFIX.test(sym) && !NOT_SHARES.test(name);

/* ── Stocks from Yahoo's screener ─────────────────────────────────────────── */

/** US exchanges whose listings count (Yahoo's codes): Nasdaq's three tiers, NYSE, NYSE American, NYSE Arca, Cboe BZX. */
export const US_LISTED = ['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS'];

/**
 * A query for Yahoo's screener: US-listed shares over the size floor, biggest day change first;
 * `gainersOnly: false` with size 1 just counts them.
 */
export function yahooStockQuery(size: number, gainersOnly: boolean): Record<string, unknown> {
  const operands: unknown[] = [
    { operator: 'EQ', operands: ['region', 'us'] },
    { operator: 'OR', operands: US_LISTED.map((x) => ({ operator: 'EQ', operands: ['exchange', x] })) },
    { operator: 'GTE', operands: ['intradaymarketcap', BEST_MIN_CAP] },
  ];
  if (gainersOnly) operands.push({ operator: 'GT', operands: ['percentchange', 0] });
  return { size, offset: 0, sortField: 'percentchange', sortType: 'DESC', quoteType: 'EQUITY', query: { operator: 'AND', operands }, userId: '', userIdType: 'guid' };
}

/**
 * Stocks from a Yahoo screener answer, as screen rows (change measured from the previous close), with the
 * New York session each row's last price belongs to. Yahoo's own sort is not reliable, so nothing here
 * depends on the order.
 */
export function parseYahooStocks(j: unknown): Array<ScreenRow & { day: string }> {
  type Q = Record<string, unknown>;
  const quotes = ((j as { finance?: { result?: Array<{ quotes?: Q[] }> } })?.finance?.result?.[0]?.quotes ?? []) as Q[];
  const out: Array<ScreenRow & { day: string }> = [];
  for (const q of quotes) {
    const sym = String(q.symbol ?? '');
    const price = Number(q.regularMarketPrice);
    const prev = Number(q.regularMarketPreviousClose);
    const time = Number(q.regularMarketTime);
    if (!sym || !(price > 0) || !(prev > 0) || !(time > 0) || q.quoteType !== 'EQUITY' || !US_LISTED.includes(String(q.exchange))) continue;
    out.push({
      sym,
      name: String(q.longName ?? q.shortName ?? sym),
      price,
      change: (price / prev - 1) * 100,
      volume: Number(q.regularMarketVolume) || 0,
      marketCap: Number(q.marketCap) || 0,
      day: etKey(time),
    });
  }
  return out;
}

/** The session most rows belong to (thinly traded shares can carry an older last trade). */
export function commonDay(rows: Array<{ day: string }>): string | null {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.day, (n.get(r.day) ?? 0) + 1);
  let best: string | null = null;
  for (const [d, k] of n) if (best == null || k > n.get(best)!) best = d;
  return best;
}

/** The largest ordinary shares in a list, used to tell which session it shows. */
export function largestStocks(rows: ScreenRow[], n = 15): ScreenRow[] {
  return rows
    .filter((r) => isCommonStock(r.sym, r.name) && r.price >= 5 && r.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, n);
}

/**
 * Which session a market-wide list shows: the day on which Yahoo's close and day change agree with
 * the list for most of the largest companies (`series`: their Yahoo daily bars). Null when no day
 * agrees well enough, e.g. while a session is still trading or if the list shows late-trading prices.
 */
export function detectSession(rows: ScreenRow[], series: Map<string, { t: number[]; c: number[] }>, minMatches = 8): string | null {
  const votes = new Map<string, number>();
  for (const r of rows) {
    const s = series.get(yahooOfNasdaq(r.sym));
    if (!s || s.t.length !== s.c.length) continue;
    for (let k = 1; k < s.c.length; k++) {
      const close = s.c[k]!;
      const prev = s.c[k - 1]!;
      if (!(close > 0) || !(prev > 0)) continue;
      if (Math.abs(r.price / close - 1) < 0.003 && Math.abs(r.change - (close / prev - 1) * 100) < 0.25) {
        const day = etKey(s.t[k]!);
        votes.set(day, (votes.get(day) ?? 0) + 1);
        break;
      }
    }
  }
  let best: string | null = null;
  let most = 0;
  for (const [day, n] of votes) if (n > most) (best = day), (most = n);
  return most >= minMatches ? best : null;
}

/** Nasdaq writes share classes as "BRK/A"; Yahoo as "BRK-A". */
export const yahooOfNasdaq = (sym: string): string => sym.replace(/\//g, '-');

/** "Focus Universal Inc. Common Stock" → "Focus Universal Inc." */
export const tidyStockName = (name: string): string =>
  name
    .replace(/\s+(Class [A-Z]\s+)?(Common Stock|Common Shares|Ordinary Shares|Subordinate Voting Shares)\b.*$/i, (_m, cls?: string) => (cls ? ` ${cls.trim()}` : ''))
    .replace(/\s+American Depositary Shares\b.*$/i, '')
    .trim() || name;

/* ── Coins from Yahoo's list of every cryptocurrency ─────────────────────── */

/**
 * One coin from Yahoo's crypto screener (CoinMarketCap's figures; days in UTC). Yahoo is used because
 * it answers requests from Cloudflare: APIs that are themselves behind Cloudflare (CoinPaprika,
 * CoinGecko) count every Cloudflare Function as one shared address and refuse them once the per-address
 * allowance is used up.
 */
export type YahooCoin = {
  /** Yahoo symbol: "BTC-USD", or with CoinMarketCap's id added when tickers clash ("AI28846-USD"). */
  yahoo: string;
  price: number;
  /** The price at the last 00:00 UTC, i.e. the close of the UTC day before the one in progress. */
  prevClose: number;
  marketCap: number;
  /** USD traded over the last 24 hours. */
  volume: number;
  /** The coin's object as Yahoo sent it; its name and logo are read from it only for the coins kept. */
  raw: string;
};

/** The fields asked for. Yahoo adds some 25 more of its own to each coin, about 940 bytes a coin. */
export const YAHOO_COIN_FIELDS = 'symbol,shortName,regularMarketPrice,regularMarketPreviousClose,marketCap,volume24Hr,coinImageUrl';

function textIn(o: string, key: string): string | null {
  const k = `"${key}":"`;
  const i = o.indexOf(k);
  if (i < 0) return null;
  let e = i + k.length;
  while (e < o.length && o.charCodeAt(e) !== 34) e += o.charCodeAt(e) === 92 ? 2 : 1;
  return unescapeJson(o.slice(i + k.length, e));
}

function numberIn(o: string, key: string): number {
  const i = o.indexOf(key);
  return i < 0 ? NaN : parseFloat(o.slice(i + key.length, i + key.length + 32));
}

/** "AI28846-USD" with logo ".../28846.png" → "AI"; "C98-USD" stays "C98". */
export function coinTicker(yahoo: string, image: string | null): string {
  const base = yahoo.replace(/-USD$/i, '');
  const id = image?.match(/\/(\d+)\.png(?:$|\?)/)?.[1];
  return id && base.length > id.length && base.endsWith(id) ? base.slice(0, -id.length) : base;
}

/** The ticker, name and logo of a coin, read from its object. */
export function coinLabel(c: YahooCoin): { sym: string; name: string; image: string | null } {
  const image = textIn(c.raw, 'coinImageUrl');
  return { sym: coinTicker(c.yahoo, image), name: (textIn(c.raw, 'shortName') ?? c.yahoo).replace(/\s+USD$/i, '').trim(), image };
}

/**
 * One page of Yahoo's crypto screener (~235 KB; 11 or so are read a day). The coin objects hold no
 * nested objects, so the list is split into them and only the numbers needed for every coin are read.
 * A full parse, or one pattern for all fields, costs more than twice the CPU (measured on real pages),
 * and a Function on the free plan has little to spare.
 */
export function parseYahooCoins(text: string): YahooCoin[] {
  const out: YahooCoin[] = [];
  const push = (raw: string, yahoo: string | null, price: number, prevClose: number, marketCap: number, volume: number) => {
    if (!yahoo || !yahoo.endsWith('-USD') || !(price > 0) || !(prevClose > 0)) return;
    out.push({ yahoo, price, prevClose, marketCap: marketCap > 0 ? marketCap : 0, volume: volume > 0 ? volume : 0, raw });
  };
  const at = text.indexOf('"quotes":[');
  if (at >= 0) {
    for (const o of text.slice(at + 10).split('},{')) {
      const s = o.indexOf('"symbol":"');
      const yahoo = s < 0 ? null : o.slice(s + 10, o.indexOf('"', s + 10));
      push(o, yahoo, numberIn(o, '"regularMarketPrice":'), numberIn(o, '"regularMarketPreviousClose":'), numberIn(o, '"marketCap":'), numberIn(o, '"volume24Hr":'));
    }
  }
  if (out.length >= 50 || at < 0) return out;
  out.length = 0;
  try {
    type Raw = Record<string, unknown>;
    const j = JSON.parse(text) as { finance?: { result?: Array<{ quotes?: Raw[] }> } };
    for (const q of j.finance?.result?.[0]?.quotes ?? [])
      push(JSON.stringify(q), String(q.symbol ?? ''), Number(q.regularMarketPrice), Number(q.regularMarketPreviousClose), Number(q.marketCap), Number(q.volume24Hr));
  } catch {
    /* not JSON: nothing */
  }
  return out;
}

/** Each coin's close at the end of one UTC day, by Yahoo symbol; saved once a day. */
export type DayCloses = { day: string; at: string; c: Record<string, number> };

/** A coin that gained, before its name and logo are read (only the coins checked are named). */
export type CoinGain = { c: YahooCoin; from: number; marketCap: number; change: number };

/** A gainer as a row. */
export function coinRow({ c, from, marketCap, change }: CoinGain): BestRow {
  const { sym, name, image } = coinLabel(c);
  return { kind: 'crypto', sym, name, yahoo: c.yahoo, image, marketCap, from, to: c.prevClose, change, traded: c.volume, now: c.price, trail: [from, c.prevClose] };
}

/** Size at the day's close rather than now. */
const capAtClose = (c: YahooCoin): number => c.marketCap * (c.prevClose / c.price);

/**
 * Every coin over the floors that gained over the UTC day, biggest first, from each coin's close the day
 * before (`before`, saved a day earlier) to its close at the end of the day (`prevClose`, read the day
 * after), and how many coins over the size floor were compared. Null when the reading has not moved on to
 * the new day yet (most coins unchanged) or too few coins are in both readings.
 */
export function coinDayRows(coins: YahooCoin[], before: Record<string, number>): { gained: CoinGain[]; compared: number } | null {
  const gained: CoinGain[] = [];
  let both = 0;
  let same = 0;
  let compared = 0;
  for (const c of coins) {
    const from = before[c.yahoo];
    if (!(from != null && from > 0)) continue;
    both++;
    if (from === c.prevClose) same++;
    const marketCap = capAtClose(c);
    if (marketCap < BEST_MIN_CAP) continue;
    compared++;
    const change = (c.prevClose / from - 1) * 100;
    if (change > 0 && c.volume >= BEST_MIN_TRADED) gained.push({ c, from, marketCap, change });
  }
  if (both < 50 || same > both / 2) return null;
  gained.sort((a, b) => b.change - a.change || b.marketCap - a.marketCap);
  return { gained, compared };
}

/** Daily bars as the checks below need them: times (seconds) and closes. */
export type Bars = { t: number[]; c: number[] };

/**
 * The closes before `day` and at its end from daily bars, or null without both (`prev`: the day the bar
 * before must be, for coins, which trade every day).
 */
export function dayCloses(s: Bars | undefined, day: string, key: (sec: number) => string = utcKey, prev?: string): { k: number; from: number; to: number } | null {
  if (!s?.t.length) return null;
  const k = s.t.findIndex((t) => key(t) === day);
  if (k > 0 && prev && key(s.t[k - 1]!) !== prev) return null;
  const from = k > 0 ? s.c[k - 1]! : 0;
  const to = k > 0 ? s.c[k]! : 0;
  return from > 0 && to > 0 ? { k, from, to } : null;
}

/**
 * Yahoo rounds daily bars to six decimals: a coin at $0.0000014 shows as 0.000001 or 0.000002, a move of
 * ±40% that never happened, and one under $0.0000005 as 0. Coins priced under this are read from hourly
 * bars instead, which keep their digits.
 */
export const COIN_MICRO = 0.001;

/** Daily closes (UTC) from hourly bars: each day's last bar. */
export function dailyFromHourly(s: Bars): Bars {
  const t: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < s.t.length; i++) {
    const v = s.c[i]!;
    if (!(v > 0)) continue;
    const start = Math.floor(s.t[i]! / 86_400) * 86_400;
    if (t.length && t[t.length - 1] === start) c[c.length - 1] = v;
    else {
      t.push(start);
      c.push(v);
    }
  }
  return { t, c };
}

/**
 * Whether Yahoo's coin list has moved on past `day`: its previous closes are the day's closing bars
 * rather than the day before's. Read just after midnight it may not have yet.
 */
export function listIsPast(coins: YahooCoin[], series: Map<string, Bars>, day: string): boolean {
  let yes = 0;
  let no = 0;
  for (const c of coins) {
    const d = dayCloses(series.get(c.yahoo), day);
    if (!d) continue;
    const off = Math.abs(c.prevClose - d.to);
    const offBefore = Math.abs(c.prevClose - d.from);
    if (off < offBefore) yes++;
    else if (off > offBefore) no++;
  }
  return yes >= 5 && no * 3 <= yes;
}

/**
 * A day measured from Yahoo's daily bars when the day before's closes were not saved: the coins that
 * could make the list, each with its close at the day's end from the list, and once its bars have been
 * read, the close before the day (`from`, 0 when Yahoo has no bar) and the bar's own close for the day
 * (`seen`, to check the list's). Yahoo's bars come 20 coins a call, so the coins are read over a few
 * requests; `next` is the first not read yet. Saved in KV in between.
 */
export type FillCoin = { y: string; to: number; m: number; v: number; now: number; sym: string; name: string; img: string | null; from?: number; seen?: number };
export type CoinFill = { day: string; at: string; checked: number; next: number; coins: FillCoin[] };

export function startFill(coins: YahooCoin[], day: string, at: string): CoinFill {
  const list: FillCoin[] = [];
  let checked = 0;
  for (const c of coins) {
    const m = capAtClose(c);
    if (m < BEST_MIN_CAP) continue;
    checked++;
    // One that barely traded cannot make the list, whatever it did: no need to read its bars.
    if (c.volume < BEST_MIN_TRADED) continue;
    const { sym, name, image } = coinLabel(c);
    list.push({ y: c.yahoo, to: c.prevClose, m, v: c.volume, now: c.price, sym, name, img: image });
  }
  return { day, at, checked, next: 0, coins: list };
}

/** Take in the bars for coins `next` to `upto`; returns how many Yahoo had no bars for. */
export function fillFromBars(fill: CoinFill, upto: number, series: Map<string, Bars>): number {
  let missing = 0;
  const end = Math.min(upto, fill.coins.length);
  for (let i = fill.next; i < end; i++) {
    const f = fill.coins[i]!;
    const d = dayCloses(series.get(f.y), fill.day, utcKey, prevDayKey(fill.day));
    f.from = d?.from ?? 0;
    f.seen = d?.to ?? 0;
    if (!d) missing++;
  }
  fill.next = end;
  return missing;
}

/** How far a coin's daily bar may be from the list's close for the same moment. */
const BAR_AGREES = 0.05;

/** The gainers of a finished fill, biggest first. A coin whose bar disagrees with the list's close is left out. */
export function fillRows(fill: CoinFill): BestRow[] {
  const rows: BestRow[] = [];
  for (const f of fill.coins) {
    if (!(f.from && f.from > 0 && f.seen && f.seen > 0) || Math.abs(f.seen / f.to - 1) > BAR_AGREES) continue;
    const change = (f.to / f.from - 1) * 100;
    if (change > 0) rows.push({ kind: 'crypto', sym: f.sym, name: f.name, yahoo: f.y, image: f.img, marketCap: f.m, from: f.from, to: f.to, change, traded: f.v, now: f.now, trail: [f.from, f.to] });
  }
  return rows.sort((a, b) => b.change - a.change || b.marketCap - a.marketCap);
}

/**
 * Whether a coin's daily bars agree with its row: both closes within 5%. Both come from CoinMarketCap and
 * nearly always match to a hundredth of a percent; when they do not, one of them is wrong.
 */
export function barsAgree(r: Pick<BestRow, 'from' | 'to'>, d: { from: number; to: number }): boolean {
  return Math.abs(d.to / r.to - 1) <= BAR_AGREES && Math.abs(d.from / r.from - 1) <= BAR_AGREES;
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

/**
 * The trend line: the closes before the day (the last of which is the day's starting price),
 * then the day's close. Without history it is just the day itself.
 */
export function trailFrom(closesBefore: number[], from: number, to: number): number[] {
  const before = closesBefore.filter((v) => v > 0).slice(-(TRAIL_DAYS - 1));
  if (before.length) before[before.length - 1] = from;
  else before.push(from);
  return [...before, to];
}

/** The biggest gainers, largest first, above the size floor. */
export function rankBest(rows: BestRow[], keep = BEST_KEEP): BestRow[] {
  return rows
    .filter((r) => r.marketCap >= BEST_MIN_CAP && r.change > 0 && Number.isFinite(r.change) && (r.traded == null || r.traded >= BEST_MIN_TRADED))
    .sort((a, b) => b.change - a.change || b.marketCap - a.marketCap)
    .slice(0, keep);
}

/** A Yahoo crypto pair can name a different coin with the same ticker; accept it only if prices agree. */
export function samePrice(a: number | null | undefined, b: number | null | undefined, tolerance = 0.05): boolean {
  return a != null && b != null && a > 0 && b > 0 && Math.abs(a / b - 1) < tolerance;
}
