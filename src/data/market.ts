/**
 * Live market data held in the browser: the crypto universe, the stock/ETF
 * universe, quotes for anything else the page shows, sparklines, the mood
 * index and headlines. Views subscribe to the signals; the refresh loops at
 * the bottom keep them current while the tab is visible.
 */
import { CG_MARKETS, CG_MARKETS_ETH, coinsFromCoinGecko, ethFromMain, withIntradayFrom, type Coin } from '../../functions/_shared/cryptoUniverse';
import type { Equity } from '../../functions/_shared/equityUniverse';
import { marketStatus } from '../../functions/_shared/marketCalendar';
import { getJson } from '../lib/api';
import { readJson, writeJson } from '../lib/storage';
import { poll, type Poller } from '../lib/poll';
import { signal } from '../lib/store';

export type { Coin, Equity };

export type Status = 'loading' | 'ok' | 'stale' | 'error';

export type CryptoState = {
  coins: Coin[];
  byId: Map<string, Coin>;
  /** Upper-case ticker -> the largest coin with that ticker. */
  bySymbol: Map<string, Coin>;
  at: number;
  status: Status;
  /** Ethereum list only: true when this is the part of it found in the main list, not the full list. */
  partial?: boolean;
};

export type EquityState = {
  items: Equity[];
  bySymbol: Map<string, Equity>;
  at: number;
  status: Status;
};

export type Quote = {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  prevClose: number | null;
  marketCap: number | null;
  /** Unix seconds of the last trade. */
  time: number | null;
  name?: string;
  ok: boolean;
  /** When this quote was fetched (ms). */
  at: number;
  /** True when the last refresh failed and this is the previous value. */
  stale?: boolean;
};

export const crypto = signal<CryptoState>({ coins: [], byId: new Map(), bySymbol: new Map(), at: 0, status: 'loading' });
export const equities = signal<EquityState>({ items: [], bySymbol: new Map(), at: 0, status: 'loading' });
/** Tokens of the Ethereum ecosystem, loaded when the Ethereum tab is opened. */
export const eth = signal<CryptoState>({ coins: [], byId: new Map(), bySymbol: new Map(), at: 0, status: 'loading' });
/** Yahoo quotes for symbols outside the two universes. Replaced on every refresh. */
export const quotes = signal<Map<string, Quote>>(new Map());
/** Symbol -> thinned one-year close series. */
export const sparks = signal<Map<string, number[]>>(new Map());
/** Seven-day change for symbols that came through the sparkline endpoint. Updated together with `sparks`. */
export const weekChanges = new Map<string, number>();

export type Mood = {
  value: number;
  label: string;
  yesterday: number | null;
  week: number | null;
  month: number | null;
  at: number;
};
export const mood = signal<Mood | null>(null);

/* ── Crypto ────────────────────────────────────────────────────────────── */

type CryptoPayload = { items?: Coin[]; ok?: boolean; stale?: boolean; partial?: boolean; fetchedAt?: string };

function setCoins(coins: Coin[], at: number, status: Status, target = crypto, partial = false): void {
  const byId = new Map<string, Coin>();
  const bySymbol = new Map<string, Coin>();
  for (const c of coins) {
    byId.set(c.id, c);
    // The list is in market-cap order, so the first coin with a ticker is the biggest.
    if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, c);
  }
  target.set(partial ? { coins, byId, bySymbol, at, status, partial } : { coins, byId, bySymbol, at, status });
}

/** The last list this browser saw, so a return visit paints at once and an outage still shows something. */
const CRYPTO_KEEP = 'mc-crypto-last-v1';
const CRYPTO_KEEP_MS = 6 * 3_600_000;
let cryptoKeptAt = 0;

function keepCoins(coins: Coin[], at: number): void {
  if (at - cryptoKeptAt < 5 * 60_000) return;
  cryptoKeptAt = at;
  writeJson(CRYPTO_KEEP, { at, coins });
}

function restoreCoins(): void {
  const kept = readJson<{ at?: number; coins?: Coin[] } | null>(CRYPTO_KEEP, null);
  if (!kept || typeof kept.at !== 'number' || !Array.isArray(kept.coins) || kept.coins.length < 50) return;
  if (Date.now() - kept.at > CRYPTO_KEEP_MS) return;
  if (!kept.coins.every((c) => c && typeof c.id === 'string' && typeof c.symbol === 'string' && c.ch)) return;
  cryptoKeptAt = kept.at;
  setCoins(kept.coins, kept.at, 'stale');
}

/**
 * CoinGecko sometimes turns our server away (it limits by address, and the
 * server's address is shared with other sites). The visitor's own browser is
 * not affected, so it asks CoinGecko directly, at most once a minute.
 */
const directAt = new Map<string, number>();
async function coinsDirect(url: string = CG_MARKETS, least = 50): Promise<Coin[] | null> {
  if (Date.now() - (directAt.get(url) ?? 0) < 55_000) return null;
  directAt.set(url, Date.now());
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12_000);
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const coins = coinsFromCoinGecko(await res.json());
    return coins.length >= least ? coins : null;
  } catch {
    return null;
  }
}

export async function refreshCrypto(): Promise<void> {
  if (!crypto.get().coins.length) restoreCoins();
  let coins: Coin[] = [];
  let at = Date.now();
  let stale = false;
  try {
    const data = await getJson<CryptoPayload>('/api/cryptos');
    coins = Array.isArray(data.items) ? data.items : [];
    if (data.fetchedAt) at = Date.parse(data.fetchedAt) || at;
    stale = Boolean(data.stale);
  } catch {
    coins = [];
  }
  // A copy a few minutes old is normal between CoinGecko refreshes and is not worth a warning.
  if (stale && Date.now() - at <= 10 * 60_000) stale = false;
  // Nothing from the server, or only an old copy: try CoinGecko from here.
  if (!coins.length || stale) {
    const direct = await coinsDirect();
    if (direct) {
      coins = direct;
      at = Date.now();
      stale = false;
    }
  }
  if (coins.length) {
    setCoins(coins, at, stale ? 'stale' : 'ok');
    if (!stale) keepCoins(coins, at);
    return;
  }
  const prev = crypto.get();
  crypto.set({ ...prev, status: prev.coins.length ? 'stale' : 'error' });
}

/* ── Ethereum tokens (on demand) ────────────────────────────────────────── */

let ethBusy: Promise<void> | null = null;
let ethTriedAt = 0;
/** A copy older than this is not shown as current. */
const ETH_OLD_MS = 15 * 60_000;

/**
 * Load the Ethereum list if it is missing or due for a refresh. Three sources,
 * in order: our server; CoinGecko asked from this browser (when the server was
 * refused or only has an old copy); and, if neither has it, the Ethereum
 * tokens in the main coin list, which is already on the page and has fallbacks
 * of its own. So the tab is only ever empty when the site has no coin prices at all.
 */
export function loadEth(): Promise<void> {
  if (ethBusy) return ethBusy;
  const have = eth.get();
  // Views ask on every repaint: a full, current list is good for two minutes, anything less is retried sooner.
  const wait = have.coins.length && have.status === 'ok' && !have.partial ? 120_000 : 45_000;
  if (Date.now() - ethTriedAt < wait) return Promise.resolve();
  ethTriedAt = Date.now();
  ethBusy = (async () => {
    let coins: Coin[] = [];
    let at = Date.now();
    let stale = false;
    let partial = false;
    try {
      const data = await getJson<CryptoPayload>('/api/cryptos?universe=eth', { timeout: 20_000 });
      coins = Array.isArray(data.items) ? data.items : [];
      if (data.fetchedAt) at = Date.parse(data.fetchedAt) || at;
      stale = Boolean(data.stale) && Date.now() - at > ETH_OLD_MS;
      // The server could only offer the Ethereum tokens from its main list.
      partial = Boolean(data.partial) && coins.length > 0;
    } catch {
      coins = [];
    }
    if (!coins.length || stale || partial) {
      const direct = await coinsDirect(CG_MARKETS_ETH, 20);
      if (direct) {
        // CoinGecko has no 4h or 8h figures; borrow them from the main list for coins in both.
        coins = withIntradayFrom(direct, crypto.get().coins);
        at = Date.now();
        stale = false;
        partial = false;
      }
    }
    if (!coins.length || stale || partial) {
      const main = crypto.get();
      const known = ethFromMain(main.coins);
      // Current prices for fewer tokens beat old prices for all of them; and of two partial lists, the newer wins.
      const better = !coins.length || (partial ? main.at >= at : main.at - at > ETH_OLD_MS);
      if (known.length >= 8 && better) {
        coins = known;
        at = main.at;
        stale = main.status !== 'ok';
        partial = true;
      }
    }
    if (coins.length) {
      setCoins(coins, at, stale ? 'stale' : 'ok', eth, partial);
    } else {
      eth.set({ ...eth.get(), at: Date.now(), status: eth.get().coins.length ? 'stale' : 'error' });
    }
  })().finally(() => {
    ethBusy = null;
  });
  return ethBusy;
}

/* ── Stocks and ETFs ───────────────────────────────────────────────────── */

type EquityPayload = { items?: Equity[]; ok?: boolean; stale?: boolean; fetchedAt?: string };

export async function refreshEquities(): Promise<void> {
  const prev = equities.get();
  try {
    const data = await getJson<EquityPayload>('/api/equities', { timeout: 25_000 });
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.some((e) => e.ok)) throw new Error('no quotes');
    const bySymbol = new Map<string, Equity>();
    for (const e of items) bySymbol.set(e.symbol, e);
    equities.set({
      items,
      bySymbol,
      at: data.fetchedAt ? Date.parse(data.fetchedAt) : Date.now(),
      status: data.stale ? 'stale' : 'ok',
    });
  } catch {
    equities.set({ ...prev, status: prev.items.length ? 'stale' : 'error' });
  }
}

/* ── Other quotes (indexes, futures, anything a user added) ────────────── */

/**
 * Who wants which Yahoo symbols. Each part of the page registers its list
 * under its own name; the refresh loop fetches the union.
 */
const wanted = new Map<string, string[]>();
const wantedSparks = new Map<string, string[]>();

/** The browser asks for 15 symbols per request; the Function caps a request at 20. */
const MARKETS_CHUNK = 15;
const SPARK_CHUNK = 20;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function neededQuoteSymbols(): string[] {
  const eq = equities.get().bySymbol;
  const set = new Set<string>();
  for (const list of wanted.values()) {
    for (const s of list) {
      // Universe symbols are already in the equities feed, unless that feed is down.
      if (s && (!eq.has(s) || !eq.get(s)!.ok)) set.add(s);
    }
  }
  return [...set];
}

type MarketsPayload = {
  quotes?: Array<{
    requested?: string;
    symbol: string;
    price: number | null;
    changePercent: number | null;
    prevClose?: number | null;
    marketCap?: number | null;
    time?: number | null;
    shortName?: string;
    ok: boolean;
  }>;
};

let quotesBusy: Promise<void> | null = null;

export function refreshQuotes(): Promise<void> {
  quotesBusy ??= (async () => {
    try {
      const symbols = neededQuoteSymbols();
      if (!symbols.length) return;
      const prev = quotes.get();
      const next = new Map(prev);
      const now = Date.now();
      await Promise.all(
        chunk(symbols, MARKETS_CHUNK).map(async (part) => {
          try {
            const data = await getJson<MarketsPayload>(`/api/markets?symbols=${encodeURIComponent(part.join(','))}`);
            for (const q of data.quotes ?? []) {
              const key = q.requested ?? q.symbol;
              if (q.ok && q.price != null) {
                next.set(key, {
                  symbol: key,
                  price: q.price,
                  changePercent: q.changePercent,
                  prevClose: q.prevClose ?? null,
                  marketCap: q.marketCap ?? null,
                  time: q.time ?? null,
                  name: q.shortName,
                  ok: true,
                  at: now,
                });
              } else {
                const old = prev.get(key);
                next.set(
                  key,
                  old?.price != null
                    ? { ...old, stale: true }
                    : { symbol: key, price: null, changePercent: null, prevClose: null, marketCap: null, time: null, ok: false, at: now },
                );
              }
            }
          } catch {
            for (const s of part) {
              const old = prev.get(s);
              if (old) next.set(s, { ...old, stale: true });
            }
          }
        }),
      );
      quotes.set(next);
    } finally {
      quotesBusy = null;
    }
  })();
  return quotesBusy;
}

/** Register the Yahoo symbols a part of the page needs. Pass [] to stop. */
export function wantQuotes(owner: string, symbols: string[]): void {
  const list = [...new Set(symbols.filter(Boolean))];
  const before = wanted.get(owner) ?? [];
  if (list.length) wanted.set(owner, list);
  else wanted.delete(owner);
  const known = quotes.get();
  const eq = equities.get().bySymbol;
  if (list.some((s) => !before.includes(s) && !known.has(s) && !eq.has(s))) void refreshQuotes();
}

type SparkPayload = { series?: Array<{ symbol: string; closes: number[]; ok: boolean; week?: number | null }> };

let sparksBusy: Promise<void> | null = null;
const sparkTried = new Map<string, number>();

export function refreshSparks(force = false): Promise<void> {
  sparksBusy ??= (async () => {
    try {
      const have = sparks.get();
      const now = Date.now();
      const set = new Set<string>();
      for (const list of wantedSparks.values()) {
        for (const s of list) {
          if (!s) continue;
          const tried = sparkTried.get(s) ?? 0;
          if (force ? now - tried > 60_000 : !have.has(s) && now - tried > 60_000) set.add(s);
        }
      }
      if (!set.size) return;
      const next = new Map(have);
      await Promise.all(
        chunk([...set], SPARK_CHUNK).map(async (part) => {
          for (const s of part) sparkTried.set(s, now);
          try {
            const data = await getJson<SparkPayload>(`/api/sparklines?symbols=${encodeURIComponent(part.join(','))}`, {
              timeout: 20_000,
            });
            for (const row of data.series ?? []) {
              if (!row.ok) continue;
              next.set(row.symbol, row.closes);
              if (typeof row.week === 'number' && Number.isFinite(row.week)) weekChanges.set(row.symbol, row.week);
              else weekChanges.delete(row.symbol);
            }
          } catch {
            /* keep what we have */
          }
        }),
      );
      sparks.set(next);
    } finally {
      sparksBusy = null;
    }
  })();
  return sparksBusy;
}

export function wantSparks(owner: string, symbols: string[]): void {
  const list = [...new Set(symbols.filter(Boolean))];
  if (list.length) wantedSparks.set(owner, list);
  else wantedSparks.delete(owner);
  const have = sparks.get();
  if (list.some((s) => !have.has(s))) void refreshSparks();
}

/* ── Mood ──────────────────────────────────────────────────────────────── */

type MoodPayload = {
  ok?: boolean;
  now?: { value: number; label: string; at: number };
  yesterday?: { value: number } | null;
  week?: { value: number } | null;
  month?: { value: number } | null;
};

/** True once a reading was asked for and none came back. */
export const moodMissing = signal(false);

export async function refreshMood(): Promise<void> {
  try {
    const d = await getJson<MoodPayload>('/api/mood');
    if (!d.ok || !d.now) {
      if (!mood.get()) moodMissing.set(true);
      return;
    }
    moodMissing.set(false);
    mood.set({
      value: d.now.value,
      label: d.now.label,
      yesterday: d.yesterday?.value ?? null,
      week: d.week?.value ?? null,
      month: d.month?.value ?? null,
      at: d.now.at,
    });
  } catch {
    if (!mood.get()) moodMissing.set(true);
  }
}

/* ── Refresh loops ─────────────────────────────────────────────────────── */

const override = Number(import.meta.env.VITE_REFRESH_MS) || 0;

/** How often to refresh, by how much can be changing right now. */
const pace = {
  crypto: () => override || 60_000,
  equities: () => {
    const s = marketStatus().state;
    return s === 'open' ? override || 60_000 : s === 'pre' || s === 'post' ? 5 * 60_000 : 10 * 60_000;
  },
  // Futures and FX trade nearly round the clock, so these keep a steady pace.
  quotes: () => override || (marketStatus().open ? 30_000 : 60_000),
};

let pollers: Poller[] = [];

/** Start the background refresh. Safe to call once at boot. */
export function startMarketData(): void {
  if (pollers.length) return;
  pollers = [
    poll(refreshCrypto, pace.crypto),
    poll(refreshEquities, pace.equities),
    poll(refreshQuotes, pace.quotes, 400),
    poll(() => refreshSparks(true), 15 * 60_000, 15 * 60_000),
    poll(refreshMood, 30 * 60_000, 400),
  ];
  // Once the universe arrives, some wanted symbols no longer need their own quote, and vice versa.
  let hadEquities = false;
  equities.subscribe((s) => {
    const has = s.items.length > 0;
    if (has !== hadEquities) {
      hadEquities = has;
      void refreshQuotes();
    }
  });
}

/** The time of the most recent successful refresh across feeds. */
export function lastUpdated(): number {
  let at = Math.max(crypto.get().at, equities.get().at);
  for (const q of quotes.get().values()) if (q.ok && !q.stale && q.at > at) at = q.at;
  return at;
}

/** 'ok' when every feed that has answered is healthy. */
export function overallStatus(): Status {
  const c = crypto.get().status;
  const e = equities.get().status;
  if (c === 'loading' && e === 'loading') return 'loading';
  if (c === 'error' && e === 'error') return 'error';
  if (c === 'ok' && e === 'ok') return 'ok';
  if (c === 'loading' || e === 'loading') return c === 'ok' || e === 'ok' ? 'ok' : 'loading';
  return 'stale';
}
