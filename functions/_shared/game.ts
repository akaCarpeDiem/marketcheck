/**
 * The daily call, shared by the browser and the server.
 *
 * Before each US session a player guesses whether the S&P 500 will close
 * higher or lower than its previous close. For fun; nothing is at stake.
 *
 * Rules, so results are unambiguous:
 * - A call is for one session (a trading day) and is measured close to close:
 *   that session's closing level against the previous session's.
 * - Calls for a session are accepted from the previous close until that
 *   session opens at 9:30 AM ET. While the market is open, calls are locked.
 * - The result is read from the index's daily closes after the session ends.
 *   An exact tie counts as neither a win nor a loss.
 *
 * The leaderboard counts only calls the server saw arrive in time ("verified",
 * `v: 1`), and the server works out their results itself, so a record cannot
 * be made up in the browser. Calls made while signed out stay in the player's
 * own history but never count on the board.
 */
import { etParts, etToMs, marketStatus, nextTradingDay, prevTradingDay, type TradingDay } from './marketCalendar';
import type { CallPick, GameState } from './userData';

export const GAME_SYMBOL = '^GSPC';
export const GAME_ASSET = 'spx';
const MAX_PICKS = 150;

export type Target = {
  /** Session the next call is for. */
  day: TradingDay;
  /** The session before it, whose close is the reference. */
  prev: TradingDay;
  /** True while calls for `day` are accepted. */
  open: boolean;
  /** When `day` opens and closes (ms). */
  opensAt: number;
  closesAt: number;
};

const parseDay = (key: string): [number, number, number] => key.split('-').map(Number) as [number, number, number];

/** The trading day before `key`. */
export function sessionBefore(key: string): TradingDay {
  const [y, m, d] = parseDay(key);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prevTradingDay(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), true);
}

/** The session a call would be for right now. */
export function currentTarget(now = Date.now()): Target {
  const p = etParts(now);
  const s = marketStatus(now);
  let day: TradingDay;
  if (s.state === 'open') {
    // Today's session is running: it can no longer be called, so the next call is for the session after it.
    day = nextTradingDay(p.y, p.m, p.d, false);
  } else {
    const today = nextTradingDay(p.y, p.m, p.d, true);
    const todayOpen = etToMs(today.y, today.m, today.d, today.open);
    day = today.key === p.key && now >= todayOpen ? nextTradingDay(p.y, p.m, p.d, false) : today;
  }
  return {
    day,
    prev: sessionBefore(day.key),
    open: s.state !== 'open',
    opensAt: etToMs(day.y, day.m, day.d, day.open),
    closesAt: etToMs(day.y, day.m, day.d, day.close),
  };
}

/** When a session's result may be read: ten minutes after the 4:00 PM close (early closes are earlier, so this is safe). */
export function settleAfter(day: string): number {
  const [y, m, d] = parseDay(day);
  return etToMs(y, m, d, 16 * 60 + 10);
}

/** Daily bars -> closing level by New York date. */
export function closesByDay(timestamps: number[], closes: number[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = Math.min(timestamps.length, closes.length);
  for (let i = 0; i < n; i++) {
    const c = closes[i];
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) out.set(etParts(timestamps[i]! * 1000).key, c);
  }
  return out;
}

const isTie = (close: number, ref: number): boolean => Math.abs(close - ref) < 0.005;

/** Wins, losses and streaks from the settled calls. */
export function tally(picks: CallPick[]): { wins: number; total: number; streak: number; best: number } {
  const settled = picks.filter((p) => p.close != null && !p.tie).sort((a, b) => (a.day < b.day ? -1 : 1));
  let wins = 0;
  let run = 0;
  let best = 0;
  for (const p of settled) {
    if (p.won) {
      wins += 1;
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return { wins, total: settled.length, streak: run, best };
}

/**
 * What the server keeps when a browser sends its copy of a player's game.
 * `closes` is the index's closing level by date, or null when it could not be read.
 */
export function reconcileGame(
  stored: GameState,
  incoming: GameState,
  now: number,
  closes: Map<string, number> | null,
): GameState {
  const target = currentTarget(now);
  const keyOf = (p: CallPick): string => `${p.asset}|${p.day}`;
  const byKey = new Map<string, CallPick>();
  for (const p of stored.picks) byKey.set(keyOf(p), { ...p });

  for (const p of incoming.picks) {
    const k = keyOf(p);
    const have = byKey.get(k);
    const forOpenSession = p.asset === GAME_ASSET && p.day === target.day.key && target.open;
    if (have?.v) {
      // A verified call is the server's. Before the session opens the player may still change their mind.
      if (forOpenSession && have.dir !== p.dir) byKey.set(k, { ...have, dir: p.dir, at: now });
      continue;
    }
    if (forOpenSession) {
      // In time: this call counts. Its reference is set from the index's own closes when it settles.
      byKey.set(k, { asset: p.asset, day: p.day, dir: p.dir, ref: closes?.get(target.prev.key) ?? p.ref, at: now, v: 1 });
      continue;
    }
    // Any other call is the player's own record (made signed out, or on another device): kept, never verified.
    const own: CallPick = { asset: p.asset, day: p.day, dir: p.dir, ref: p.ref, at: p.at };
    if (p.close != null && typeof p.won === 'boolean') {
      own.close = p.close;
      own.won = p.won;
      if (p.tie) own.tie = true;
    }
    byKey.set(k, own);
  }

  const picks = [...byKey.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).slice(-MAX_PICKS);
  if (closes) settleVerified(picks, closes, now);
  const t = tally(picks.filter((p) => p.asset === GAME_ASSET));
  const out: GameState = { picks, wins: t.wins, total: t.total, streak: t.streak, best: Math.max(t.best, t.streak) };
  if (stored.nick) out.nick = stored.nick;
  if (stored.bs) out.bs = stored.bs;
  return out;
}

/** Fill in results for verified calls whose session has closed. Returns true if anything changed. */
export function settleVerified(picks: CallPick[], closes: Map<string, number>, now: number): boolean {
  let changed = false;
  for (const p of picks) {
    if (!p.v || p.asset !== GAME_ASSET || p.close != null) continue;
    if (now <= settleAfter(p.day)) continue;
    const close = closes.get(p.day);
    const ref = closes.get(sessionBefore(p.day).key);
    if (close == null || ref == null) continue;
    p.ref = ref;
    p.close = close;
    if (isTie(close, ref)) {
      p.tie = true;
      p.won = false;
    } else {
      delete p.tie;
      p.won = close > ref === (p.dir === 'up');
    }
    changed = true;
  }
  return changed;
}

/* ── Leaderboard ───────────────────────────────────────────────────────── */

/**
 * One player's line as stored (in the metadata of a KV key, so the whole board
 * is one list call). Short names keep it far below the 1 KB metadata limit.
 */
export type BoardEntry = {
  /** Display name the player chose. */
  n: string;
  /** All time: wins, settled calls, current streak, best streak. */
  w: number;
  t: number;
  s: number;
  b: number;
  /** Month these month figures are for (YYYY-MM, by session date), wins and settled calls in it. */
  m: string;
  mw: number;
  mt: number;
  /** Verified calls not settled yet: [day, direction]. The board settles them itself when it is read. */
  p: [string, 'up' | 'down'][];
  /** When the player's first verified call was made (ms). Earlier ranks first on a tie. */
  f: number;
};

export const monthOf = (now: number): string => etParts(now).key.slice(0, 7);

/** A player's board line from their verified calls. Null when they have none. */
export function boardEntry(nick: string, picks: CallPick[], now: number): BoardEntry | null {
  const mine = picks.filter((p) => p.v && p.asset === GAME_ASSET).sort((a, b) => (a.day < b.day ? -1 : 1));
  if (!mine.length) return null;
  const all = tally(mine);
  const m = monthOf(now);
  const month = tally(mine.filter((p) => p.day.slice(0, 7) === m));
  return {
    n: nick,
    w: all.wins,
    t: all.total,
    s: all.streak,
    b: all.best,
    m,
    mw: month.wins,
    mt: month.total,
    p: mine.filter((p) => p.close == null).slice(-3).map((p) => [p.day, p.dir]),
    f: Math.min(...mine.map((p) => p.at || now)),
  };
}

export type BoardRow = {
  name: string;
  wins: number;
  total: number;
  /** Share of settled calls that were right, 0 to 100. */
  pct: number;
  streak: number;
  best: number;
};

/** A stored line brought up to date: the month rolled over, and calls settled since it was written. */
export function finishEntry(
  e: BoardEntry,
  closes: Map<string, number> | null,
  now: number,
): { all: BoardRow; month: BoardRow; first: number } {
  const m = monthOf(now);
  let { w, t, s, b } = e;
  let mw = e.m === m ? e.mw : 0;
  let mt = e.m === m ? e.mt : 0;
  if (closes) {
    for (const [day, dir] of [...(e.p ?? [])].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      if (now <= settleAfter(day)) continue;
      const close = closes.get(day);
      const ref = closes.get(sessionBefore(day).key);
      if (close == null || ref == null || isTie(close, ref)) continue;
      const won = close > ref === (dir === 'up');
      t += 1;
      if (won) {
        w += 1;
        s += 1;
        b = Math.max(b, s);
      } else {
        s = 0;
      }
      if (day.slice(0, 7) === m) {
        mt += 1;
        if (won) mw += 1;
      }
    }
  }
  const row = (wins: number, total: number): BoardRow => ({
    name: e.n,
    wins,
    total,
    pct: total ? Math.round((wins / total) * 1000) / 10 : 0,
    streak: s,
    best: b,
  });
  return { all: row(w, t), month: row(mw, mt), first: e.f ?? 0 };
}

/** Most right first; then the better hit rate; then the longer streak; then whoever started earlier. */
export function rankBoard(rows: { row: BoardRow; first: number }[], limit = 50): BoardRow[] {
  return rows
    .filter((r) => r.row.total > 0)
    .sort(
      (a, b) =>
        b.row.wins - a.row.wins || b.row.pct - a.row.pct || b.row.streak - a.row.streak || a.first - b.first || (a.row.name < b.row.name ? -1 : 1),
    )
    .slice(0, limit)
    .map((r) => r.row);
}

const RESERVED = /(market\s*check|admin|moderator|official|support|staff|anthropic|claude)/i;
// Not a filter anyone would call complete; it stops the obvious on a public board.
const RUDE = /(fuck|shit|cunt|bitch|nigg|fagg|rape|nazi|hitler|porn|dick|cock|pussy|whore|slut|retard|kike|spic|chink)/i;

/**
 * A display name for the board: 3 to 20 characters from letters, digits,
 * spaces, dot, dash and underscore. Returns null if it cannot be used.
 */
export function cleanNick(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const nick = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (nick.length < 3 || nick.length > 20) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(nick)) return null;
  const flat = nick.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (RESERVED.test(nick) || RESERVED.test(flat) || RUDE.test(flat)) return null;
  // Looks like an email address or a link: people should not publish those by accident.
  if (/@|https?:|www\./i.test(nick)) return null;
  return nick;
}

/** Two names that would look the same on the board. */
export const nickKey = (nick: string): string => nick.toLowerCase().replace(/[\s._-]+/g, '');
