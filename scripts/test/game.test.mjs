// Checks the daily call's rules: which session a call is for, when calls are locked, and how results are tallied.
import assert from 'node:assert/strict';
import { currentTarget, tally } from '../../src/data/game.ts';

const at = (iso) => currentTarget(Date.parse(iso));

// Sunday: the call is for Monday, measured against Friday's close.
let t = at('2026-10-11T09:20:00Z');
assert.equal(t.day.key, '2026-10-12');
assert.equal(t.prev.key, '2026-10-09');
assert.equal(t.open, true);

// Monday before the open (9:00 AM ET): still Monday's session.
t = at('2026-10-12T13:00:00Z');
assert.equal(t.day.key, '2026-10-12');
assert.equal(t.open, true);

// Monday mid-session: locked, and the next call will be for Tuesday.
t = at('2026-10-12T15:00:00Z');
assert.equal(t.open, false);
assert.equal(t.day.key, '2026-10-13');
assert.equal(t.prev.key, '2026-10-12');

// Monday after the close: Tuesday, against Monday's close.
t = at('2026-10-12T21:00:00Z');
assert.equal(t.day.key, '2026-10-13');
assert.equal(t.prev.key, '2026-10-12');
assert.equal(t.open, true);

// Friday evening: Monday, against Friday.
t = at('2026-10-16T22:00:00Z');
assert.equal(t.day.key, '2026-10-19');
assert.equal(t.prev.key, '2026-10-16');

// Thanksgiving (closed all day): Friday's short session, against Wednesday.
t = at('2026-11-26T17:00:00Z');
assert.equal(t.day.key, '2026-11-27');
assert.equal(t.prev.key, '2026-11-25');
assert.equal(new Date(t.closesAt).toISOString(), '2026-11-27T18:00:00.000Z');

const pick = (day, dir, ref, close, extra = {}) => ({ asset: 'spx', day, dir, ref, at: 0, close, won: close > ref === (dir === 'up'), ...extra });
const picks = [
  pick('2026-10-05', 'up', 100, 101),
  pick('2026-10-06', 'down', 101, 102),
  pick('2026-10-07', 'up', 102, 103),
  pick('2026-10-08', 'down', 103, 101),
  pick('2026-10-09', 'up', 101, 101, { tie: true, won: false }),
  { asset: 'spx', day: '2026-10-12', dir: 'up', ref: 101, at: 0 },
];
assert.deepEqual(tally(picks), { wins: 3, total: 4, streak: 2, best: 2 });
assert.deepEqual(tally([]), { wins: 0, total: 0, streak: 0, best: 0 });

console.log('game: all checks passed');
