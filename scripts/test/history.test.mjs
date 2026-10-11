// Checks the hourly price record behind the 4h and 8h changes: the window measured is the window named,
// missing history gives "no figure" (never a figure over the wrong window), and writes stay rare.
import assert from 'node:assert/strict';
import { attachIntraday, pricesAt, recordSnapshot, resetHistoryMemory } from '../../functions/_shared/cryptoHistory.ts';

const edge = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const hit = edge.get(typeof req === 'string' ? req : req.url);
      return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
    },
    async put(req, res) {
      edge.set(typeof req === 'string' ? req : req.url, { body: await res.text(), headers: Object.fromEntries(res.headers) });
    },
  },
};
const HOUR = 3_600_000;
const makeKv = () => ({
  store: new Map(),
  puts: 0,
  gets: 0,
  full: false,
  async get(k) {
    this.gets += 1;
    return this.store.get(k) ?? null;
  },
  async put(k, v) {
    if (this.full) throw new Error('KV PUT failed: daily limit');
    this.puts += 1;
    this.store.set(k, v);
  },
});
const T0 = Math.floor(Date.parse('2026-10-12T00:00:00Z') / HOUR) * HOUR;
/** Cache writes finish in the background; wait for them before wiping the cache. */
const wipe = async () => {
  await new Promise((r) => setTimeout(r, 15));
  resetHistoryMemory();
  edge.clear();
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
// 60 coins whose price is a known function of time, so every change can be worked out by hand.
const priceOf = (i, t) => (10 + i) * (1 + 0.001 * ((t - T0) / HOUR) * (i % 2 ? 1 : -0.5));
const coinsAt = (t) => Array.from({ length: 60 }, (_, i) => ({ id: `coin${i}`, price: priceOf(i, t), ch: {} }));

/* ── reading a price between two records ── */
{
  const a = { at: T0, p: { x: 100, y: 5 } };
  const b = { at: T0 + HOUR, p: { x: 110, y: 5 } };
  assert.ok(near(pricesAt([a, b], T0 + HOUR / 2).get('x'), 105), 'halfway between two records');
  assert.ok(near(pricesAt([a, b], T0).get('x'), 100), 'exactly on a record');
  assert.equal(pricesAt([a], T0 + 5 * 60_000).get('x'), 100, 'a single record a few minutes away stands in');
  assert.equal(pricesAt([a], T0 + 40 * 60_000).size, 0, 'a single record 40 minutes away does not');
  const far = { at: T0 + 4 * HOUR, p: { x: 200 } };
  assert.equal(pricesAt([a, far], T0 + 2 * HOUR).size, 0, 'records four hours apart are not joined');
  assert.equal(pricesAt([], T0).size, 0);
}

/* ── one record an hour, however many requests and locations ── */
{
  const kv = makeKv();
  resetHistoryMemory();
  assert.equal(await recordSnapshot(kv, coinsAt(T0), T0 + 60_000), true);
  for (let m = 2; m < 60; m += 2) assert.equal(await recordSnapshot(kv, coinsAt(T0), T0 + m * 60_000), false);
  assert.equal(kv.puts, 1, 'thirty refreshes in an hour make one write');
  // Another location (fresh memory) sees the record and does not write its own.
  resetHistoryMemory();
  assert.equal(await recordSnapshot(kv, coinsAt(T0), T0 + 30 * 60_000), false);
  assert.equal(kv.puts, 1);
  // Too few prices (a broken upstream answer) is never recorded.
  assert.equal(await recordSnapshot(kv, coinsAt(T0).slice(0, 10), T0 + 2 * HOUR), false);
  // A used-up write allowance is not an error, and the next refresh tries again.
  kv.full = true;
  assert.equal(await recordSnapshot(kv, coinsAt(T0), T0 + 3 * HOUR), false);
  kv.full = false;
  assert.equal(await recordSnapshot(kv, coinsAt(T0), T0 + 3 * HOUR + 60_000), true);
}

/* ── a day of hourly records: 4h and 8h are measured over 4 and 8 hours ── */
{
  const kv = makeKv();
  resetHistoryMemory();
  edge.clear();
  const check = async (now, expect4, expect8) => {
    const coins = coinsAt(now);
    await attachIntraday(coins, kv, now);
    for (const [tf, hours, expected] of [['4h', 4, expect4], ['8h', 8, expect8]]) {
      const have = coins.filter((c) => c.ch[tf] != null).length;
      if (!expected) {
        assert.equal(have, 0, `${tf} must be empty at +${(now - T0) / HOUR}h, not measured over a shorter window`);
        continue;
      }
      assert.equal(have, coins.length, `${tf} is available at +${(now - T0) / HOUR}h`);
      for (const [i, c] of coins.entries()) {
        const was = priceOf(i, now - hours * HOUR);
        const want = ((c.price - was) / was) * 100;
        // Prices are linear in time here, so reading between hourly records is exact (to the stored precision).
        assert.ok(Math.abs(c.ch[tf] - want) < 1e-3, `${tf} for coin${i}: ${c.ch[tf]} vs ${want}`);
      }
    }
  };
  // Records are written at 7 minutes past each hour.
  for (let h = 0; h <= 12; h++) {
    const now = T0 + h * HOUR + 7 * 60_000;
    // What a visitor arriving 20 minutes after the record would see, given history so far.
    await recordSnapshot(kv, coinsAt(now), now);
    await wipe();
    await check(now + 20 * 60_000, h >= 4, h >= 8);
  }
  assert.equal(kv.puts, 13, 'one write an hour');

  // A missed hour (no visitors, or writes refused) is bridged; a longer hole is not.
  // (Other hours than above: the cache layer remembers records by hour, as it should.)
  const T1 = T0 + 200 * HOUR;
  const kv2 = makeKv();
  await wipe();
  for (const h of [0, 1, 3, 4, 5, 9, 10]) await recordSnapshot(kv2, coinsAt(T1 + h * HOUR), T1 + h * HOUR);
  resetHistoryMemory();
  let coins = coinsAt(T1 + 6 * HOUR);
  await attachIntraday(coins, kv2, T1 + 6 * HOUR); // 4h ago = +2h, between the +1h and +3h records
  assert.ok(coins.every((c) => c.ch['4h'] != null), 'a single missed hour is bridged');
  resetHistoryMemory();
  coins = coinsAt(T1 + 11 * HOUR);
  await attachIntraday(coins, kv2, T1 + 11 * HOUR); // 4h ago = +7h, inside the +5h..+9h hole
  assert.ok(coins.every((c) => c.ch['4h'] == null), 'a four-hour hole gives no figure');

  // Reading costs little: the same records are not fetched from KV again and again.
  await wipe();
  const before = kv.gets;
  for (let i = 0; i < 20; i++) await attachIntraday(coinsAt(T0 + 12 * HOUR + 30 * 60_000), kv, T0 + 12 * HOUR + 30 * 60_000 + i * 1000);
  assert.ok(kv.gets - before <= 6, `20 refreshes read KV ${kv.gets - before} times`);

  // Without storage there are simply no intraday figures.
  coins = coinsAt(T0 + 12 * HOUR);
  await attachIntraday(coins, null, T0 + 12 * HOUR);
  assert.ok(coins.every((c) => c.ch['4h'] === null && c.ch['8h'] === null));
}

console.log('history: all checks passed');
