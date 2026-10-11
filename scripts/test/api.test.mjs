// Runs the data endpoints against generated upstream data (scripts/mock-upstream.mjs) and checks the
// things the old site got wrong: movers built from dead markets, and changes measured over the wrong window.
import assert from 'node:assert/strict';
import { createMock } from '../mock-upstream.mjs';
import * as calendar from '../../functions/_shared/marketCalendar.ts';
import { SEED_PRICES, SEED_SHARES } from '../../functions/_shared/sectors.ts';
import { ETF_UNIVERSE, STOCK_UNIVERSE } from '../../functions/_shared/universes.ts';
import { MOVER_MIN_VOLUME, gainersAndLosers, topMovers } from '../../functions/_shared/cryptoUniverse.ts';
import { onRequestGet as cryptos } from '../../functions/api/cryptos.ts';
import { onRequestGet as equities } from '../../functions/api/equities.ts';
import { onRequestGet as markets } from '../../functions/api/markets.ts';
import { onRequestGet as trending } from '../../functions/api/trending.ts';
import { onRequestGet as sparklines } from '../../functions/api/sparklines.ts';

// Stand-ins for the Cloudflare runtime.
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
const kvWrites = [];
const kv = {
  store: new Map(),
  async get(key, type) {
    const v = this.store.get(key);
    return v == null ? null : type === 'json' ? JSON.parse(v) : v;
  },
  async put(key, value) {
    kvWrites.push(key);
    this.store.set(key, String(value));
  },
  async delete(key) {
    this.store.delete(key);
  },
};
const names = {};
for (const d of [...STOCK_UNIVERSE, ...ETF_UNIVERSE]) names[d.yahoo] = d.name;
const mock = createMock({ universePrices: { ...SEED_PRICES }, shares: SEED_SHARES, names, calendar });
const upstream = [];
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  upstream.push(url);
  const res = await mock.handle(input);
  if (res) return res;
  throw new TypeError(`no stand-in for ${new URL(url).hostname}`);
};

const pending = [];
const ctx = (path) => ({
  request: new Request(`https://marketcheck.money${path}`),
  env: { LAYOUTS: kv },
  waitUntil: (p) => pending.push(p),
});
const call = async (fn, path) => {
  const res = await fn(ctx(path));
  const body = await res.json();
  await Promise.allSettled(pending.splice(0));
  return { status: res.status, body };
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

/* ── Crypto: one list of 250, and movers that are real ──────────────────── */
{
  const { status, body } = await call(cryptos, '/api/cryptos');
  assert.equal(status, 200);
  const coins = body.items ?? body.coins;
  assert.ok(Array.isArray(coins) && coins.length >= 200, `expected the top 250 coins, got ${coins?.length}`);
  for (const tf of ['1h', '24h', '7d', '30d', '1y']) {
    assert.ok(coins.filter((c) => typeof c.ch[tf] === 'number').length > coins.length * 0.9, `most coins have a ${tf} change`);
  }
  // The generated list plants thin markets with a −97.5% "move". They are in the list...
  const thin = coins.filter((c) => (c.volume ?? 0) < MOVER_MIN_VOLUME && !c.stable && !c.wrapped);
  assert.ok(thin.length > 0, 'the test data should contain thin markets');
  // ...but never among the movers, on any window.
  const thinIds = new Set(thin.map((c) => c.id));
  for (const tf of ['1h', '24h', '7d', '30d', '1y']) {
    for (const c of topMovers(coins, tf, 250)) assert.ok(!thinIds.has(c.id), `${c.symbol} is too thinly traded to be a ${tf} mover`);
    const { gainers, losers } = gainersAndLosers(coins, tf, 25);
    for (const c of [...gainers, ...losers]) {
      assert.ok((c.volume ?? 0) >= MOVER_MIN_VOLUME, `${c.symbol} volume`);
      assert.ok(!c.stable && !c.wrapped, `${c.symbol} is a stablecoin or wrapped coin`);
    }
    assert.ok(gainers.every((c, i) => i === 0 || gainers[i - 1].ch[tf] >= c.ch[tf]), `${tf} gainers are in order`);
    assert.ok(losers.every((c, i) => i === 0 || losers[i - 1].ch[tf] <= c.ch[tf]), `${tf} losers are in order`);
    assert.ok(gainers.every((c) => c.ch[tf] > 0) && losers.every((c) => c.ch[tf] < 0), `${tf} gainers rose and losers fell`);
  }

  // The older endpoint saved layouts still call gives the same answer.
  const t = await call(trending, '/api/trending?category=crypto&tf=24h&limit=10');
  assert.equal(t.status, 200);
  assert.equal(t.body.pumps.length, 10);
  for (const m of [...t.body.pumps, ...t.body.dumps]) assert.ok(m.volume >= MOVER_MIN_VOLUME, `${m.symbol} volume`);
  assert.ok(t.body.dumps.every((m) => m.changePercent > -90), 'no dead market among the losers');
  // 4h/8h/12h do not exist upstream; a saved layout asking for one gets 24h and is told so.
  const t4 = await call(trending, '/api/trending?category=crypto&tf=4h');
  assert.equal(t4.body.effectiveTf, '24h');

  // A second call inside the fresh window must not go upstream again.
  const before = upstream.length;
  await call(cryptos, '/api/cryptos');
  assert.equal(upstream.length, before, 'the crypto list is served from cache');
}

/* ── Stocks and ETFs: every change measured over the window it is labelled with ── */
{
  const { status, body } = await call(equities, '/api/equities');
  assert.equal(status, 200);
  const items = body.items;
  assert.equal(items.length, STOCK_UNIVERSE.length + ETF_UNIVERSE.length);
  const calls = upstream.filter((u) => u.includes('/v7/finance/spark')).length;
  assert.ok(calls <= 10, `the whole universe should take a handful of upstream calls, took ${calls}`);

  // Work the same changes out independently from one year of daily closes.
  const check = async (symbol) => {
    const res = await mock.handle(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`);
    const r = (await res.json()).chart.result[0];
    const t = r.timestamp;
    const c = r.indicators.quote[0].close;
    const last = t[t.length - 1];
    const closeOnOrBefore = (limit) => {
      for (let i = t.length - 1; i >= 0; i--) if (t[i] <= limit && c[i] != null) return c[i];
      return null;
    };
    const e = items.find((x) => x.symbol === symbol);
    assert.ok(e && e.ok, `${symbol} has a price`);
    const pct = (base) => ((e.price - base) / base) * 100;
    assert.ok(near(e.ch['7d'], pct(closeOnOrBefore(last - 7 * 86400 + 3600)), 1e-4), `${symbol} 1W is seven days, not a month`);
    assert.ok(near(e.ch['30d'], pct(closeOnOrBefore(last - 30 * 86400 + 3600)), 1e-4), `${symbol} 1M is thirty days, not three months`);
    assert.ok(near(e.ch['1y'], pct(c.find((v) => v != null)), 1e-4), `${symbol} 1Y`);
    const year = new Date(last * 1000).getUTCFullYear();
    assert.ok(near(e.ch.ytd, pct(closeOnOrBefore(Date.UTC(year, 0, 1) / 1000 - 1)), 1e-4), `${symbol} YTD`);
    // 1D is against the previous session's close: one day, not five.
    assert.ok(near(e.ch['24h'], ((e.price - e.prevClose) / e.prevClose) * 100, 1e-6), `${symbol} 1D uses the previous close`);
    const prevBar = c[c.length - 2];
    assert.ok(Math.abs(e.prevClose - prevBar) / prevBar < 0.12, `${symbol} previous close is the last session's`);
    assert.ok(e.marketCap > 0, `${symbol} has a size`);
    assert.ok(e.high52 >= e.price && e.low52 <= e.price, `${symbol} 52-week range contains the price`);
  };
  for (const s of ['AAPL', 'NVDA', 'JPM', 'SPY', 'QQQ', 'BRK-B']) await check(s);

  // The dead ticker is gone and its replacement is priced.
  assert.ok(!items.some((e) => e.symbol === 'MMC'), 'MMC no longer trades');
  assert.ok(items.find((e) => e.symbol === 'MRSH')?.ok, 'MRSH is priced');
}

/* ── Quotes ─────────────────────────────────────────────────────────────── */
{
  const { status, body } = await call(markets, '/api/markets?symbols=AAPL,%5EGSPC,GC%3DF,ZZNOPE');
  assert.equal(status, 200);
  const by = Object.fromEntries(body.quotes.map((q) => [q.requested, q]));
  assert.ok(by.AAPL.ok && by.AAPL.price > 0 && by.AAPL.marketCap > 1e11, 'AAPL price and market cap');
  assert.ok(by['^GSPC'].ok && by['^GSPC'].marketCap == null, 'an index has no market cap');
  assert.ok(by['GC=F'].ok, 'gold futures');
  assert.equal(by.ZZNOPE.ok, false, 'an unknown symbol is reported, not invented');
  assert.equal(by.ZZNOPE.price, null);
  for (const q of body.quotes.filter((x) => x.ok)) {
    assert.ok(near(q.changePercent, ((q.price - q.prevClose) / q.prevClose) * 100, 1e-6), `${q.requested} change matches its previous close`);
  }

  // House rule: the server answers at most 20 symbols per request (the browser asks for 15 at a time).
  const many = Array.from({ length: 30 }, (_, i) => STOCK_UNIVERSE[i].yahoo).join(',');
  const capped = await call(markets, `/api/markets?symbols=${many}`);
  assert.equal(capped.body.quotes.length, 20);

  const none = await call(markets, '/api/markets');
  assert.equal(none.status, 400);
}

/* ── Small charts and the week change that comes with them ──────────────── */
{
  const { body } = await call(sparklines, '/api/sparklines?symbols=GC%3DF,%5EVIX');
  assert.equal(body.series.length, 2);
  for (const row of body.series) {
    assert.ok(row.ok && row.closes.length > 20 && row.closes.length <= 72, `${row.symbol} series`);
    assert.equal(typeof row.week, 'number');
    assert.ok(Math.abs(row.week) < 60, `${row.symbol} week change is plausible`);
  }
}

/* ── Storage budget ─────────────────────────────────────────────────────── */
// The free plan allows 1,000 KV writes a day, shared with sign-in and saved layouts.
// Loading every data endpoint from cold must cost at most a few.
assert.ok(kvWrites.length <= 4, `data endpoints wrote to KV ${kvWrites.length} times: ${kvWrites.join(', ')}`);

console.log(`api: ok (${upstream.length} upstream requests, ${kvWrites.length} KV writes)`);
