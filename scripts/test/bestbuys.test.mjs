// The pure parts of the coin list's checks and of adding CoinGecko's coins (functions/_shared/bestBuys.ts).
import assert from 'node:assert/strict';
import { coinCheckVerdict, mergeCoinGecko, parseCgDay, sameCoin, yahooTickers } from '../../functions/_shared/bestBuys.ts';

// A check is published only when few lookups failed and most gainers checked out.
assert.equal(coinCheckVerdict({ looked: 20, failed: 3, rejected: 1 }), null, 'a few skipped and one left out: published');
assert.match(coinCheckVerdict({ looked: 20, failed: 6, rejected: 0 }) ?? '', /could not be read for 6 of the 20/, 'over a quarter of lookups failed: not published');
assert.match(coinCheckVerdict({ looked: 20, failed: 4, rejected: 7 }) ?? '', /11 of the 20 .* did not check out/, 'most did not check out: not published');
// 2026-11-20: every coin over $0.001 failed the daily check, 90 of 100 gainers.
assert.ok(coinCheckVerdict({ looked: 100, failed: 0, rejected: 90 }), 'the list of 2026-11-20 would not have been published');
assert.equal(coinCheckVerdict({ looked: 0, failed: 0, rejected: 0 }), null);

// CoinGecko's file: only the day asked for, and only rows that add up.
const row = (o) => ({ id: 'kyo', symbol: 'KYO', name: 'KYO', image: null, from: 1, to: 2.286, change: 128.6, marketCap: 4.25e6, traded: 1.8e6, ...o });
assert.equal(parseCgDay({ day: '2026-11-19', rows: [row()] }, '2026-11-20'), null, 'another day: not used');
assert.equal(parseCgDay({ day: '2026-11-20' }, '2026-11-20'), null, 'no rows: not a file');
const f = parseCgDay({ day: '2026-11-20', compared: 2566, rows: [row(), row({ id: 'bad', change: 500 }), row({ id: 'zero', from: 0 })] }, '2026-11-20');
assert.deepEqual(f.rows.map((r) => r.id), ['kyo'], 'rows whose change is not to / from are dropped');
assert.equal(f.compared, 2566);

// The same coin on both lists: ticker, and name or price.
assert.ok(sameCoin({ symbol: 'grnd', name: 'SuperWalk', to: 0.0141 }, { sym: 'GRND', name: 'SuperWalk USD', price: 0.0139 }));
assert.ok(sameCoin({ symbol: 'GFI', name: 'Goldfinch Protocol', to: 0.0368 }, { sym: 'GFI', name: 'Goldfinch', price: 0.0365 }), 'names differ, price agrees');
assert.ok(!sameCoin({ symbol: 'GFI', name: 'Goldfinch', to: 0.0368 }, { sym: 'GFI', name: 'Gravity Finance', price: 0.0000757 }), 'another coin with the ticker');
assert.ok(!sameCoin({ symbol: 'KYO', name: 'KYO', to: 1 }, { sym: 'KY', name: 'KYO', price: 1 }));
assert.deepEqual(yahooTickers('GFI13967-USD'), ['GFI13967', 'GFI']);
assert.deepEqual(yahooTickers('TOP-USD'), ['TOP']);

// Merging: a coin only CoinGecko has is added; one on Yahoo's list (a gainer or not) is not added twice.
const y = { kind: 'crypto', sym: 'GRND', name: 'SuperWalk', yahoo: 'GRND-USD', marketCap: 1.1e7, from: 0.00915, to: 0.01416, change: 54.7, traded: 4e6, now: null, trail: [0.00915, 0.01416] };
const cg = parseCgDay(
  {
    day: '2026-11-20',
    rows: [
      row(),
      row({ id: 'superwalk', symbol: 'GRND', name: 'SuperWalk', from: 0.00915, to: 0.01411, change: (0.01411 / 0.00915 - 1) * 100, traded: 12.9e6 }),
      row({ id: 'elsa', symbol: 'ELSA', name: 'HeyElsa', from: 0.0566, to: 0.0667, change: (0.0667 / 0.0566 - 1) * 100 }),
    ],
  },
  '2026-11-20',
);
const m = mergeCoinGecko([y], cg, [{ sym: 'ELSA', name: 'HeyElsa', price: 0.0667 }]);
assert.equal(m.added, 1);
assert.deepEqual(m.rows.map((r) => r.sym), ['GRND', 'KYO'], 'KYO added; ELSA is on Yahoo (not a gainer there), so not added');
assert.equal(m.rows[0].traded, 12.9e6, "the coin on both keeps Yahoo's row with CoinGecko's day volume");
assert.equal(m.rows[1].cg, 'kyo');
assert.equal(y.traded, 4e6, "Yahoo's rows are not changed in place");
assert.deepEqual(mergeCoinGecko([y], null, []).rows, [y], 'no file: Yahoo alone');

console.log('bestbuys: all checks passed');
