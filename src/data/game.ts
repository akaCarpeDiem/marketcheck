/**
 * The daily call: before each US session, guess whether the S&P 500 will close
 * higher or lower than its previous close. For fun; nothing is at stake.
 *
 * Rules, so results are unambiguous:
 * - A call is for one session (a trading day) and is measured close to close:
 *   that session's closing level against the previous session's.
 * - Calls for a session are accepted from the previous close until that
 *   session opens at 9:30 AM ET. While the market is open, calls are locked.
 * - The result is read from the index's daily closes after the session ends.
 *   An exact tie counts as neither a win nor a loss.
 */
import {
  etParts,
  etToMs,
  marketStatus,
  nextTradingDay,
  prevTradingDay,
  type TradingDay,
} from '../../functions/_shared/marketCalendar';
import type { CallPick, GameState } from '../../functions/_shared/userData';
import { getJson } from '../lib/api';
import { quotes } from './market';
import { change, data } from './user';

export const GAME_SYMBOL = '^GSPC';
const ASSET = 'spx';

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
  const d = new Date(Date.UTC(day.y, day.m - 1, day.d - 1));
  const prev = prevTradingDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), true);
  return {
    day,
    prev,
    open: s.state !== 'open',
    opensAt: etToMs(day.y, day.m, day.d, day.open),
    closesAt: etToMs(day.y, day.m, day.d, day.close),
  };
}

/**
 * The reference close for a new call: the index's last close, but only when
 * the quote really is from the session before the target.
 */
export function referenceClose(target: Target): number | null {
  const q = quotes.get().get(GAME_SYMBOL);
  if (!q || q.price == null || q.stale || !q.time) return null;
  return etParts(q.time * 1000).key === target.prev.key ? q.price : null;
}

export const picksFor = (state: GameState): CallPick[] => state.picks.filter((p) => p.asset === ASSET);

export function pickForDay(day: string): CallPick | null {
  return picksFor(data.get().game).find((p) => p.day === day) ?? null;
}

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

export function placeCall(dir: 'up' | 'down'): boolean {
  const target = currentTarget();
  const ref = referenceClose(target);
  if (!target.open || ref == null) return false;
  change((d) => {
    d.game.picks = d.game.picks.filter((p) => !(p.asset === ASSET && p.day === target.day.key));
    d.game.picks.push({ asset: ASSET, day: target.day.key, dir, ref, at: Date.now() });
  });
  return true;
}

let settling: Promise<void> | null = null;

/** Read results for calls whose session has closed. Safe to call often. */
export function settleCalls(): Promise<void> {
  const now = Date.now();
  const due = picksFor(data.get().game).filter((p) => {
    if (p.close != null) return false;
    const [y, m, d] = p.day.split('-').map(Number) as [number, number, number];
    // Ten minutes after the 4:00 PM close (1:00 PM on early-close days is earlier, so this is safe).
    return now > etToMs(y, m, d, 16 * 60 + 10);
  });
  if (!due.length) return Promise.resolve();
  settling ??= (async () => {
    try {
      const res = await getJson<{ ok?: boolean; closes?: number[]; timestamps?: number[] }>(
        `/api/chart?symbol=${encodeURIComponent(GAME_SYMBOL)}&range=3mo&interval=1d`,
      );
      if (!res.ok || !res.closes || !res.timestamps || res.closes.length !== res.timestamps.length) return;
      const closeByDay = new Map<string, number>();
      res.timestamps.forEach((t, i) => closeByDay.set(etParts(t * 1000).key, res.closes![i]!));
      const results = new Map<string, number>();
      for (const p of due) {
        const close = closeByDay.get(p.day);
        if (close != null) results.set(p.day, close);
      }
      if (!results.size) return;
      change((d) => {
        for (const p of d.game.picks) {
          if (p.asset !== ASSET || p.close != null) continue;
          const close = results.get(p.day);
          if (close == null) continue;
          p.close = close;
          p.tie = Math.abs(close - p.ref) < 0.005;
          p.won = !p.tie && close > p.ref === (p.dir === 'up');
        }
        const t = tally(d.game.picks.filter((p) => p.asset === ASSET));
        d.game.wins = t.wins;
        d.game.total = t.total;
        d.game.streak = t.streak;
        d.game.best = Math.max(d.game.best, t.best);
      });
    } catch {
      /* try again on the next refresh */
    } finally {
      settling = null;
    }
  })();
  return settling;
}
