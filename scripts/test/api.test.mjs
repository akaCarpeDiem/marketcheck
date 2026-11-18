// Runs the data endpoints against generated upstream data (scripts/mock-upstream.mjs) and checks the
// things the old site got wrong: movers built from dead markets, and changes measured over the wrong window.
import assert from 'node:assert/strict';
import { createMock } from '../mock-upstream.mjs';
import * as calendar from '../../functions/_shared/marketCalendar.ts';
import { SEED_PRICES, SEED_SHARES } from '../../functions/_shared/sectors.ts';
import { ETF_UNIVERSE, STOCK_UNIVERSE } from '../../functions/_shared/universes.ts';
import { CG_MARKETS, MOVER_MIN_VOLUME, chainFromMain, coinsFromCoinGecko, ethFromMain, gainersAndLosers, isMoverCandidate, topByVolume, topMovers } from '../../functions/_shared/cryptoUniverse.ts';
import { normalizePanelConfig, DEFAULT_PANEL_LEFT } from '../../functions/_shared/panelConfig.ts';
import { onRequestGet as bubbles } from '../../functions/api/bubbles.ts';
import { kvPutIfOlder } from '../../functions/_shared/edgeCache.ts';
import { onRequestGet as cryptos } from '../../functions/api/cryptos.ts';
import { onRequestGet as equities } from '../../functions/api/equities.ts';
import { onRequestGet as markets } from '../../functions/api/markets.ts';
import { onRequestGet as trending } from '../../functions/api/trending.ts';
import { onRequestGet as sparklines } from '../../functions/api/sparklines.ts';
import { onRequestGet as chartApi } from '../../functions/api/chart.ts';
import { answerAt, forgetForTests, onRequestGet as yesterday } from '../../functions/api/yesterday.ts';
import { BEST_MIN_CAP, BEST_MIN_TRADED, BEST_SHOW, COIN_MICRO, TRAIL_DAYS, cryptoDay, prevDayKey, sessionBefore, stockDay } from '../../functions/_shared/bestBuys.ts';

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
/** Set to make CoinGecko refuse keyless requests, as it does to shared addresses. */
let coinGeckoRefuses = false;
/** Set to make CoinGecko refuse only the Ethereum-category request. */
let ethListRefused = false;
const coinGeckoKeysSeen = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  upstream.push(url);
  if (url.includes('api.coingecko.com')) {
    const key = new Headers(init?.headers).get('x-cg-demo-api-key');
    if (key) coinGeckoKeysSeen.push(key);
    if (coinGeckoRefuses && !key) return new Response('{"status":{"error_code":429}}', { status: 429 });
    if (ethListRefused && url.includes('category=ethereum-ecosystem')) return new Response('{"status":{"error_code":429}}', { status: 429 });
  }
  const res = await mock.handle(input, init);
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
  // 4h and 8h come from the site's own price record; with no record yet there is nothing to rank, and no error.
  const t4 = await call(trending, '/api/trending?category=crypto&tf=4h');
  assert.equal(t4.body.effectiveTf, '4h');
  assert.equal(t4.body.pumps.length, 0, 'no history yet means no 4h movers, not 24h movers under a 4h label');
  // A saved layout asking for a window that is no longer offered gets the nearest one and is told so.
  const t12 = await call(trending, '/api/trending?category=crypto&tf=12h');
  assert.equal(t12.body.effectiveTf, '8h');

  // Refused before any copy of the Ethereum list exists: the answer is the Ethereum tokens of the main list, and says so.
  ethListRefused = true;
  const ethCold = await call(cryptos, '/api/cryptos?universe=eth');
  ethListRefused = false;
  assert.equal(ethCold.status, 200);
  assert.equal(ethCold.body.partial, true);
  assert.ok(ethCold.body.items.length >= 8 && ethCold.body.items[0].id === 'ethereum', `${ethCold.body.items.length} tokens from the main list`);
  assert.ok(!ethCold.body.items.some((c) => c.id === 'bitcoin' || c.id === 'solana'));

  // The Ethereum list has the same shape and the same rules.
  const eth = await call(cryptos, '/api/cryptos?universe=eth');
  assert.ok(!eth.body.partial, 'the full list as soon as CoinGecko answers again');
  assert.equal(eth.status, 200);
  assert.ok(eth.body.items.length >= 20 && eth.body.items.some((c) => c.id === 'ethereum'));
  assert.ok(!eth.body.items.some((c) => c.id === 'bitcoin'), 'Bitcoin is not an Ethereum token');
  assert.ok(eth.body.items.every((c) => 'ch' in c && '4h' in c.ch), 'every coin carries the 4h field, empty or not');

  // The BNB Chain list: same shape, its own tokens.
  const bnb = await call(cryptos, '/api/cryptos?universe=bnb');
  assert.equal(bnb.status, 200);
  assert.ok(!bnb.body.partial);
  assert.ok(bnb.body.items.length >= 20 && bnb.body.items.some((c) => c.id === 'binancecoin'), 'BNB is in its own list');
  assert.ok(!bnb.body.items.some((c) => c.id === 'bitcoin' || c.id === 'ethereum'), 'neither Bitcoin nor Ether is a BNB Chain token');

  // Layer 2s: CoinGecko's layer-2 category, without Nervos (a layer 1).
  const l2 = await call(cryptos, '/api/cryptos?universe=l2');
  assert.equal(l2.status, 200);
  assert.ok(!l2.body.partial);
  assert.ok(l2.body.items.length >= 20 && l2.body.items.some((c) => c.id === 'arbitrum') && l2.body.items.some((c) => c.id === 'okb'), 'the layer-2 list holds the networks');
  assert.ok(!l2.body.items.some((c) => c.id === 'nervos-network'), 'Nervos is left out');
  assert.ok(!l2.body.items.some((c) => c.id === 'bitcoin' || c.id === 'ethereum'), 'neither Bitcoin nor Ether is a layer 2');

  // Top volume: the most-traded coins that trade freely, most first.
  const main = (await call(cryptos, '/api/cryptos')).body.items;
  const busiest = topByVolume(main, 10);
  assert.equal(busiest.length, 10);
  assert.ok(busiest.every((c, i) => i === 0 || busiest[i - 1].volume >= c.volume), 'in volume order');
  assert.ok(busiest.every((c) => !c.stable && !c.wrapped), 'no stablecoin or wrapped coin');

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

/* ── When CoinGecko turns the server away ───────────────────────────────── */
{
  // The browser fallback reads the same rows with the same code as the server.
  const rows = await (await mock.handle(CG_MARKETS)).json();
  const coins = coinsFromCoinGecko(rows);
  assert.ok(coins.length >= 200 && coins[0].symbol === 'BTC' && typeof coins[0].ch['7d'] === 'number');
  assert.throws(() => coinsFromCoinGecko({ status: { error_code: 429 } }), 'an error body is not a coin list');

  // The Ethereum tab's last resort: the Ethereum tokens already in the main list.
  const known = ethFromMain(coins);
  assert.ok(known.length >= 8, `the main list holds ${known.length} known Ethereum tokens`);
  assert.equal(known[0].id, 'ethereum', 'ether leads, in market-cap order');
  for (const id of ['bitcoin', 'solana', 'ripple', 'dogecoin', 'cardano', 'tron', 'binancecoin']) assert.ok(!known.some((c) => c.id === id), `${id} is not an Ethereum token`);
  assert.ok(known.filter(isMoverCandidate).length >= 5, 'enough of them trade freely to fill a map');
  assert.ok(known.every((c) => coins.includes(c)), 'the same objects, so the same prices as the rest of the site');
  assert.deepEqual(ethFromMain([]), []);
  const bnbKnown = chainFromMain('bnb', coins);
  assert.ok(bnbKnown.some((c) => c.id === 'binancecoin'), 'BNB is found in the main list');
  assert.ok(!bnbKnown.some((c) => c.id === 'ethereum' || c.id === 'bitcoin'));
  const l2Known = chainFromMain('l2', coins);
  assert.ok(l2Known.some((c) => c.id === 'arbitrum') && !l2Known.some((c) => c.id === 'ethereum'), 'the known layer 2s are found in the main list');

  // Tokenized funds and other pegged tokens are grouped with stablecoins; a quiet giant is not.
  const row = (o) => ({ id: o.symbol, symbol: o.symbol, name: o.name ?? o.symbol, current_price: o.price ?? 5, market_cap: 1e9, total_volume: 5e7, market_cap_rank: o.rank,
    price_change_percentage_24h_in_currency: o.d, price_change_percentage_7d_in_currency: o.w, price_change_percentage_30d_in_currency: o.m });
  const [fund, quietBtc, alt, newcomer] = coinsFromCoinGecko([
    row({ symbol: 'tfund', name: 'Some Treasury Fund', price: 1.12, rank: 140, d: 0.0, w: 0.1, m: 0.4 }),
    row({ symbol: 'btc', name: 'Bitcoin', price: 80000, rank: 1, d: 0.1, w: -0.2, m: 0.9 }),
    row({ symbol: 'alt', rank: 90, d: 0.2, w: -3.1, m: 12 }),
    row({ symbol: 'new', rank: 200, d: 0.1, w: 0.2, m: null }),
  ]);
  assert.equal(fund.stable, 1, 'a price that never moves is a pegged token');
  assert.ok(!quietBtc.stable, 'a quiet month must not hide Bitcoin');
  assert.ok(!alt.stable && !newcomer.stable);

  // With a copy in hand, a refusal is answered from the copy and marked stale.
  coinGeckoRefuses = true;
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60_000; // past the fresh window
  try {
    const held = await call(cryptos, '/api/cryptos');
    assert.equal(held.body.ok, true);
    assert.equal(held.body.stale, true, 'an old copy is labelled as old');
    assert.ok(held.body.items.length >= 200);
  } finally {
    Date.now = realNow;
  }

  // With a demo key set as a secret, the refused request is retried with the key, and only then.
  assert.equal(coinGeckoKeysSeen.length, 0, 'the key is never sent while keyless requests work');
  Date.now = () => realNow() + 20 * 60_000;
  try {
    const res = await cryptos({
      request: new Request('https://marketcheck.money/api/cryptos'),
      env: { LAYOUTS: kv, COINGECKO_API_KEY: 'test-demo-key' },
      waitUntil: (p) => pending.push(p),
    });
    const body = await res.json();
    await Promise.allSettled(pending.splice(0));
    assert.equal(body.stale, false, 'the keyed retry brought fresh data');
    assert.deepEqual(coinGeckoKeysSeen, ['test-demo-key']);
  } finally {
    Date.now = realNow;
  }

  // The hourly price record is off unless switched on, and costs one write an hour when it is.
  coinGeckoRefuses = false;
  assert.ok(![...kv.store.keys()].some((k) => k.startsWith('snap:')), 'no price record without the switch');
  Date.now = () => realNow() + 40 * 60_000;
  try {
    const res = await cryptos({
      request: new Request('https://marketcheck.money/api/cryptos'),
      env: { LAYOUTS: kv, PRICE_HISTORY: '1' },
      waitUntil: (p) => pending.push(p),
    });
    const body = await res.json();
    await Promise.allSettled(pending.splice(0));
    assert.equal([...kv.store.keys()].filter((k) => k.startsWith('snap:')).length, 1, 'switched on: one record for the hour');
    assert.ok(body.items.every((c) => c.ch['4h'] === null), 'and no 4h figure until the record goes back four hours');
  } finally {
    Date.now = realNow;
  }
  coinGeckoRefuses = true;

  // From cold (a new location with no copy anywhere) the answer is an honest "nothing", not a crash.
  // The universe module keeps its own memory, so load a second copy of it the way a fresh isolate would.
  edge.clear();
  kv.store.clear();
  const fresh = await import('../../functions/_shared/edgeCache.ts');
  assert.equal(typeof fresh.cached, 'function');
  let threw = false;
  try {
    await fresh.cached('crypto-cold-test', {
      freshMs: 1000,
      load: async () => {
        const res = await fetch(CG_MARKETS);
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        return res.json();
      },
    });
  } catch (e) {
    threw = /429/.test(String(e?.message));
  }
  assert.ok(threw, 'a refusal with no copy surfaces as an error the endpoint turns into ok:false');
  coinGeckoRefuses = false;
}

/* ── Movers panels: the chain and ranking they were saved with ──────────── */
{
  const saved = normalizePanelConfig({ ...DEFAULT_PANEL_LEFT, chain: 'sol', sort: 'volume_24h', tf: '6h' }, DEFAULT_PANEL_LEFT);
  assert.equal(saved.chain, 'sol');
  assert.equal(saved.sort, 'volume_24h');
  assert.equal(saved.tf, '6h');
  assert.equal(normalizePanelConfig({ ...DEFAULT_PANEL_LEFT, chain: 'doge' }, DEFAULT_PANEL_LEFT).chain, 'all', 'an unknown chain means every chain');
  assert.equal(normalizePanelConfig({ title: 'Old layout', mode: 'movers_up' }, DEFAULT_PANEL_LEFT).chain, 'all', 'layouts saved before chains show every chain');

  // Solana gainers, losers and top volume are ranked by the server, each in its own order.
  const sol = async (rank) => (await call(bubbles, `/api/bubbles?category=solana&tf=24h&limit=20&rank=${rank}`)).body.items;
  const [up, down, vol] = [await sol('up'), await sol('down'), await sol('volume')];
  assert.ok(up.length && up.every((t, i) => t.changePercent > 0 && (i === 0 || up[i - 1].changePercent >= t.changePercent)), 'gainers rose, biggest first');
  assert.ok(down.length && down.every((t, i) => t.changePercent < 0 && (i === 0 || down[i - 1].changePercent <= t.changePercent)), 'losers fell, biggest first');
  assert.ok(vol.length && vol.every((t, i) => i === 0 || vol[i - 1].volume >= t.volume), 'top volume, most first');
}

/* ── One KV snapshot for the whole site, not one per location ───────────── */
{
  const store = new Map();
  let puts = 0;
  const shared = {
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v) {
      puts += 1;
      store.set(k, v);
    },
  };
  const value = () => JSON.stringify({ data: [1], at: Date.now() });
  assert.equal(await kvPutIfOlder(shared, 'snap', value(), 6 * 3_600_000, 60), true, 'first location writes');
  for (let i = 0; i < 40; i++) assert.equal(await kvPutIfOlder(shared, 'snap', value(), 6 * 3_600_000, 60), false);
  assert.equal(puts, 1, '40 more locations add no writes');
  store.set('snap', JSON.stringify({ data: [1], at: Date.now() - 7 * 3_600_000 }));
  assert.equal(await kvPutIfOlder(shared, 'snap', value(), 6 * 3_600_000, 60), true, 'an old snapshot is replaced');
  const full = { get: async () => null, put: async () => { throw new Error('KV PUT failed: 429 daily limit'); } };
  assert.equal(await kvPutIfOlder(full, 'snap', value(), 1, 60), false, 'a used-up write allowance is not an error');
}

/* ── Candles: open, high and low line up with the closes ─────────────────── */
{
  const { status, body } = await call(chartApi, '/api/chart?symbol=AAPL&range=6mo&interval=1d');
  assert.equal(status, 200);
  const n = body.closes.length;
  assert.ok(n > 50, 'six months of daily bars');
  assert.equal(body.opens.length, n);
  assert.equal(body.highs.length, n);
  assert.equal(body.lows.length, n);
  for (let i = 0; i < n; i++) {
    const top = Math.max(body.opens[i], body.closes[i]);
    const bottom = Math.min(body.opens[i], body.closes[i]);
    assert.ok(body.highs[i] >= top - 1e-9 && body.lows[i] <= bottom + 1e-9, `bar ${i}: the range holds the open and close`);
  }
  const long = await call(chartApi, '/api/chart?symbol=SPY&range=10y&interval=1wk');
  assert.equal(long.status, 200, 'ten years is an allowed range (lead-in for 200-week averages)');
}

/* ── Yesterday's best buys ──────────────────────────────────────────────── */
// Stocks come from Yahoo's screener, or Nasdaq's full list when that fails. Nasdaq's can lag by a session
// or more: while it still shows the session before, that one is saved under its own date and shown; once it
// catches up, the newest is. Coins come from Yahoo's list compared with the day before's saved closes, or,
// when those were not saved, with Yahoo's daily bars, read over a few requests. Every row shown has been
// checked against Yahoo's daily closes, and every list has at least five rows.
{
  // Coin closes are read from 00:15 UTC; keep clear of that window.
  const DAY = 86_400_000;
  const t0 = Date.now() % DAY < 20 * 60_000 ? Date.now() + 20 * 60_000 : Date.now();
  const latest = stockDay(t0);
  const before = sessionBefore(latest);
  const writesBefore = kvWrites.length;
  const nasdaqCalls = () => upstream.filter((u) => u.includes('/api/screener/stocks')).length;
  const yahooStockCalls = () => upstream.filter((u) => u.includes('/v1/finance/screener?')).length;
  const paprikaCalls = () => upstream.filter((u) => u.includes('api.coinpaprika.com')).length;
  const paprikaAtStart = paprikaCalls();

  const check = (body, label, groups = ['crypto', 'stocks']) => {
    for (const g of groups) {
      const group = body[g].items;
      assert.ok(group.length >= BEST_SHOW && group.length <= 10, `${label}: a full ${g} list (${group.length} rows; ${body[g].why ?? ''})`);
      group.forEach((r, i) => {
        assert.ok(r.change > 0, `${r.sym} gained`);
        assert.ok(r.marketCap >= BEST_MIN_CAP, `${r.sym} is over the size floor`);
        assert.ok(r.traded == null || r.traded >= BEST_MIN_TRADED, `${r.sym} traded enough`);
        assert.ok(Math.abs(r.change - (r.to / r.from - 1) * 100) < 1e-6, `${r.sym} change is close to close`);
        assert.equal(r.trail[r.trail.length - 1], r.to, `${r.sym} trend ends on the day`);
        assert.ok(r.trail.length >= 2 && r.trail.length <= TRAIL_DAYS);
        if (i) assert.ok(group[i - 1].change >= r.change, 'biggest first');
      });
    }
    const syms = groups.flatMap((g) => body[g].items.map((r) => r.sym));
    for (const bad of ['QWRNW', 'QPRF^A', 'QTNY', 'QTHN', 'TINY', 'THIN'])
      assert.ok(!syms.includes(bad), `${label}: ${bad} (warrant, preferred, under the floor or barely traded) is left out`);
  };
  /** Upstream requests per run, to stay inside the free plan's 50 sub-requests. */
  const perRun = [];
  const run = async (at) => {
    mock.setClock(at);
    const n = upstream.length;
    const a = await answerAt(ctx('/api/yesterday'), at);
    await Promise.allSettled(pending.splice(0));
    perRun.push(upstream.length - n);
    return a;
  };
  /** Requests a minute apart until crypto's list for the day is in; the answer, and how many it took. */
  const untilCoins = async (from) => {
    let a;
    let n = 0;
    do a = await run(from + n++ * 61_000);
    while (a.crypto.pending && n < 8);
    return { a, n };
  };
  /**
   * Each coin's close before the day as the list starts it: the saved close, or (`viaBars`, when none was
   * saved) Yahoo's daily bar, rounded to six decimals, except for coins under COIN_MICRO, read from hourly bars.
   */
  const startOf = (k, s, e, viaBars) => (viaBars && e[k] >= COIN_MICRO ? Math.round(s[k] * 1e6) / 1e6 : s[k]);
  /** Every coin over the floors (but `without`), by its change from one day's close to the next, biggest first. */
  const coinRanking = (startDay, endDay, without = [], viaBars = false) => {
    const s = mock.yahooCloses(startDay);
    const e = mock.yahooCloses(endDay);
    return Object.keys(e)
      .filter((k) => s[k] > 0 && !/^(TINY|THIN)-/.test(k) && !without.includes(k))
      .map((k) => ({ k, change: (e[k] / startOf(k, s, e, viaBars) - 1) * 100 }))
      .sort((x, y) => y.change - x.change);
  };
  /** The coin list is exact: each from close to close, and it is the day's ranking (bar the coins left out). */
  const exactCoins = (a, label, without = [], viaBars = false) => {
    const day = a.crypto.day;
    const startDay = prevDayKey(day);
    const s = mock.yahooCloses(startDay);
    const e = mock.yahooCloses(day);
    a.crypto.items.forEach((r) => {
      assert.ok(r.yahoo, `${r.sym} has its Yahoo symbol`);
      const from = startOf(r.yahoo, s, e, viaBars);
      assert.ok(Math.abs(r.from / from - 1) < 1e-9 && Math.abs(r.to / e[r.yahoo] - 1) < 1e-9, `${label}: ${r.sym} from close to close (${r.from} / ${from}, ${r.to} / ${e[r.yahoo]})`);
      assert.equal(r.sym, r.yahoo.replace(/(\d{4})?-USD$/, ''), 'a ticker shows without the id Yahoo adds when tickers clash');
      assert.ok(!without.includes(r.yahoo), `${label}: ${r.yahoo} could not be checked, so it is left out`);
    });
    const want = coinRanking(startDay, day, without, viaBars).slice(0, a.crypto.items.length);
    assert.deepEqual(a.crypto.items.map((r) => r.yahoo), want.map((x) => x.k), `${label}: the day's biggest gainers, in order`);
    if (without.length < 3) assert.ok(a.crypto.items[0].change > 40, `${label}: a planted runner leads`);
    assert.ok(a.crypto.checked >= 300, `${label}: every coin over the floor is compared (${a.crypto.checked})`);
    assert.match(a.crypto.source, /Yahoo/);
  };

  // 1. The first request works out one list (crypto); never both in one request (CPU and sub-request limits).
  // No coin closes were saved for the day before (the first day), so today's are saved for tomorrow, and each
  // coin's start is read from Yahoo's daily bars over the next requests. CoinPaprika is never asked: it
  // refuses Cloudflare Functions.
  // Steps 1 to 5: Yahoo's stock screener is down, so Nasdaq's list is used.
  mock.setYahooStocksDown(true);
  mock.setNasdaqDay(before);
  const d0 = cryptoDay(t0);
  let a = await run(t0);
  assert.equal(a.crypto.day, d0, 'crypto: the UTC day before');
  assert.ok(a.crypto.pending && a.retrySoon, 'crypto is under way, and the page asks again in a minute');
  assert.match(a.crypto.why ?? '', /not saved.*daily bars: 0 of \d+ read/, `why: ${a.crypto.why}`);
  assert.ok(kvWrites.includes(`best:closes:${d0}`), "the day's coin closes are saved for tomorrow");
  assert.ok(kvWrites.includes(`best:fill:${d0}`), 'and the coins to read are saved, so any location carries on');
  assert.ok(a.stocks.pending, 'stocks are left to the next request');
  assert.equal(nasdaqCalls(), 0);

  // 2. Next request: stocks' turn, as they have not been tried yet. Nasdaq still shows the session before:
  // it is recognised and saved as that session.
  a = await run(t0 + 61_000);
  assert.equal(nasdaqCalls(), 1, 'one read of the full stock list');
  assert.equal(a.stocks.day, before, 'labelled with the session it really shows');
  assert.match(a.stocks.source, /Nasdaq/);
  assert.ok(a.stocks.pending, 'and marked as not the newest');
  assert.ok(a.stocks.checked > 500, `every listed stock over the floor is compared (${a.stocks.checked})`);
  assert.ok(a.stocks.items[0].change > 40, 'the planted small-cap runners rank, not just the big names');
  check(a, 'lagging', ['stocks']);
  assert.ok(a.crypto.pending, 'crypto waits for the next request');

  // 2b. The next requests read the coins' daily bars, then the list is worked out: exact, the day's real
  // ranking, at least five.
  let got = await untilCoins(t0 + 150_000);
  a = got.a;
  assert.ok(!a.crypto.pending, `a list for ${d0}: ${a.crypto.why ?? ''}`);
  assert.ok(got.n <= 3, `done within three more requests (${got.n})`);
  exactCoins(a, 'first day', [], true);
  assert.ok(a.crypto.items.some((r) => r.to < COIN_MICRO), 'a coin priced in millionths of a dollar ranks (read from hourly bars)');
  assert.equal(nasdaqCalls(), 1, 'stocks are not looked at again meanwhile');

  // 3. Ten minutes on, Nasdaq has caught up, but it is not looked at again until 20 minutes have passed.
  mock.setNasdaqDay(latest);
  a = await run(t0 + 11 * 60_000);
  assert.equal(nasdaqCalls(), 1, 'not looked at again yet');
  assert.equal(a.stocks.day, before);
  assert.ok(!a.retrySoon, 'no point asking again every minute');

  // 4. Twenty minutes on it is, and the newest session is saved and shown.
  a = await run(t0 + 22 * 60_000);
  assert.equal(nasdaqCalls(), 2);
  assert.equal(a.stocks.day, latest, 'the newest finished session');
  assert.ok(!a.stocks.pending && !a.retrySoon);
  check(a, 'caught up');
  const stocks = a.stocks.items.map((r) => r.sym);
  const writes = kvWrites.slice(writesBefore);
  const fills = writes.filter((k) => k.startsWith('best:fill:'));
  assert.deepEqual(
    writes.filter((k) => !k.startsWith('best:fill:')).sort(),
    [`best:closes:${d0}`, `best:v2:crypto:${d0}`, `best:v2:stocks:${before}`, `best:v2:stocks:${latest}`].sort(),
    'one saved list per group per day, and one set of coin closes',
  );
  assert.ok(fills.length <= 3, `the coins to read are saved a few times at most (${fills.length})`);
  assert.equal(paprikaCalls(), paprikaAtStart, 'CoinPaprika is not asked');

  // 5. From then on the saved list is used and Nasdaq is left alone, even if it moves on to a session still trading.
  mock.setNasdaqDay(null);
  a = await run(t0 + 45 * 60_000);
  assert.equal(nasdaqCalls(), 2, 'the full list is not read again');
  assert.deepEqual(a.stocks.items.map((r) => r.sym), stocks, 'the saved list, unchanged');

  // Through the endpoint itself, and kept rather than rebuilt on every view.
  const { status, body } = await call(yesterday, '/api/yesterday');
  assert.equal(status, 200);
  assert.ok(body.ok, 'answers');
  assert.equal(body.minCap, BEST_MIN_CAP);
  assert.equal(body.minTraded, BEST_MIN_TRADED);
  const again = upstream.length;
  const second = await call(yesterday, '/api/yesterday');
  if (!second.body.retrySoon) assert.equal(upstream.length, again, 'the answer is kept, not rebuilt on every view');

  // 5b. With Yahoo's screener working, the newest session comes from it: already current the evening of the
  // session, the session read from each row rather than guessed, and each gainer measured again from daily
  // closes, so a row with a wrong previous close (+900% on a small move) does not get in.
  const dropStocks = () => {
    forgetForTests();
    for (const k of [...kv.store.keys()]) if (k.startsWith('best:v2:stocks:')) kv.store.delete(k);
  };
  dropStocks();
  mock.setYahooStocksDown(false);
  const nasdaqSoFar = nasdaqCalls();
  a = await run(t0 + 70 * 60_000);
  assert.match(a.stocks.source, /Yahoo/, `from Yahoo: ${a.stocks.why ?? ''}`);
  assert.equal(a.stocks.day, latest, 'the newest finished session');
  assert.ok(!a.stocks.pending);
  assert.equal(nasdaqCalls(), nasdaqSoFar, 'Nasdaq is not needed');
  assert.ok(a.stocks.checked > 500, `every listed stock over the floor is counted (${a.stocks.checked})`);
  assert.ok(a.stocks.items[0].change > 40, 'the planted small-cap runners rank');
  assert.ok(mock.badYahooStock && !a.stocks.items.some((r) => r.yahoo === mock.badYahooStock && r.change > 100), `${mock.badYahooStock}'s bad previous close is not believed`);
  assert.ok(!a.stocks.items.some((r) => r.sym === 'QPRF-PA'), 'the preferred share is left out under its Yahoo symbol too');
  check(a, 'from Yahoo');

  // 5c. When Yahoo has no daily bars for the biggest gainers (more than one round of forty), they cannot be
  // checked and are left out, and the next ones are checked until the list is full.
  dropStocks();
  const noBars = mock.setStockBarsMissing(45);
  a = await run(t0 + 95 * 60_000);
  assert.ok(!a.stocks.pending, `a list: ${a.stocks.why ?? ''}`);
  assert.ok(!a.stocks.items.some((r) => noBars.includes(r.yahoo)), 'nothing that could not be checked');
  check(a, 'gainers without bars');
  mock.setStockBarsMissing(0);

  // 6. The next day, yesterday's saved closes are the starting point: every coin is measured from Yahoo's
  // list in one request, and the changes are exact.
  const t1 = t0 + DAY;
  const d1 = cryptoDay(t1);
  a = await run(t1);
  assert.equal(a.crypto.day, d1);
  assert.ok(!a.crypto.pending, `a list for ${d1} in one request: ${a.crypto.why ?? ''}`);
  exactCoins(a, 'from saved closes');
  assert.ok(a.crypto.items.some((r) => r.to < COIN_MICRO), 'a coin priced in millionths of a dollar ranks');
  assert.ok(a.crypto.items.length >= BEST_SHOW);
  assert.ok(kvWrites.includes(`best:closes:${d1}`), "and that day's closes are saved for the next");

  // 6b. Yahoo has no daily bars for the 25 biggest gainers (more than one round of twenty): they are left
  // out, and the list is the biggest of the rest, still at least five.
  const t2 = t0 + 2 * DAY;
  mock.setClock(t2);
  const noCoinBars = mock.setCoinBarsMissing(25);
  a = await run(t2);
  assert.ok(!a.crypto.pending, `a list: ${a.crypto.why ?? ''}`);
  exactCoins(a, 'gainers without bars', noCoinBars);
  check(a, 'coins without bars', ['crypto']);
  mock.setCoinBarsMissing(0);

  // 6c. The biggest gainer's daily bar disagrees with the list's close (one of them is wrong): it is left out.
  const t3 = t0 + 3 * DAY;
  mock.setClock(t3);
  const wrong = mock.setBadCoinBar(true);
  a = await run(t3);
  assert.ok(!a.crypto.items.some((r) => r.yahoo === wrong), `${wrong}, whose figures disagree, is left out`);
  exactCoins(a, 'a bar that disagrees', [wrong]);
  mock.setBadCoinBar(false);

  // 7. A day nobody visited the day before (no closes saved), while Yahoo's coin list is down: pending, and
  // the answer says why. It does not take every request's turn: next time both are due, stocks go first.
  // Once Yahoo is back, the coins' starts are read from the daily bars and the list comes in.
  const t5 = t0 + 5 * DAY;
  const d5 = cryptoDay(t5);
  mock.setYahooCoinsDown(true);
  a = await run(t5);
  assert.ok(a.crypto.pending && a.crypto.day !== d5, 'the last saved day stands in, marked pending');
  assert.match(a.crypto.why ?? '', /coin list answered HTTP 500/, `the reason is given: ${a.crypto.why}`);
  const readsBefore = nasdaqCalls() + yahooStockCalls();
  a = await run(t5 + 21 * 60_000);
  assert.ok(nasdaqCalls() + yahooStockCalls() > readsBefore, 'the stock list is read this time');
  assert.ok(a.crypto.pending, 'crypto waits for its next turn');
  mock.setYahooCoinsDown(false);
  got = await untilCoins(t5 + 22 * 60_000 + 30_000);
  a = got.a;
  assert.ok(!a.crypto.pending && a.crypto.day === d5, `a list for ${d5}: ${a.crypto.why ?? ''}`);
  assert.ok(got.n <= 4, `within a few requests (${got.n})`);
  exactCoins(a, 'a day after a missed one', [], true);
  assert.ok(kvWrites.includes(`best:closes:${d5}`) && kvWrites.includes(`best:fill:${d5}`));

  // 8. A list saved with fewer than five rows (by an older version) is worked out again.
  const t6 = t0 + 6 * DAY;
  const d6 = cryptoDay(t6);
  const shortKey = `best:v2:crypto:${d6}`;
  kv.store.set(shortKey, JSON.stringify({ day: d6, items: a.crypto.items.slice(0, 3), checked: 1375, at: new Date(t6).toISOString(), source: 'CoinPaprika (2,000 largest coins)' }));
  forgetForTests();
  a = await run(t6);
  assert.ok(a.crypto.items.length >= BEST_SHOW && !a.crypto.pending, `worked out again: ${a.crypto.items.length} rows; ${a.crypto.why ?? ''}`);
  assert.ok(JSON.parse(kv.store.get(shortKey)).items.length >= BEST_SHOW, 'and the short one replaced');
  exactCoins(a, 'replacing a short list');

  assert.equal(paprikaCalls(), paprikaAtStart, 'CoinPaprika is never asked');
  assert.ok(Math.max(...perRun) <= 45, `each request stays inside the free plan's 50 sub-requests (most: ${Math.max(...perRun)})`);
  mock.setClock(null);
}

/* ── Storage budget ─────────────────────────────────────────────────────── */
// The free plan allows 1,000 KV writes a day, shared with sign-in and saved layouts.
// Loading every data endpoint from cold must cost at most a few.
assert.ok(kvWrites.some((k) => k.includes('crypto-eth')), 'the Ethereum list keeps a last good copy in KV');
assert.ok(kvWrites.some((k) => k.includes('crypto-bnb')), 'so does the BNB Chain list');
assert.ok(kvWrites.some((k) => k.includes('crypto-l2')), 'and the layer-2 list');
// One write per list: the main coins, each chain list (at most twice a day), share counts and the snapshot.
// (Yesterday's best buys add one per group per day, checked above; the test runs several days, so they are counted there.)
const dataWrites = kvWrites.filter((k) => !k.startsWith('best:'));
assert.ok(dataWrites.length <= 6, `data endpoints wrote to KV ${dataWrites.length} times: ${dataWrites.join(', ')}`);

console.log(`api: ok (${upstream.length} upstream requests, ${kvWrites.length} KV writes)`);
