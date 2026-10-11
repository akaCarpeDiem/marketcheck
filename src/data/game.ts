/**
 * The daily call in the browser: placing a call and reading results. The rules
 * themselves (which session a call is for, how results are tallied) live in
 * functions/_shared/game.ts and are shared with the server, which referees
 * signed-in players' calls for the leaderboard.
 */
import { GAME_ASSET, GAME_SYMBOL, closesByDay, currentTarget, settleAfter, tally, type Target } from '../../functions/_shared/game';
import { etParts } from '../../functions/_shared/marketCalendar';
import type { CallPick, GameState } from '../../functions/_shared/userData';
import { getJson } from '../lib/api';
import { quotes } from './market';
import { change, data } from './user';

export { GAME_SYMBOL, currentTarget, tally, type Target };
const ASSET = GAME_ASSET;

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
/** Sessions already settled in this visit, so a result is sent to the account once, not on every refresh. */
const settledThisVisit = new Set<string>();

/** Read results for calls whose session has closed. Safe to call often. */
export function settleCalls(): Promise<void> {
  const now = Date.now();
  const due = picksFor(data.get().game).filter((p) => p.close == null && !settledThisVisit.has(p.day) && now > settleAfter(p.day));
  if (!due.length) return Promise.resolve();
  settling ??= (async () => {
    try {
      const res = await getJson<{ ok?: boolean; closes?: number[]; timestamps?: number[] }>(
        `/api/chart?symbol=${encodeURIComponent(GAME_SYMBOL)}&range=3mo&interval=1d`,
      );
      if (!res.ok || !res.closes || !res.timestamps || res.closes.length !== res.timestamps.length) return;
      const closeByDay = closesByDay(res.timestamps, res.closes);
      const results = new Map<string, number>();
      for (const p of due) {
        const close = closeByDay.get(p.day);
        if (close != null) results.set(p.day, close);
      }
      if (!results.size) return;
      for (const day of results.keys()) settledThisVisit.add(day);
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
