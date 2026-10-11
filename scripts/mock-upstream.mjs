/**
 * Stand-in market data for local development: `node scripts/dev.mjs --mock`.
 *
 * Replaces the upstream hosts the Functions call (Yahoo Finance, CoinGecko,
 * Jupiter, Nasdaq, alternative.me) with generated data in the same shapes, so
 * the site can run with no network. Numbers are made up but stable: each
 * symbol always gets the same history, and prices drift a little over time so
 * refreshes visibly change things.
 *
 * Anything fetched while this is installed that is not listed here fails, the
 * same as a dead upstream would.
 */

const DAY = 86_400;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform generator. */
function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

const EXTRA_PRICES = {
  '^GSPC': 7811.54, '^IXIC': 26412.3, '^DJI': 51664.95, '^NDX': 30883.15, '^RUT': 2806.98, '^VIX': 14.84,
  '^TNX': 5.244, 'DX-Y.NYB': 102.23, 'EURUSD=X': 1.1206, 'BTC-USD': 82961, 'ETH-USD': 2501.6,
  'SOL-USD': 109.3, 'XRP-USD': 1.72, 'DOGE-USD': 0.118, 'ADA-USD': 0.41, 'BNB-USD': 742, 'AVAX-USD': 14.2,
  'DOT-USD': 2.6, 'ATOM-USD': 3.1, 'GC=F': 4216.3, 'SI=F': 51.84, 'CL=F': 61.27, 'HG=F': 6.692, 'NG=F': 3.22,
  'PL=F': 1612.4, MRSH: 175.76,
};

const NAMES = {
  '^GSPC': 'S&P 500', '^IXIC': 'NASDAQ Composite', '^DJI': 'Dow Jones Industrial Average', '^NDX': 'NASDAQ 100',
  '^RUT': 'Russell 2000', '^VIX': 'CBOE Volatility Index', 'BTC-USD': 'Bitcoin USD', 'ETH-USD': 'Ethereum USD',
  'GC=F': 'Gold Dec 26', 'SI=F': 'Silver Dec 26', 'CL=F': 'Crude Oil Nov 26', 'HG=F': 'Copper Dec 26',
};

export function createMock({ universePrices = {}, shares = {}, names = {}, calendar, live = false } = {}) {
  const prices = { ...universePrices, ...EXTRA_PRICES };
  const isCrypto = (s) => /-USD$/.test(s);
  const isFuture = (s) => /=F$/.test(s);
  const is24h = (s) => isCrypto(s) || isFuture(s) || /=X$/.test(s);

  function basePrice(sym) {
    if (prices[sym] != null) return prices[sym];
    if (/^ZZ/i.test(sym)) return null; // lets tests ask for a symbol that does not exist
    const r = rng(hash(sym));
    return Number((8 + r() * 400).toFixed(2));
  }

  /** Price now: the base, plus a slow wobble while that market trades. */
  function livePrice(sym, now = Date.now()) {
    const base = basePrice(sym);
    if (base == null) return null;
    const moving = live || is24h(sym) || calendar?.marketStatus(now).open;
    if (!moving) return base;
    const phase = (hash(sym) % 628) / 100;
    const t = now / 1000;
    const wobble = 0.0035 * Math.sin(t / 53 + phase) + 0.0015 * Math.sin(t / 11 + phase * 2);
    return base * (1 + wobble);
  }

  /** Dates (unix seconds) of the last `n` daily bars for a symbol, oldest first. */
  function dailyStamps(sym, n, now = Date.now()) {
    const out = [];
    if (isCrypto(sym)) {
      const today = Math.floor(now / 1000 / DAY) * DAY;
      for (let i = n - 1; i >= 0; i--) out.push(today - i * DAY);
      return out;
    }
    // Trading days, stamped at the 9:30 ET open.
    const p = calendar.etParts(now);
    let day = calendar.prevTradingDay(p.y, p.m, p.d, true);
    // Before today's open the latest bar is the previous session.
    if (day.key === p.key && p.minutes < day.open) day = calendar.prevTradingDay(p.y, p.m, p.d, false);
    const days = [];
    while (days.length < n) {
      days.push(calendar.etToMs(day.y, day.m, day.d, day.open) / 1000);
      const d = new Date(Date.UTC(day.y, day.m - 1, day.d - 1));
      day = calendar.prevTradingDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), true);
    }
    return days.reverse();
  }

  /** One year of daily closes ending at the live price. Same symbol, same history. */
  function dailySeries(sym, n, now = Date.now()) {
    const last = livePrice(sym, now);
    if (last == null) return null;
    const r = rng(hash(`${sym}:daily`));
    const sigma = isCrypto(sym) ? 0.032 : sym.startsWith('^') ? 0.009 : isFuture(sym) ? 0.013 : 0.017;
    const drift = (r() - 0.35) * 0.0016;
    // Walk a fixed 260-step path, then take the last n, so shorter ranges are the tail of longer ones.
    const total = 262;
    const path = [1];
    for (let i = 1; i < total; i++) path.push(path[i - 1] * Math.exp(drift + sigma * gauss(r)));
    const base = basePrice(sym);
    const scale = base / path[total - 1];
    const closes = path.slice(total - n).map((v) => v * scale);
    closes[closes.length - 1] = last;
    return { t: dailyStamps(sym, n, now), c: closes };
  }

  function intradaySeries(sym, points, stepSec, now = Date.now()) {
    const last = livePrice(sym, now);
    if (last == null) return null;
    const daily = dailySeries(sym, 3, now);
    const prev = daily.c[daily.c.length - 2];
    const r = rng(hash(`${sym}:intra:${points}`));
    const c = [];
    let v = prev;
    for (let i = 0; i < points; i++) {
      const pull = (last - v) / (points - i);
      v = v + pull + v * 0.0012 * gauss(r);
      c.push(v);
    }
    c[points - 1] = last;
    const end = is24h(sym) ? Math.floor(now / 1000) : daily.t[daily.t.length - 1] + 6.5 * 3600;
    const t = c.map((_, i) => Math.floor(end - (points - 1 - i) * stepSec));
    return { t, c };
  }

  const RANGE_DAYS = { '5d': 5, '1mo': 22, '3mo': 64, '6mo': 127, '1y': 252, ytd: 196, '2y': 252, '5y': 252, max: 252 };
  const INTRA_STEP = { '1m': 60, '2m': 120, '5m': 300, '15m': 900, '30m': 1800, '60m': 3600, '1h': 3600 };

  function block(sym, range, interval, now = Date.now()) {
    let series;
    if (INTRA_STEP[interval]) {
      const step = INTRA_STEP[interval];
      const span = range === '1d' ? (is24h(sym) ? 24 : 6.5) * 3600 : range === '5d' ? 5 * 6.5 * 3600 : 22 * 6.5 * 3600;
      series = intradaySeries(sym, Math.max(8, Math.min(400, Math.round(span / step))), step, now);
    } else {
      series = dailySeries(sym, RANGE_DAYS[range] ?? 252, now);
    }
    if (!series) return null;
    const daily = dailySeries(sym, 252, now);
    const n = daily.c.length;
    const price = daily.c[n - 1];
    const prevClose = daily.c[n - 2];
    const r = rng(hash(`${sym}:vol`));
    return {
      meta: {
        currency: 'USD',
        symbol: sym,
        exchangeName: isCrypto(sym) ? 'CCC' : 'NMS',
        fullExchangeName: isCrypto(sym) ? 'CCC' : sym.startsWith('^') ? 'SNP' : 'NasdaqGS',
        instrumentType: isCrypto(sym) ? 'CRYPTOCURRENCY' : sym.startsWith('^') ? 'INDEX' : isFuture(sym) ? 'FUTURE' : 'EQUITY',
        regularMarketTime: is24h(sym) ? Math.floor(now / 1000) : daily.t[n - 1] + 6.5 * 3600,
        regularMarketPrice: price,
        previousClose: prevClose,
        chartPreviousClose: series.c[0] * 0.99,
        regularMarketDayHigh: Math.max(price, prevClose) * 1.006,
        regularMarketDayLow: Math.min(price, prevClose) * 0.994,
        regularMarketVolume: Math.round(2e6 + r() * 6e7),
        fiftyTwoWeekHigh: Math.max(...daily.c),
        fiftyTwoWeekLow: Math.min(...daily.c),
        shortName: NAMES[sym] ?? names[sym] ?? `${sym} Inc.`,
        longName: NAMES[sym] ?? names[sym] ?? `${sym} Incorporated`,
      },
      timestamp: series.t,
      indicators: { quote: [{ close: series.c, volume: series.c.map(() => Math.round(1e5 + r() * 4e6)) }] },
    };
  }

  /* ── CoinGecko ── */
  const REAL_COINS = [
    ['bitcoin', 'BTC', 'Bitcoin', 82961, 1667e9], ['ethereum', 'ETH', 'Ethereum', 2501.6, 305.5e9],
    ['tether', 'USDT', 'Tether', 0.9991, 184e9], ['ripple', 'XRP', 'XRP', 1.72, 101e9],
    ['binancecoin', 'BNB', 'BNB', 742, 103e9], ['solana', 'SOL', 'Solana', 109.3, 60e9],
    ['usd-coin', 'USDC', 'USDC', 1.0, 76e9], ['dogecoin', 'DOGE', 'Dogecoin', 0.118, 17.8e9],
    ['tron', 'TRX', 'TRON', 0.31, 29e9], ['cardano', 'ADA', 'Cardano', 0.41, 14.8e9],
    ['staked-ether', 'STETH', 'Lido Staked Ether', 2499.8, 23e9], ['wrapped-bitcoin', 'WBTC', 'Wrapped Bitcoin', 82890, 10.4e9],
    ['hyperliquid', 'HYPE', 'Hyperliquid', 31.4, 10.6e9], ['chainlink', 'LINK', 'Chainlink', 12.9, 8.8e9],
    ['sui', 'SUI', 'Sui', 1.92, 6.9e9], ['avalanche-2', 'AVAX', 'Avalanche', 14.2, 6.1e9],
    ['stellar', 'XLM', 'Stellar', 0.21, 6.7e9], ['bitcoin-cash', 'BCH', 'Bitcoin Cash', 412, 8.2e9],
    ['hedera-hashgraph', 'HBAR', 'Hedera', 0.14, 5.9e9], ['leo-token', 'LEO', 'LEO Token', 9.1, 8.4e9],
    ['litecoin', 'LTC', 'Litecoin', 78.4, 6e9], ['the-open-network', 'TON', 'Toncoin', 2.1, 5.3e9],
    ['shiba-inu', 'SHIB', 'Shiba Inu', 0.0000082, 4.8e9], ['weth', 'WETH', 'WETH', 2501.1, 7.6e9],
    ['usds', 'USDS', 'USDS', 0.9998, 8.9e9], ['wrapped-eeth', 'WEETH', 'Wrapped eETH', 2690, 6.8e9],
    ['polkadot', 'DOT', 'Polkadot', 2.6, 4.2e9], ['monero', 'XMR', 'Monero', 301, 5.6e9],
    ['ethena-usde', 'USDE', 'Ethena USDe', 1.0004, 11.2e9], ['pepe', 'PEPE', 'Pepe', 0.0000061, 2.6e9],
    ['uniswap', 'UNI', 'Uniswap', 5.4, 3.4e9], ['aave', 'AAVE', 'Aave', 188, 2.9e9],
    ['bittensor', 'TAO', 'Bittensor', 262, 2.6e9], ['near', 'NEAR', 'NEAR Protocol', 1.9, 2.4e9],
    ['aptos', 'APT', 'Aptos', 3.1, 2.1e9], ['internet-computer', 'ICP', 'Internet Computer', 3.6, 1.9e9],
    ['ondo-finance', 'ONDO', 'Ondo', 0.58, 1.8e9], ['ethereum-classic', 'ETC', 'Ethereum Classic', 13.2, 2e9],
    ['okb', 'OKB', 'OKB', 98, 2.1e9], ['mantle', 'MNT', 'Mantle', 0.92, 3e9], ['kaspa', 'KAS', 'Kaspa', 0.048, 1.3e9],
    ['crypto-com-chain', 'CRO', 'Cronos', 0.11, 3.7e9], ['render-token', 'RENDER', 'Render', 2.4, 1.2e9],
    ['arbitrum', 'ARB', 'Arbitrum', 0.24, 1.3e9], ['vechain', 'VET', 'VeChain', 0.016, 1.4e9],
    ['cosmos', 'ATOM', 'Cosmos Hub', 3.1, 1.5e9], ['algorand', 'ALGO', 'Algorand', 0.14, 1.2e9],
    ['filecoin', 'FIL', 'Filecoin', 1.7, 1.2e9], ['worldcoin-wld', 'WLD', 'Worldcoin', 0.71, 1.5e9],
    ['sei-network', 'SEI', 'Sei', 0.16, 0.98e9], ['jupiter-exchange-solana', 'JUP', 'Jupiter', 0.29, 0.95e9],
    ['bonk', 'BONK', 'Bonk', 0.0000102, 0.84e9], ['injective-protocol', 'INJ', 'Injective', 6.8, 0.68e9],
    ['celestia', 'TIA', 'Celestia', 0.94, 0.72e9], ['optimism', 'OP', 'Optimism', 0.38, 0.69e9],
    ['immutable-x', 'IMX', 'Immutable', 0.34, 0.66e9], ['the-graph', 'GRT', 'The Graph', 0.052, 0.55e9],
    ['stacks', 'STX', 'Stacks', 0.36, 0.64e9], ['dogwifcoin', 'WIF', 'dogwifhat', 0.31, 0.31e9],
    ['pudgy-penguins', 'PENGU', 'Pudgy Penguins', 0.0098, 0.62e9], ['first-digital-usd', 'FDUSD', 'First Digital USD', 0.9989, 1.1e9],
    ['paypal-usd', 'PYUSD', 'PayPal USD', 0.9999, 3.6e9], ['lombard-staked-btc', 'LBTC', 'Lombard Staked BTC', 82990, 1.1e9],
    ['jito-staked-sol', 'JITOSOL', 'Jito Staked SOL', 137.2, 1.9e9], ['zcash', 'ZEC', 'Zcash', 233, 3.8e9],
  ];
  const SYL = ['ar', 'be', 'cor', 'da', 'el', 'fi', 'gra', 'ho', 'iv', 'jo', 'ka', 'lu', 'mo', 'ne', 'or', 'pa', 'qua', 'ri', 'so', 'ta', 'ur', 've', 'wo', 'xa', 'yo', 'ze'];

  function coins(now = Date.now()) {
    const list = [];
    const tick = Math.floor(now / 30_000);
    for (let i = 0; i < 250; i++) {
      let id, symbol, name, price, cap;
      if (i < REAL_COINS.length) {
        [id, symbol, name, price, cap] = REAL_COINS[i];
      } else {
        const r = rng(hash(`coin${i}`));
        const a = SYL[Math.floor(r() * SYL.length)];
        const b = SYL[Math.floor(r() * SYL.length)];
        const c = SYL[Math.floor(r() * SYL.length)];
        name = `${a[0].toUpperCase()}${a.slice(1)}${b}${r() > 0.5 ? c : ''}`;
        symbol = `${name.slice(0, 3 + Math.floor(r() * 2))}${i % 7 === 0 ? i % 10 : ''}`.toUpperCase();
        id = `${name.toLowerCase()}-${i}`;
        cap = 0.3e9 * Math.pow(0.9925, i - REAL_COINS.length) * (0.85 + r() * 0.3);
        price = Math.pow(10, -4 + r() * 6);
      }
      const r = rng(hash(`${id}:ch`));
      const stableish = /usd|tether/i.test(`${id} ${name}`);
      const k = stableish ? 0.01 : 1;
      const phase = (hash(id) % 628) / 100;
      const wobble = stableish ? 0 : 0.004 * Math.sin(tick / 3 + phase);
      const d1 = gauss(r) * 3.2 * k + (i % 23 === 5 ? 21 : 0) - (i % 29 === 7 ? 17 : 0) + wobble * 100;
      // A few thin, broken markets like the ones the old movers list was full of. They must never rank.
      const dead = i > REAL_COINS.length && i % 17 === 0;
      const volume = dead ? 140_000 + r() * 300_000 : cap * (0.02 + r() * 0.12);
      list.push({
        id,
        symbol: symbol.toLowerCase(),
        name,
        image: `/__dev/icon?s=${encodeURIComponent(symbol)}`,
        current_price: price * (1 + wobble),
        market_cap: cap * (1 + wobble),
        market_cap_rank: i + 1,
        fully_diluted_valuation: cap * 1.2,
        total_volume: volume,
        high_24h: price * 1.02,
        low_24h: price * 0.97,
        price_change_24h: (price * d1) / 100,
        price_change_percentage_24h: dead ? -97.5 : d1,
        circulating_supply: cap / price,
        ath: price * (1.4 + r() * 6),
        ath_change_percentage: -(20 + r() * 70),
        last_updated: new Date(now).toISOString(),
        price_change_percentage_1h_in_currency: gauss(r) * 0.6 * k + wobble * 40,
        price_change_percentage_24h_in_currency: dead ? -97.5 : d1,
        price_change_percentage_7d_in_currency: gauss(r) * 8 * k,
        price_change_percentage_30d_in_currency: gauss(r) * 18 * k,
        price_change_percentage_1y_in_currency: i > 200 && i % 5 === 0 ? null : gauss(r) * 60 * k + 5,
      });
    }
    return list;
  }

  /** The podcast hub in the shape /api/podcasts returns. `shows` is the real directory. */
  function podcasts(shows, topics) {
    const now = Date.now();
    const titles = ['What the Fed does next', 'A listener asks: pay off the mortgage or invest?', 'The deal that changed an industry', 'Bull case, bear case', 'Inside a record quarter', 'Three charts everyone is arguing about'];
    const list = shows.map((show, i) => ({
      ...show,
      url: `https://www.youtube.com/channel/${show.channel}`,
      episodes: [0, 1, 2].map((n) => {
        const at = now - ((i * 5 + n * 31 + 2) % 140) * 3_600_000;
        return {
          id: `${show.id}-${n}`,
          title: `${titles[(i + n) % titles.length]} | ${show.name}`,
          link: `https://example.com/podcasts/${show.id}/${n}`,
          summary: '',
          image: `/__dev/img?i=${(i + n) % 9}`,
          source: show.name,
          publishedAt: new Date(at).toISOString(),
          publishedMs: at,
          mediaType: 'video',
          topic: show.topic,
          type: 'podcast',
          show: show.id,
        };
      }),
    }));
    const latest = list.flatMap((s) => s.episodes).sort((a, b) => b.publishedMs - a.publishedMs).slice(0, 36);
    const used = new Set(list.map((s) => s.topic));
    return { ok: true, shows: list, latest, topics: topics.filter((t) => used.has(t.id)).map((t) => ({ id: t.id, label: t.label, short: t.short })), failed: [], stale: false, fetchedAt: new Date(now).toISOString() };
  }

  function jupiter() {
    const out = [];
    for (let i = 0; i < 260; i++) {
      const r = rng(hash(`sol${i}`));
      const a = SYL[Math.floor(r() * SYL.length)];
      const b = SYL[Math.floor(r() * SYL.length)];
      const sym = i === 0 ? 'SOL' : i === 1 ? 'USDC' : i === 2 ? 'JUP' : i === 3 ? 'BONK' : i === 4 ? 'WIF' : `${a}${b}`.toUpperCase().slice(0, 5);
      const mcap = i === 0 ? 60e9 : Math.pow(10, 5.2 + r() * 4);
      const vol = mcap * (0.01 + r() * 0.5);
      const stats = (scale) => ({ priceChange: gauss(r) * scale, buyVolume: (vol * scale) / 20, sellVolume: (vol * scale) / 22 });
      out.push({
        id: `So1${hash(sym + i).toString(36)}MockMint${i}`,
        name: i === 0 ? 'Solana' : `${a[0].toUpperCase()}${a.slice(1)}${b} Token`,
        symbol: sym,
        icon: `/__dev/icon?s=${encodeURIComponent(sym)}`,
        usdPrice: i === 0 ? 109.3 : Math.pow(10, -5 + r() * 5),
        mcap,
        stats1h: stats(2),
        stats6h: stats(6),
        stats24h: stats(14),
        tags: ['verified'],
        isVerified: true,
      });
    }
    return out;
  }

  function fng(now = Date.now()) {
    const data = [];
    const today = Math.floor(now / 1000 / DAY) * DAY;
    const r = rng(hash('fng'));
    let v = 41;
    for (let i = 0; i < 31; i++) {
      const label = v < 25 ? 'Extreme Fear' : v < 45 ? 'Fear' : v < 55 ? 'Neutral' : v < 75 ? 'Greed' : 'Extreme Greed';
      data.push({ value: String(Math.round(v)), value_classification: label, timestamp: String(today - i * DAY) });
      v = Math.max(8, Math.min(92, v + gauss(r) * 5));
    }
    return { name: 'Fear and Greed Index', data };
  }

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  /** Answer an upstream request, or return null if this host is not mocked. */
  async function handle(input) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const host = url.hostname;
    const q = url.searchParams;

    if (host === 'query1.finance.yahoo.com' || host === 'query2.finance.yahoo.com') {
      if (url.pathname === '/v7/finance/spark') {
        const symbols = (q.get('symbols') ?? '').split(',').filter(Boolean);
        if (symbols.length > 20) return json({ spark: { result: null, error: { code: 'Bad Request' } } }, 400);
        const result = [];
        for (const sym of symbols) {
          const b = block(sym, q.get('range') ?? '1d', q.get('interval') ?? '1d');
          if (b) result.push({ symbol: sym, response: [b] });
        }
        return json({ spark: { result, error: null } });
      }
      if (url.pathname.startsWith('/v8/finance/chart/')) {
        const sym = decodeURIComponent(url.pathname.split('/').pop());
        const b = block(sym, q.get('range') ?? '1d', q.get('interval') ?? '1d');
        if (!b) return json({ chart: { result: null, error: { code: 'Not Found' } } }, 404);
        return json({ chart: { result: [b], error: null } });
      }
      if (url.pathname.includes('/fundamentals-timeseries/')) {
        const sym = decodeURIComponent(url.pathname.split('/').pop());
        const price = basePrice(sym);
        const count = shares[sym] ?? (price ? (hash(sym) % 900 + 100) * 1e6 : null);
        if (!price || !count || /-USD$|=F$|^\^/.test(sym)) return json({ timeseries: { result: [{ meta: {} }] } });
        const p = calendar.etParts(Date.now());
        const last = calendar.prevTradingDay(p.y, p.m, p.d, true).key;
        return json({
          timeseries: { result: [{ trailingMarketCap: [{ asOfDate: last, reportedValue: { raw: count * price } }] }] },
        });
      }
      if (url.pathname === '/v1/finance/search') {
        const term = (q.get('q') ?? '').toUpperCase();
        const pool = Object.keys(prices).filter((s) => s.includes(term) || (names[s] ?? '').toUpperCase().includes(term));
        return json({
          quotes: pool.slice(0, 8).map((s) => ({
            symbol: s,
            shortname: names[s] ?? NAMES[s] ?? s,
            quoteType: isCrypto(s) ? 'CRYPTOCURRENCY' : s.startsWith('^') ? 'INDEX' : isFuture(s) ? 'FUTURE' : 'EQUITY',
          })),
        });
      }
    }

    if (host === 'api.coingecko.com' && url.pathname === '/api/v3/coins/markets') {
      const per = Number(q.get('per_page')) || 100;
      let list = coins();
      // A stand-in for CoinGecko's "Ethereum ecosystem" category: ether plus a fixed share of the rest.
      if (q.get('category') === 'ethereum-ecosystem') {
        list = list.filter((c, i) => c.id === 'ethereum' || (i % 3 === 1 && !['bitcoin', 'solana', 'ripple'].includes(c.id)));
      }
      return json(list.slice(0, per));
    }

    if (host === 'api.nasdaq.com') {
      const sym = decodeURIComponent(url.pathname.split('/')[3] ?? '').replace(/\./g, '-');
      const price = basePrice(sym);
      const count = shares[sym];
      if (!price || !count) return json({ data: null });
      const cap = count * price;
      return json({
        data: {
          summaryData: {
            MarketCap: { value: Math.round(cap).toLocaleString('en-US') },
            AUM: { value: Math.round(cap / 1000).toLocaleString('en-US') },
          },
        },
      });
    }

    if (host === 'lite-api.jup.ag') return json(jupiter());
    if (host === 'api.alternative.me') return json(fng());
    return null;
  }

  /** Headlines in the shape /api/headlines returns (the real one reads dozens of RSS feeds). */
  function headlines(category) {
    const POOL = {
      markets: ['Fed minutes show officials saw more work to do to quell inflation', 'Why markets are buoyant, and under pressure', 'Treasury yields climb as traders reprice rate path', 'Jobless claims fall to a six-month low', 'Dollar steadies ahead of inflation report', 'Chip stocks lead Nasdaq to a record close', 'What a steeper yield curve means for banks', 'Consumer sentiment slips for a second month'],
      investing: ['Five funds that beat the index this year, and why', 'Earnings season: what analysts expect from big tech', 'Dividend growers are back in favour', 'Small caps have lagged for a decade. Is that changing?', 'How to read a company buyback', 'Bond ladders, explained with numbers'],
      'personal-finance': ['Savings rates: 5% deals may not last, say experts', 'What to do with an old 401(k)', 'The real cost of carrying a card balance', 'Tax brackets for next year are out', 'Is renters insurance worth it? A worked example', 'How much emergency fund is enough'],
      crypto: ['Bitcoin holds $82,000 as ETF inflows return', 'Ethereum developers set date for next upgrade', 'Stablecoin supply reaches a new high', 'Solana activity jumps as fees stay low', 'Exchange volumes rebound in October', 'What the latest halving cycle chart is telling traders'],
      'real-estate': ['Mortgage rates dip to the lowest since spring', 'New listings rise as sellers return', 'Office vacancies are still climbing downtown', 'Builders cut prices to move inventory', 'Rents are flat in most big cities'],
      technology: ['Chipmakers race to add capacity', 'New model release resets the benchmark tables', 'Data centers strain local power grids', 'Cloud spending keeps growing', 'Humanoid robots move from demo to factory floor', 'Inside the fight over app store fees'],
      policy: ['Senate panel advances market structure bill', 'SEC proposes changes to fund disclosure rules', 'Tariff review could reshape supply chains', 'Fed governors split on the pace of cuts', 'Treasury outlines new stablecoin guidance'],
      business: ['Big banks kick off earnings season with a beat', 'Retail giant to buy rival in $9 billion deal', 'Automaker recalls 200,000 vehicles', 'Airline orders 100 new jets', 'A founder steps down after 20 years', 'Why layoffs are rising in consulting'],
      commodities: ['Oil slips as supply worries ease', 'Gold steadies near a record', 'Copper rallies on grid spending', 'OPEC+ keeps output plan unchanged', 'Natural gas jumps on a cold forecast', 'Wheat falls as harvest beats estimates'],
      healthcare: ['Drugmaker wins approval for obesity pill', 'Hospitals brace for a hard flu season', 'A longevity trial reports its first results', 'Insurers raise premiums for next year', 'What a new blood test can and cannot detect'],
    };
    const LEGACY = { tradfi: 'markets', web3nfts: 'crypto', politics: 'policy', housing: 'real-estate', ai: 'technology', robotics: 'technology', genart: 'technology', health: 'healthcare', longevity: 'healthcare' };
    category = LEGACY[category] ?? category;
    const titles = POOL[category] ?? POOL.markets;
    const sources = ['BBC Business', 'CNBC Markets', 'WSJ Markets', 'NYT Business', 'Guardian Business', 'CoinDesk'];
    const now = Date.now();
    const items = titles.map((title, i) => ({
      id: `${category}-${i}`,
      title,
      link: `https://example.com/${category}/${i}`,
      summary: 'A short summary of the story appears here so the card has two or three lines of supporting text to show.',
      image: i % 5 === 4 ? null : `/__dev/img?i=${hash(category) % 9 + i}`,
      source: sources[(i + hash(category)) % sources.length],
      publishedAt: new Date(now - (i * 47 + 12) * 60_000).toISOString(),
      publishedMs: now - (i * 47 + 12) * 60_000,
      mediaType: i % 4 === 3 || i % 5 === 2 ? 'video' : 'article',
      topic: category,
      type: i % 5 === 2 ? 'podcast' : i % 4 === 3 ? 'video' : 'article',
    }));
    return {
      category,
      topic: category,
      items,
      feedsUsed: sources.slice(0, 4),
      feedsFailed: [],
      thin: false,
      note: null,
      stale: false,
      source: 'public-rss',
      fetchedAt: new Date(now).toISOString(),
    };
  }

  return { handle, headlines, podcasts, livePrice };
}

/** A round icon with the ticker's first letters, standing in for coin and company logos. */
export function iconSvg(symbol) {
  const hue = hash(symbol) % 360;
  const text = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, symbol.length > 4 ? 1 : 3).toUpperCase() || '?';
  const size = text.length > 2 ? 22 : text.length > 1 ? 26 : 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 70% 58%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 65% 38%)"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#g)"/><text x="32" y="${32 + size * 0.36}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff">${text}</text></svg>`;
}

/** A 16:9 picture standing in for a headline photo. */
export function photoSvg(i) {
  const hue = (i * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 50% 18%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="${140 + (i * 53) % 360}" cy="${120 + (i * 31) % 120}" r="90" fill="hsl(${(hue + 30) % 360} 60% 55% / .35)"/><rect x="0" y="250" width="640" height="110" fill="rgba(0,0,0,.28)"/></svg>`;
}
