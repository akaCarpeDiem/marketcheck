// Checks the numbers behind the charts: moving averages, lining series up, volatility, worst drop,
// correlation, portfolio totals, and the rules of "Yesterday's best buys".
import assert from 'node:assert/strict';
import { alignTo, correlation, dailyLast, maxDrawdown, pairedDailyReturns, rebase, returns, sma, sumHoldings, volatility } from '../../src/lib/stats.ts';
import {
  BEST_MIN_CAP,
  BEST_MIN_TRADED,
  TRAIL_DAYS,
  barsAgree,
  cryptoDay,
  isCommonStock,
  parseYahooStocks,
  commonDay,
  yahooStockQuery,
  parseNasdaqScreener,
  parseYahooCoins,
  coinTicker,
  coinLabel,
  coinDayRows,
  coinRow,
  dailyFromHourly,
  dayCloses,
  fillFromBars,
  fillRows,
  listIsPast,
  rankBest,
  samePrice,
  startFill,
  sessionBefore,
  detectSession,
  largestStocks,
  stockDay,
  tidyStockName,
  trailFrom,
  yahooOfNasdaq,
} from '../../functions/_shared/bestBuys.ts';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const DAY = 86_400_000;

/* ── Moving average ── */
{
  const v = [1, 2, 3, 4, 5, 6];
  const a = sma(v, 3);
  assert.deepEqual(a.slice(0, 2), [null, null], 'nothing until there are three values');
  assert.deepEqual(a.slice(2), [2, 3, 4, 5]);
  assert.deepEqual(sma(v, 10), v.map(() => null), 'a period longer than the series gives nothing');
}

/* ── Lining up series and rebasing ── */
{
  const s = [
    { t: 10, v: 100 },
    { t: 20, v: 110 },
    { t: 40, v: 120 },
  ];
  assert.deepEqual(alignTo([5, 10, 25, 40, 99], s), [null, 100, 110, 120, 120], 'last value at or before each time');
  const r = rebase([null, 50, 75, 25]);
  assert.equal(r[0], null);
  assert.ok(near(r[1], 0) && near(r[2], 50) && near(r[3], -50), 'percent from the first value');
}

/* ── Returns, volatility, worst drop ── */
{
  const rets = returns([100, 110, 99, 99]);
  assert.ok(near(rets[0], 0.1) && near(rets[1], -0.1) && near(rets[2], 0));
  assert.equal(volatility([0.01, 0.02], 252), null, 'too few returns');
  const flat = volatility([0.01, 0.01, 0.01, 0.01], 252);
  assert.ok(near(flat, 0), 'steady returns have no volatility');
  const vol = volatility([0.01, -0.01, 0.01, -0.01], 252);
  // Sample standard deviation of ±1% alternating (n=4) is 0.011547; × √252 × 100.
  assert.ok(Math.abs(vol - 0.0115470054 * Math.sqrt(252) * 100) < 1e-6, `annualised volatility ${vol}`);

  const dd = maxDrawdown([100, 120, 90, 130, 117, 140]);
  assert.ok(near(dd.pct, -25), 'from 120 down to 90 is the deepest fall');
  assert.equal(dd.peak, 1);
  assert.equal(dd.trough, 2);
  assert.equal(maxDrawdown([1, 2, 3]).pct, 0, 'a series that only rises never draws down');
}

/* ── Correlation ── */
{
  const a = [1, 2, 3, 4, 5, 6];
  assert.ok(near(correlation(a, a.map((x) => x * 3 + 1)), 1), 'moving together is +1');
  assert.ok(near(correlation(a, a.map((x) => -x)), -1), 'moving opposite is −1');
  assert.equal(correlation(a, [2, 2, 2, 2, 2, 2]), null, 'a flat series has no correlation');
  assert.equal(correlation([1, 2], [1, 2]), null, 'too few points');

  // Stocks skip the weekend, a coin does not: only days both have count.
  const start = Date.UTC(2026, 10, 2, 21); // a Monday
  const stock = [0, 1, 2, 3, 4, 7, 8].map((d, i) => ({ t: start + d * DAY, v: 100 + i }));
  const coin = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((d, i) => ({ t: start + d * DAY, v: 50 + i * 2 }));
  const [ra, rb] = pairedDailyReturns(stock, coin);
  assert.equal(ra.length, 6, 'six shared steps between seven shared days');
  assert.equal(ra.length, rb.length);
}

/* ── Hourly to daily, and portfolio totals ── */
{
  const t0 = Date.UTC(2026, 0, 1);
  const hourly = Array.from({ length: 49 }, (_, i) => ({ t: t0 + i * 3_600_000, v: i }));
  const daily = dailyLast(hourly);
  assert.deepEqual(daily.map((p) => p.v), [23, 47, 48], 'the last value of each UTC day');

  const days = (vals, from = 0) => vals.map((v, i) => ({ t: t0 + (i + from) * DAY, v }));
  const total = sumHoldings([
    { qty: 2, bars: days([10, 11, 12, 13]) },
    { qty: 1, bars: days([100, 90, 80], 1) },
  ]);
  assert.deepEqual(
    total.map((p) => p.v),
    [2 * 11 + 100, 2 * 12 + 90, 2 * 13 + 80],
    'starts on the first day both holdings have a price',
  );
  assert.deepEqual(sumHoldings([]), []);
}

/* ── Yesterday's best buys ── */
{
  // Monday 16 Nov 2026, 3 pm New York: crypto's yesterday is Sunday (UTC); stocks' last finished session is Friday's.
  const monday = Date.UTC(2026, 10, 16, 20);
  assert.equal(cryptoDay(monday), '2026-11-15');
  assert.equal(stockDay(monday), '2026-11-13');
  // Once Monday's session has closed and settled (4:15 pm), it is the last finished one.
  assert.equal(stockDay(Date.UTC(2026, 10, 16, 21, 10)), '2026-11-13', '4:10 pm: not settled yet');
  assert.equal(stockDay(Date.UTC(2026, 10, 16, 21, 20)), '2026-11-16', '4:20 pm: Monday is done');
  assert.equal(stockDay(Date.UTC(2026, 10, 17, 3)), '2026-11-16', 'late Monday night (already Tuesday in UTC)');
  // The day after Thanksgiving (Thursday 26 Nov) closes early at 1 pm; before that the last session is Wednesday's.
  assert.equal(stockDay(Date.UTC(2026, 10, 27, 15)), '2026-11-25');
  assert.equal(stockDay(Date.UTC(2026, 10, 27, 18, 30)), '2026-11-27', '1:30 pm on an early-close day');
  assert.equal(sessionBefore('2026-11-16'), '2026-11-13');

  // Which session a market-wide list shows, from the largest companies' Yahoo closes (the real case:
  // on Monday evening Nasdaq's list still showed Friday, so it must never be assumed to be the latest).
  const stamp = (d) => Date.UTC(2026, 10, d, 14, 30) / 1000; // daily bars are stamped at the 9:30 open
  const bars = (closes) => ({ t: [stamp(11), stamp(12), stamp(13), stamp(16)], c: closes });
  const series = new Map();
  const listed = [];
  for (let k = 0; k < 15; k++) {
    const c = [100 + k, 101 + k, 103 + k, 99 + k];
    series.set(`BIG${k}`, bars(c));
    // The list shows Friday the 13th: Friday's close, and its change from Thursday.
    listed.push({ sym: `BIG${k}`, name: `Big ${k} Inc. Common Stock`, price: c[2], change: (c[2] / c[1] - 1) * 100, volume: 1e7, marketCap: 1e12 - k });
  }
  assert.equal(detectSession(listed, series), '2026-11-13', 'Friday, not Monday');
  const mondayList = listed.map((r, k) => ({ ...r, price: 99 + k, change: ((99 + k) / (103 + k) - 1) * 100 }));
  assert.equal(detectSession(mondayList, series), '2026-11-16');
  // Late-trading prices or a session still trading match no close: nothing is guessed.
  assert.equal(detectSession(listed.map((r) => ({ ...r, price: r.price * 1.04 })), series), null);
  assert.equal(detectSession(listed.slice(0, 5), series), null, 'too few agree');
  assert.deepEqual(largestStocks([...listed, { sym: 'WRNT', name: 'X Warrant', price: 9, change: 1, volume: 1, marketCap: 9e12 }], 3).map((r) => r.sym), ['BIG0', 'BIG1', 'BIG2']);

  // Nasdaq's screener, read without parsing the whole answer.
  const nq = JSON.stringify({
    data: {
      rows: [
        { symbol: 'FCUV', name: 'Focus Universal Inc. Common Stock', lastsale: '$7.08', netchange: '4.16', pctchange: '142.466%', volume: '117440767', marketCap: '6952645.00', country: 'United States' },
        { symbol: 'BRK/A', name: 'Berkshire Hathaway Inc. "A" Class A Common Stock', lastsale: '$712,000.00', netchange: '1', pctchange: '0.1%', volume: '120', marketCap: '1,030,000,000,000.00' },
        { symbol: 'ZZZ', name: 'No Price Inc.', lastsale: 'NA', netchange: 'NA', pctchange: '--', volume: '0', marketCap: '' },
      ],
    },
  });
  // With fewer than 50 rows the pattern result is not trusted and the answer is parsed in full: same result.
  const rows = parseNasdaqScreener(nq);
  assert.equal(rows.length, 2, 'rows without a price or change are skipped');
  assert.deepEqual(rows[0], { sym: 'FCUV', name: 'Focus Universal Inc. Common Stock', price: 7.08, change: 142.466, volume: 117440767, marketCap: 6952645 });
  assert.equal(rows[1].price, 712000, 'thousands separators');
  assert.equal(rows[1].name, 'Berkshire Hathaway Inc. "A" Class A Common Stock', 'escaped quotes in names');
  const many = JSON.stringify({ data: { rows: Array.from({ length: 60 }, (_, i) => ({ symbol: `S${i}`, name: `Co ${i} \\"x\\"`, lastsale: '$2.00', netchange: '0.1', pctchange: `${i}%`, volume: '1000', marketCap: '5000000.00' })) } });
  const fast = parseNasdaqScreener(many);
  assert.equal(fast.length, 60, 'the fast path reads every row');
  assert.equal(fast[59].change, 59);
  assert.equal(fast[3].name, 'Co 3 \\"x\\"', 'escapes in names are undone');

  assert.ok(isCommonStock('FCUV', 'Focus Universal Inc. Common Stock'));
  assert.ok(isCommonStock('NVO', 'Novo Nordisk A/S American Depositary Shares'), 'ADRs count');
  assert.ok(isCommonStock('UNH', 'UnitedHealth Group Incorporated Common Stock'), '"United" is not "units"');
  for (const [s, n] of [
    ['BZFDW', 'BuzzFeed Inc. Warrant'],
    ['CDROW', 'Codere Online Luxembourg S.A. Warrants'],
    ['ABCDR', 'ABC Acquisition Corp. Rights'],
    ['ABCDU', 'ABC Acquisition Corp. Units'],
    ['ABR^D', 'Arbor Realty Trust 6.375% Series D Cumulative Redeemable Preferred Stock'],
    ['TBB', 'AT&T Inc. 5.350% Global Notes due 2066'],
  ])
    assert.ok(!isCommonStock(s, n), `${s} is not a share`);
  assert.equal(yahooOfNasdaq('BRK/A'), 'BRK-A');
  assert.equal(tidyStockName('Focus Universal Inc. Common Stock'), 'Focus Universal Inc.');
  assert.equal(tidyStockName('Alphabet Inc. Class A Common Stock'), 'Alphabet Inc. Class A');
  assert.equal(tidyStockName('Novo Nordisk A/S American Depositary Shares'), 'Novo Nordisk A/S');

  // The trend line ends on the day and starts the day where the measured move starts.
  assert.deepEqual(trailFrom([5, 6, 7, 8], 8.2, 10), [5, 6, 7, 8.2, 10]);
  assert.deepEqual(trailFrom([], 4, 5), [4, 5]);
  assert.equal(trailFrom(Array.from({ length: 30 }, (_, i) => i + 1), 30, 31).length, TRAIL_DAYS);

  const row = (sym, change, marketCap, traded) => ({ kind: 'crypto', sym, name: sym, marketCap, from: 1, to: 1 + change / 100, change, traded, now: null, trail: [] });
  const ranked = rankBest([row('A', 5, 2e9), row('TINY', 400, BEST_MIN_CAP - 1), row('B', 12, 5e6), row('C', -3, 9e9), row('D', 12, 9e9), row('THIN', 300, 9e9, 50)]);
  assert.deepEqual(ranked.map((r) => r.sym), ['D', 'B', 'A'], 'gainers only, biggest first, ties by size, nothing under the floors');
  assert.equal(rankBest(Array.from({ length: 30 }, (_, i) => row(`X${i}`, i + 1, 1e9))).length, 10, 'ten kept per group');

  assert.ok(samePrice(100, 103) && !samePrice(100, 106) && !samePrice(null, 1), 'a pair counts as the same coin within 5%');
}

// Yahoo's list of every coin: read with a pattern, tickers without the id Yahoo adds, exact day changes.
{
  const quote = (symbol, name, price, prev, cap, vol, id) => ({
    language: 'en-US',
    quoteType: 'CRYPTOCURRENCY',
    coinImageUrl: `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png`,
    marketCap: cap,
    volume24Hr: vol,
    regularMarketPrice: price,
    regularMarketPreviousClose: prev,
    shortName: `${name} USD`,
    symbol,
  });
  const page = (quotes) => JSON.stringify({ finance: { result: [{ id: 'x', start: 0, count: quotes.length, total: 8000, quotes }], error: null } });
  const many = Array.from({ length: 120 }, (_, i) => quote(`K${i}-USD`, `Coin "${i}"`, 2 + i, 1 + i, 5e6 + i, 2e5, 9000 + i));
  many.push(quote('AI28846-USD', 'Sleepless AI', 0.0143, 0.0142, 9e6, 5e6, 28846), quote('C98-USD', 'Coin98', 0.03, 0.029, 3e7, 4e6, 10903));
  const coins = parseYahooCoins(page(many));
  assert.equal(coins.length, 122, 'every row read');
  assert.equal(coinLabel(coins[3]).name, 'Coin "3"', 'names unescaped, " USD" dropped');
  assert.deepEqual([coins[0].price, coins[0].prevClose, coins[0].marketCap, coins[0].volume], [2, 1, 5e6, 2e5]);
  assert.equal(coinLabel(coins.find((c) => c.yahoo === 'AI28846-USD')).sym, 'AI', "CoinMarketCap's id is not part of the ticker");
  assert.equal(coinLabel(coins.find((c) => c.yahoo === 'C98-USD')).sym, 'C98', 'a ticker that just ends in digits is kept');
  assert.equal(coinTicker('BTC-USD', null), 'BTC');
  assert.equal(parseYahooCoins(page(many.slice(0, 3))).length, 3, 'small answers are parsed in full');
  assert.equal(parseYahooCoins('{"finance":{"result":null,"error":{"code":"Unauthorized"}}}').length, 0);

  // Closes saved the day before, and each coin's previous close read the day after.
  const before = Object.fromEntries(coins.map((c) => [c.yahoo, c.prevClose / 1.1]));
  before['K5-USD'] = coins[5].prevClose / 3; // +200%
  const got = coinDayRows(coins, before);
  assert.ok(got && got.compared > 100);
  assert.equal(got.gained.length, coins.length, 'every gainer is kept, so the next ones can be checked if the first fail');
  const rows = got.gained.map(coinRow);
  const k5 = rows.find((r) => r.yahoo === 'K5-USD');
  assert.ok(Math.abs(k5.change - 200) < 1e-9 && k5.from === before['K5-USD'] && k5.to === coins[5].prevClose, 'the change is close to close');
  assert.ok(Math.abs(k5.marketCap - coins[5].marketCap * (coins[5].prevClose / coins[5].price)) < 1e-6, 'size taken at the close');
  assert.ok(!rows.some((r) => r.marketCap < BEST_MIN_CAP), 'nothing under the floor');
  assert.ok(rows[0].yahoo === 'K5-USD' && rows[0].name === 'Coin "5"', 'named, biggest first');
  rows.forEach((r, i) => i && assert.ok(rows[i - 1].change >= r.change));
  // Read too early, Yahoo still gives the closes already saved: no list rather than a day of zeros.
  assert.equal(coinDayRows(coins, Object.fromEntries(coins.map((c) => [c.yahoo, c.prevClose]))), null);
  assert.equal(coinDayRows(coins, {}), null, 'no day-before closes, no list');

  // Daily bars: the close before the day and at its end.
  const day = '2026-11-16';
  const sec = (key) => Date.parse(`${key}T00:00:00Z`) / 1000;
  const T = [sec('2026-11-14'), sec('2026-11-15'), sec(day), sec('2026-11-17')];
  assert.deepEqual(dayCloses({ t: T, c: [1, 2, 3, 4] }, day), { k: 2, from: 2, to: 3 });
  assert.equal(dayCloses({ t: T, c: [1, 2, 3, 4] }, '2026-11-14'), null, 'no bar before the day');
  assert.equal(dayCloses({ t: T, c: [1, 0, 3, 4] }, day), null, 'a missing close');
  assert.equal(dayCloses(undefined, day), null);
  assert.equal(dayCloses({ t: [T[0], T[2]], c: [1, 3] }, day, undefined, '2026-11-15'), null, 'for coins, the bar before must be the day before');
  assert.deepEqual(dayCloses({ t: T, c: [1, 2, 3, 4] }, day, undefined, '2026-11-15'), { k: 2, from: 2, to: 3 });
  // Hourly bars to daily closes: each UTC day's last bar.
  const hours = [];
  const hourCloses = [];
  for (let h = 0; h < 50; h++) {
    hours.push(sec('2026-11-15') + h * 3600);
    hourCloses.push(h === 30 ? null : 1e-6 * (1 + h / 100));
  }
  const daily = dailyFromHourly({ t: hours, c: hourCloses });
  assert.deepEqual(daily.t, [sec('2026-11-15'), sec(day), sec('2026-11-17')]);
  assert.deepEqual(daily.c, [1e-6 * 1.23, 1e-6 * 1.47, 1e-6 * 1.49], 'the last bar of each day, digits kept, gaps skipped');
  assert.ok(barsAgree({ from: 1, to: 2 }, { from: 1.01, to: 2.02 }) && !barsAgree({ from: 1, to: 2 }, { from: 1, to: 2.6 }), 'bars agree within 5%');

  // Has Yahoo's list moved on? Its previous closes are the day's closing bars, not the day before's.
  const barsOf = (list, end) => new Map(list.map((c) => [c.yahoo, { t: T, c: [c.prevClose * 0.8, end(c), c.prevClose, c.price] }]));
  const past = barsOf(coins.slice(0, 20), (c) => c.prevClose * 0.9);
  assert.ok(listIsPast(coins.slice(0, 20), past, day));
  const stale = new Map(coins.slice(0, 20).map((c) => [c.yahoo, { t: T, c: [c.prevClose * 0.8, c.prevClose, c.prevClose * 1.1, c.price] }]));
  assert.ok(!listIsPast(coins.slice(0, 20), stale, day), 'read too early: the closes are the day before');

  // A day filled in from daily bars when the day before's closes were not saved.
  const extra = [quote('LOWV-USD', 'Barely Traded', 1, 1, 5e7, BEST_MIN_TRADED - 1, 1), quote('SMOL-USD', 'Small', 1, 1, BEST_MIN_CAP / 2, 5e6, 2)];
  const all = parseYahooCoins(page([...many, ...extra]));
  const fill = startFill(all, day, '2026-11-17T01:00:00Z');
  assert.equal(fill.checked, all.length - 1, 'every coin over the size floor is counted');
  assert.equal(fill.coins.length, all.length - 2, 'only coins that traded enough need their bars read');
  assert.ok(!fill.coins.some((f) => f.y === 'LOWV-USD' || f.y === 'SMOL-USD'));
  const bars = new Map();
  for (const f of fill.coins) {
    const from = f.y === 'K5-USD' ? f.to / 3 : f.to / 1.1;
    const seen = f.y === 'K7-USD' ? f.to * 1.3 : f.to;
    if (f.y !== 'K9-USD') bars.set(f.y, { t: T, c: [from * 0.9, from, seen, f.now] });
  }
  assert.equal(fillFromBars(fill, 60, bars), 1, 'one coin has no bars');
  assert.equal(fill.next, 60, 'read so far');
  fillFromBars(fill, 1e6, bars);
  assert.equal(fill.next, fill.coins.length);
  const filled = fillRows(fill);
  assert.equal(filled[0].yahoo, 'K5-USD');
  assert.ok(Math.abs(filled[0].change - 200) < 1e-9 && filled[0].to === all[5].prevClose, "from the bar's close before the day to the list's close");
  assert.ok(!filled.some((r) => r.yahoo === 'K7-USD'), "a coin whose bar disagrees with the list's close is left out");
  assert.ok(!filled.some((r) => r.yahoo === 'K9-USD'), 'and one without bars');
  assert.equal(filled.length, fill.coins.length - 2);
  assert.equal(filled.find((r) => r.yahoo === 'AI28846-USD').sym, 'AI', 'named as in the list');
}

// Yahoo's stock screener: listed shares only, the session from each row's time, nothing taken from Yahoo's order.
{
  const t = (key) => Date.parse(`${key}T21:00:00Z`) / 1000;
  const q = (symbol, price, prev, day, extra = {}) => ({ symbol, quoteType: 'EQUITY', exchange: 'NMS', longName: `${symbol} Inc.`, regularMarketPrice: price, regularMarketPreviousClose: prev, regularMarketVolume: 1e6, marketCap: 5e7, regularMarketTime: t(day), ...extra });
  const answer = {
    finance: {
      result: [
        {
          quotes: [
            q('AAA', 3, 1, '2026-11-16'),
            q('BBB', 2, 1, '2026-11-16'),
            q('OTCX', 9, 1, '2026-11-16', { exchange: 'PNK' }),
            q('OLD', 5, 1, '2026-11-13'),
            q('FUND', 2, 1, '2026-11-16', { quoteType: 'ETF' }),
            q('NOPX', 0, 1, '2026-11-16'),
          ],
        },
      ],
    },
  };
  const rows = parseYahooStocks(answer);
  assert.deepEqual(rows.map((r) => r.sym), ['AAA', 'BBB', 'OLD'], 'US-listed shares with prices only (no OTC, funds or empty rows)');
  assert.equal(rows[0].change, 200, 'change from the previous close');
  assert.equal(rows[0].day, '2026-11-16', "each row's session, New York time");
  assert.equal(commonDay(rows), '2026-11-16', 'the session most rows belong to');
  assert.equal(parseYahooStocks({ finance: { result: null } }).length, 0);
  assert.ok(!isCommonStock('XYZ-WT', 'XYZ Corp') && !isCommonStock('PSA-PH', 'Public Storage') && !isCommonStock('ABC-UN', 'ABC Acquisition'), "Yahoo's warrant, preferred and unit suffixes");
  assert.ok(isCommonStock('BRK-B', 'Berkshire Hathaway Inc.') && isCommonStock('BF-B', 'Brown-Forman Corporation'), 'share classes are shares');
  assert.ok(!isCommonStock('MRNOW', 'Moringa Acquisition Corp WT'), 'a warrant by name');
  const query = JSON.stringify(yahooStockQuery(250, true));
  const rising = '["percentchange",0]';
  assert.ok(query.includes(rising) && query.includes('"NYQ"') && !JSON.stringify(yahooStockQuery(1, false)).includes(rising), 'gainers query filters on a rise; the count query does not');
}

console.log('stats: ok');
