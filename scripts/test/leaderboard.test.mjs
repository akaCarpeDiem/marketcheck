// Checks the leaderboard's pure helpers: movement, hot flag, formatting and the read log.
import assert from 'node:assert/strict';
import { count, geoName, hasUnreadTop, isHot, movement, progress, pruneRead, readSet, setRead, subName, traffic, updatedText } from '../../src/lib/leaderboard.ts';

assert.deepEqual(movement(2, 5, true), { kind: 'up', by: 3 });
assert.deepEqual(movement(5, 2, true), { kind: 'down', by: 3 });
assert.deepEqual(movement(3, 3, true), { kind: 'same', by: 0 });
assert.deepEqual(movement(3, null, true), { kind: 'new', by: 0 });
assert.deepEqual(movement(3, null, false), { kind: 'none', by: 0 });
assert.deepEqual(movement(1, null, true, 4), { kind: 'up', by: 3 }, 'the reader’s own previous refresh fills in');
assert.deepEqual(movement(1, 2, true, 9), { kind: 'up', by: 1 }, 'the server rank wins');

assert.ok(isHot(90, { kind: 'same', by: 0 }));
assert.ok(!isHot(89, { kind: 'up', by: 2 }));
assert.ok(isHot(50, { kind: 'up', by: 3 }));
assert.ok(!isHot(50, { kind: 'down', by: 5 }));

assert.equal(count(596), '596');
assert.equal(count(5300), '5.3k');
assert.equal(count(12_400), '12k');
assert.equal(count(1_000_000), '1M');
assert.equal(traffic(1_000_000), '1M+');
assert.equal(traffic(200), '200+');
assert.equal(geoName('IN'), 'India');
assert.equal(geoName('GB'), 'UK');
assert.equal(geoName('ZZ'), 'ZZ');
assert.equal(subName('technology'), 'r/technology');
assert.equal(subName('r/technology'), 'r/technology');
assert.equal(updatedText(1000, 1000 + 30_000), 'Updated just now');
assert.equal(updatedText(0, 3 * 60_000 + 5000), 'Updated 3 min ago');
assert.equal(updatedText(0, 2 * 3_600_000), 'Updated 2 h ago');

// The read log keeps today and the two days before; everything else, and bad data, goes.
const log = { '2026-11-17': ['a'], '2026-11-16': ['b'], '2026-11-15': ['c'], '2026-11-14': ['d'], '2026-11-18': ['future'], junk: 'x', '2026-11-13': 5 };
assert.deepEqual(pruneRead(log, '2026-11-17'), { '2026-11-17': ['a'], '2026-11-16': ['b'], '2026-11-15': ['c'] });
assert.deepEqual(pruneRead(null, '2026-11-17'), {});
let l = setRead({}, '2026-11-17', 'a', true);
l = setRead(l, '2026-11-17', 'a', true);
assert.deepEqual(l, { '2026-11-17': ['a'] }, 'marking twice keeps one');
l = setRead(l, '2026-11-17', 'b', true);
assert.deepEqual([...readSet(l)].sort(), ['a', 'b']);
l = setRead(l, '2026-11-17', 'a', false);
assert.deepEqual([...readSet(l)], ['b']);

const r = new Set(['a', 'b']);
assert.deepEqual(progress(['a', 'b', 'c'], r), { read: 2, total: 3, done: false });
assert.deepEqual(progress(['a', 'b'], r), { read: 2, total: 2, done: true });
assert.equal(progress([], r).done, false);
assert.ok(hasUnreadTop(['a', 'x'], r));
assert.ok(!hasUnreadTop(['a', 'b', 'c'], r, 2));

console.log('leaderboard: ok');
