// Checks that the leaderboard cannot be gamed from the browser, and that it ranks and settles correctly.
import assert from 'node:assert/strict';
import { boardEntry, cleanNick, finishEntry, nickKey, rankBoard, reconcileGame, currentTarget } from '../../functions/_shared/game.ts';
import { buildBoard } from '../../functions/_shared/gameServer.ts';

const empty = () => ({ picks: [], streak: 0, best: 0, wins: 0, total: 0 });
const at = (iso) => Date.parse(iso);
// S&P closes: Fri Oct 9, Mon Oct 12 (up), Tue Oct 13 (down), Wed Oct 14 (flat), Thu Oct 15 (up)
const closes = new Map([
  ['2026-10-08', 7765.36],
  ['2026-10-09', 7811.54],
  ['2026-10-12', 7850.0],
  ['2026-10-13', 7790.25],
  ['2026-10-14', 7790.25],
  ['2026-10-15', 7801.0],
]);
const pick = (day, dir, extra = {}) => ({ asset: 'spx', day, dir, ref: 1, at: 1, ...extra });

/* ── a call placed in time is verified, with the server's reference and time ── */
const sunday = at('2026-10-11T18:00:00Z');
assert.equal(currentTarget(sunday).day.key, '2026-10-12');
let g = reconcileGame(empty(), { ...empty(), picks: [pick('2026-10-12', 'up', { ref: 1234 })] }, sunday, closes);
assert.equal(g.picks.length, 1);
assert.equal(g.picks[0].v, 1, 'in time: counts');
assert.equal(g.picks[0].ref, 7811.54, "the reference is Friday's real close, not what the browser sent");
assert.equal(g.picks[0].at, sunday, "the time is the server's");
assert.equal(g.picks[0].close, undefined);

/* ── the player may change their mind until the open, not after ── */
const mondayEarly = at('2026-10-12T12:00:00Z'); // 8:00 AM ET
g = reconcileGame(g, { ...empty(), picks: [pick('2026-10-12', 'down')] }, mondayEarly, closes);
assert.equal(g.picks[0].dir, 'down');
const mondayOpen = at('2026-10-12T15:00:00Z'); // 11:00 AM ET, session running
const locked = reconcileGame(g, { ...empty(), picks: [pick('2026-10-12', 'up')] }, mondayOpen, closes);
assert.equal(locked.picks[0].dir, 'down', 'a call cannot be switched once the session is open');

/* ── nothing sent from the browser can fake a record ── */
const cheat = {
  ...empty(),
  wins: 99,
  total: 99,
  streak: 99,
  best: 99,
  nick: 'Hacker',
  picks: [
    pick('2026-10-12', 'down', { v: 1, close: 1, won: true }), // tries to mark its own call won
    pick('2026-10-09', 'up', { v: 1, close: 7811.54, won: true }), // a "verified" call for a day already over
    pick('2026-10-13', 'up', { v: 1 }), // not open yet on Monday mid-session? (it is the next target, but calls are locked while open)
  ],
};
const after = reconcileGame(g, cheat, mondayOpen, closes);
const byDay = Object.fromEntries(after.picks.map((p) => [p.day, p]));
assert.equal(byDay['2026-10-12'].won, undefined, 'a verified call is settled by the server only');
assert.equal(byDay['2026-10-09'].v, undefined, 'a call for a past session is never verified');
assert.equal(byDay['2026-10-13'].v, undefined, 'a call sent while calls are locked is not verified');
assert.equal(after.nick, undefined, 'a display name cannot be set through a save');
assert.ok(after.total <= 2 && after.streak <= 2, 'totals are recomputed, not taken from the browser');
// Only verified calls reach the board.
const entry = boardEntry('Hacker', after.picks, mondayOpen);
assert.equal(entry.t, 0);
assert.deepEqual(entry.p, [['2026-10-12', 'down']]);

/* ── the server settles verified calls itself, with the right reference ── */
const mondayNight = at('2026-10-12T22:00:00Z');
let s = reconcileGame(g, g, mondayNight, closes);
assert.equal(s.picks[0].close, 7850.0);
assert.equal(s.picks[0].won, false, 'called lower, closed higher');
// Not before ten past four.
const justClosed = at('2026-10-12T20:05:00Z');
assert.equal(reconcileGame(g, g, justClosed, closes).picks[0].close, undefined, 'no result until the close is final');
// Without the closes nothing is settled and nothing is lost.
assert.equal(reconcileGame(g, g, mondayNight, null).picks[0].v, 1);

/* ── a week of play ── */
let game = empty();
const days = [
  ['2026-10-11T18:00:00Z', '2026-10-12', 'up'], // right
  ['2026-10-12T22:00:00Z', '2026-10-13', 'down'], // right
  ['2026-10-13T22:00:00Z', '2026-10-14', 'up'], // flat: no result
  ['2026-10-14T22:00:00Z', '2026-10-15', 'down'], // wrong
];
for (const [when, day, dir] of days) {
  game = reconcileGame(game, { ...game, picks: [...game.picks, pick(day, dir)] }, at(when), closes);
}
game = reconcileGame(game, game, at('2026-10-15T22:00:00Z'), closes);
assert.equal(game.picks.filter((p) => p.v).length, 4);
assert.equal(game.wins, 2);
assert.equal(game.total, 3, 'the flat day counts as neither');
assert.equal(game.streak, 0);
assert.equal(game.best, 2);
const line = boardEntry('Ada', game.picks, at('2026-10-15T22:00:00Z'));
assert.deepEqual([line.w, line.t, line.s, line.b, line.m, line.mw, line.mt], [2, 3, 0, 2, '2026-10', 2, 3]);
assert.deepEqual(line.p, []);

/* ── the board settles calls made since a line was written, and rolls the month over ── */
const stale = { n: 'Mo', w: 1, t: 1, s: 1, b: 1, m: '2026-10', mw: 1, mt: 1, p: [['2026-10-13', 'down'], ['2026-10-15', 'up']], f: 5 };
let f = finishEntry(stale, closes, at('2026-10-15T22:00:00Z'));
assert.deepEqual([f.all.wins, f.all.total, f.all.streak, f.all.best], [3, 3, 3, 3], 'both pending calls were right');
assert.deepEqual([f.month.wins, f.month.total], [3, 3]);
f = finishEntry(stale, closes, at('2026-10-13T15:00:00Z')); // Tuesday mid-session: nothing new to settle
assert.deepEqual([f.all.wins, f.all.total], [1, 1]);
f = finishEntry({ ...stale, p: [] }, closes, at('2026-11-03T15:00:00Z'));
assert.deepEqual([f.month.wins, f.month.total, f.all.wins], [0, 0, 1], 'a new month starts at zero; all time is kept');

/* ── ranking ── */
const mk = (n, w, t, s, first) => ({ row: { name: n, wins: w, total: t, pct: t ? Math.round((w / t) * 1000) / 10 : 0, streak: s, best: s }, first });
const ranked = rankBoard([mk('a', 5, 10, 0, 1), mk('b', 7, 9, 2, 2), mk('c', 7, 8, 1, 3), mk('d', 7, 8, 4, 4), mk('e', 0, 0, 0, 0), mk('f', 7, 8, 4, 1)]);
assert.deepEqual(ranked.map((r) => r.name), ['f', 'd', 'c', 'b', 'a'], 'most right, then hit rate, then streak, then who started first; no calls, no place');

const board = buildBoard([{ entry: line }, { entry: stale }], closes, at('2026-10-15T22:00:00Z'));
assert.equal(board.month, '2026-10');
assert.deepEqual(board.monthRows.map((r) => r.name), ['Mo', 'Ada']);
assert.equal(board.players, 2);

/* ── display names ── */
assert.equal(cleanNick('  Bullish   Badger '), 'Bullish Badger');
for (const bad of ['ab', 'x'.repeat(21), 'someone@example.com', 'https://x.io', 'Market Check', 'admin', 'Off1cial Support', 'f.u.c.k', '<b>hi</b>', '', null, 42, '  ']) {
  assert.equal(cleanNick(bad), null, `"${bad}" must be refused`);
}
assert.equal(cleanNick('Zoë 99'), 'Zoë 99');
assert.equal(nickKey('Bull_ish Badger'), nickKey('bullishbadger'), 'look-alike names count as the same');

console.log('board: all checks passed');
