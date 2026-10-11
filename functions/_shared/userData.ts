/**
 * Per-user data kept with the account: watchlist, portfolio holdings, a few
 * display preferences and the daily-call game record. One KV value per user
 * (`data:<sub>`), written only when the user changes something.
 *
 * The same shape is kept in the browser's localStorage for visitors who are
 * not signed in, so this file is shared by the Function and the client.
 */

export type AssetKind = 'stock' | 'etf' | 'index' | 'future' | 'fx' | 'crypto';

/** A pointer to something with a price. */
export type AssetRef = {
  /** Unique key: "y:<yahoo symbol>" or "c:<coingecko id>". */
  key: string;
  /** Ticker to show, e.g. "AAPL", "BTC". */
  sym: string;
  name: string;
  kind: AssetKind;
  /** Yahoo Finance symbol when the price comes from Yahoo. */
  yahoo?: string;
  /** CoinGecko id when the price comes from the crypto universe. */
  cg?: string;
};

export type Holding = {
  id: string;
  ref: AssetRef;
  /** Units held. */
  qty: number;
  /** Average price paid per unit, USD. Null when not entered. */
  cost: number | null;
  /** Added at (ms). */
  at: number;
};

export type CallPick = {
  /** Asset key from the game's list. */
  asset: string;
  /** Session the call is for, YYYY-MM-DD. */
  day: string;
  dir: 'up' | 'down';
  /** The close the call is measured against. */
  ref: number;
  /** When the call was made (ms). */
  at: number;
  /** Filled in once the session has closed. */
  close?: number;
  won?: boolean;
  /** The close matched the reference exactly: counts as neither a win nor a loss. */
  tie?: boolean;
  /** 1 = the server saw this call arrive before the session opened. Only these count on the leaderboard. */
  v?: 1;
};

export type GameState = {
  picks: CallPick[];
  streak: number;
  best: number;
  wins: number;
  total: number;
  /** Display name on the leaderboard. Set only through /api/game/nick. */
  nick?: string;
  /** What the server last wrote to the board for this player, so it writes again only on a change. */
  bs?: string;
};

export type UserData = {
  v: 1;
  watchlist: AssetRef[];
  holdings: Holding[];
  prefs: Record<string, string | number | boolean>;
  game: GameState;
  /** Last change (ms). Used to detect a newer copy on another device. */
  updatedAt: number;
};

export const MAX_WATCH = 60;
export const MAX_HOLDINGS = 100;
const MAX_PICKS = 150;
const KINDS = new Set<AssetKind>(['stock', 'etf', 'index', 'future', 'fx', 'crypto']);

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function emptyUserData(): UserData {
  return {
    v: 1,
    watchlist: [],
    holdings: [],
    prefs: {},
    game: { picks: [], streak: 0, best: 0, wins: 0, total: 0 },
    updatedAt: 0,
  };
}

export function normalizeAssetRef(raw: unknown): AssetRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const yahoo = str(r.yahoo, 24);
  const cg = str(r.cg, 64).toLowerCase();
  if (yahoo && !/^[A-Za-z0-9.^=\-]{1,24}$/.test(yahoo)) return null;
  if (cg && !/^[a-z0-9\-_.]{1,64}$/.test(cg)) return null;
  if (!yahoo && !cg) return null;
  const key = cg ? `c:${cg}` : `y:${yahoo.toUpperCase()}`;
  const kind = KINDS.has(r.kind as AssetKind) ? (r.kind as AssetKind) : cg ? 'crypto' : 'stock';
  const sym = str(r.sym, 16) || (yahoo || cg).toUpperCase().slice(0, 16);
  const ref: AssetRef = { key, sym, name: str(r.name, 80) || sym, kind };
  if (yahoo) ref.yahoo = yahoo;
  if (cg) ref.cg = cg;
  return ref;
}

function normalizeHolding(raw: unknown): Holding | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ref = normalizeAssetRef(r.ref);
  const qty = num(r.qty);
  if (!ref || qty == null || qty <= 0 || qty > 1e15) return null;
  const cost = num(r.cost);
  return {
    id: str(r.id, 24) || `${ref.key}-${Math.round(num(r.at) ?? 0)}`.slice(0, 24),
    ref,
    qty,
    cost: cost != null && cost >= 0 && cost < 1e12 ? cost : null,
    at: num(r.at) ?? 0,
  };
}

function normalizeGame(raw: unknown): GameState {
  const out: GameState = { picks: [], streak: 0, best: 0, wins: 0, total: 0 };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.picks)) {
    for (const item of r.picks.slice(-MAX_PICKS)) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      const asset = str(p.asset, 24);
      const day = str(p.day, 10);
      const ref = num(p.ref);
      if (!asset || !/^\d{4}-\d{2}-\d{2}$/.test(day) || ref == null || ref <= 0) continue;
      if (p.dir !== 'up' && p.dir !== 'down') continue;
      const pick: CallPick = { asset, day, dir: p.dir, ref, at: num(p.at) ?? 0 };
      const close = num(p.close);
      if (close != null && close > 0 && typeof p.won === 'boolean') {
        pick.close = close;
        pick.won = p.won;
        if (p.tie === true) pick.tie = true;
      }
      if (p.v === 1) pick.v = 1;
      out.picks.push(pick);
    }
  }
  const count = (v: unknown) => Math.max(0, Math.min(100_000, Math.floor(num(v) ?? 0)));
  out.streak = count(r.streak);
  out.best = Math.max(count(r.best), out.streak);
  out.wins = count(r.wins);
  out.total = Math.max(count(r.total), out.wins);
  const nick = str(r.nick, 24);
  if (nick) out.nick = nick;
  const bs = str(r.bs, 600);
  if (bs) out.bs = bs;
  return out;
}

/** Always returns a valid UserData; anything malformed is dropped. */
export function normalizeUserData(raw: unknown): UserData {
  const out = emptyUserData();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;

  if (Array.isArray(r.watchlist)) {
    const seen = new Set<string>();
    for (const item of r.watchlist) {
      const ref = normalizeAssetRef(item);
      if (!ref || seen.has(ref.key)) continue;
      seen.add(ref.key);
      out.watchlist.push(ref);
      if (out.watchlist.length >= MAX_WATCH) break;
    }
  }
  if (Array.isArray(r.holdings)) {
    const ids = new Set<string>();
    for (const item of r.holdings) {
      const h = normalizeHolding(item);
      if (!h) continue;
      while (ids.has(h.id)) h.id = `${h.id.slice(0, 20)}${ids.size}`;
      ids.add(h.id);
      out.holdings.push(h);
      if (out.holdings.length >= MAX_HOLDINGS) break;
    }
  }
  if (r.prefs && typeof r.prefs === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(r.prefs as Record<string, unknown>)) {
      if (n >= 40 || !/^[a-zA-Z0-9_.-]{1,32}$/.test(k)) continue;
      if (typeof v === 'string') out.prefs[k] = v.slice(0, 120);
      else if (typeof v === 'boolean') out.prefs[k] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) out.prefs[k] = v;
      else continue;
      n++;
    }
  }
  out.game = normalizeGame(r.game);
  out.updatedAt = Math.max(0, num(r.updatedAt) ?? 0);
  return out;
}

export function userDataIsEmpty(d: UserData): boolean {
  return !d.watchlist.length && !d.holdings.length && !d.game.picks.length && !Object.keys(d.prefs).length;
}
