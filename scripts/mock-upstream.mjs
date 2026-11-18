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
      indicators: {
        quote: [
          {
            close: series.c,
            volume: series.c.map(() => Math.round(1e5 + r() * 4e6)),
            // Each bar opens near the previous close, and its range covers both ends.
            open: series.c.map((c, i) => (i ? series.c[i - 1] : c) * (1 + (r() - 0.5) * 0.004)),
            high: series.c.map((c, i) => Math.max(c, i ? series.c[i - 1] : c) * (1 + r() * 0.006)),
            low: series.c.map((c, i) => Math.min(c, i ? series.c[i - 1] : c) * (1 - r() * 0.006)),
          },
        ],
      },
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

  /** The time the market-wide lists below describe. Tests set it to run "Yesterday's best buys" at chosen times. */
  let clockMs = null;
  /** Rows that must never be picked: like an unknown symbol, Yahoo has no daily bars for them. */
  const madeUpStocks = new Set(['QWRNW', 'QPRF-PA', 'QTNY', 'QTHN']);
  /** The made-up small companies in the full stock lists, by symbol: price and change on the session shown. */
  const smallStocks = new Map();
  /** Stocks and coins Yahoo has no daily bars for (tests: the biggest gainers, to see the next ones are checked). */
  let stockBarsMissing = new Set();
  let coinBarsMissing = 0;
  /** The day's biggest coin gainer gets a daily bar 30% off its listed close (tests: it is left out). */
  let badCoinBar = false;
  let yahooCoinsDown = false;
  /** The session Nasdaq's screener shows (YYYY-MM-DD); null: the last finished one. Like the real one, it can lag. */
  let nasdaqDay = null;
  const clock = () => clockMs ?? Date.now();

  /**
   * Nasdaq's screener of every US stock: the site's own stocks, a few hundred made-up small ones, and
   * rows that must never be picked: a warrant, a preferred share, one under the $1M floor and one that
   * barely traded (each with a bigger gain than any real pick).
   */
  function nasdaqScreener(showDay = nasdaqDay) {
    const rows = [];
    const add = (symbol, name, price, pct, volume, cap) =>
      rows.push({
        symbol,
        name,
        lastsale: `$${price.toFixed(2)}`,
        netchange: (price - price / (1 + pct / 100)).toFixed(2),
        pctchange: `${pct.toFixed(3)}%`,
        volume: String(Math.round(volume)),
        marketCap: cap ? cap.toFixed(2) : '',
        country: 'United States',
        ipoyear: '',
        industry: '',
        sector: '',
        url: `/market-activity/stocks/${symbol.toLowerCase()}`,
      });
    // The site's own stocks carry the session's real (generated) close and change, matching the Yahoo
    // stand-in, so the endpoint can tell which session the list shows.
    const now = Date.now();
    for (const [sym, count] of Object.entries(shares)) {
      const price = basePrice(sym);
      if (!price || /-USD$|=F$|^\^/.test(sym)) continue;
      const s = dailySeries(sym, 30, now);
      if (!s) continue;
      const keys = s.t.map((t) => calendar.etParts(t * 1000).key);
      // By default the last finished session: the latest bar, or the one before while today's is still trading.
      const day = showDay ?? keys[calendar.marketStatus(now).open ? keys.length - 2 : keys.length - 1];
      const i = keys.indexOf(day);
      if (i < 1) continue;
      const r = rng(hash(`${sym}:nq`));
      add(sym.replace(/-/g, '/'), `${names[sym] ?? sym} Common Stock`, s.c[i], (s.c[i] / s.c[i - 1] - 1) * 100, 2e6 + r() * 3e7, count * s.c[i]);
    }
    for (let i = 0; i < 700; i++) {
      const r = rng(hash(`small${i}`));
      const sym = `Q${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}${i % 3 ? '' : 'X'}`;
      const price = 0.5 + r() * 40;
      const pct = gauss(r) * 6 + (i % 97 === 3 ? 60 + (i % 7) * 9 : 0);
      smallStocks.set(sym, { price, pct });
      add(sym, `Smallco ${i} Inc. Common Stock`, price, pct, 50_000 + r() * 4e6, 2e6 + r() * 3e9);
    }
    add('QWRNW', 'Smallco Holdings Inc. Warrant', 0.04, 400, 3e6, 4e7);
    add('QPRF^A', 'Smallco Financial 7.5% Series A Preferred Stock', 21, 350, 1e6, 9e8);
    add('QTNY', 'Tiny Shell Corp. Common Stock', 0.2, 500, 9e6, 600_000);
    add('QTHN', 'Thinly Traded Inc. Common Stock', 3, 300, 900, 5e7);
    return { data: { asOf: null, headers: {}, rows } };
  }

  /**
   * CoinPaprika: 400 coins with rolling changes, and each coin's candle for yesterday (UTC) that agrees
   * with them. As with stocks, one coin under the floor and one that barely traded have the biggest moves.
   */
  function paprikaCoins() {
    const list = [];
    for (let i = 0; i < 400; i++) {
      const r = rng(hash(`pp${i}`));
      const special = i === 398 ? 'tiny' : i === 399 ? 'thin' : null;
      const id = special ? `${special}-${special}coin` : `c${i}-coin-${i}`;
      // Some coins are priced in millionths of a dollar, as many are (one of them a runner).
      const micro = !special && (i % 9 === 4 || (i % 41 === 9 && i % 3 === 2));
      const price = Math.pow(10, -3 + r() * 5) * (micro ? 1e-5 : 1);
      const cap = special === 'tiny' ? 400_000 : 5e9 * Math.pow(0.985, i) * (0.8 + r() * 0.4);
      const volume = special === 'thin' ? 2_000 : cap * (0.03 + r() * 0.1);
      const day = special ? 300 : gauss(r) * 5 + (i % 41 === 9 ? 45 + (i % 5) * 11 : 0);
      list.push({ i, id, name: special ? `${special} coin` : `Coin ${i}`, symbol: special ? special.toUpperCase() : `C${i}`, base: price, price, cap, volume, day, today: gauss(r) * 1.5 });
    }
    // Every source tells the same story: yesterday's candle runs from the close two days ago to yesterday's
    // close on the coin's one price path (coinCloseOn), and the price now is a little on from there.
    const n = Math.floor(clock() / DAY_MS);
    for (const c of list) {
      const y0 = coinCloseOn(c, n - 2);
      const y1 = coinCloseOn(c, n - 1);
      c.day = (y1 / y0 - 1) * 100;
      c.price = y1 * (1 + c.today / 100);
    }
    return list;
  }
  const paprikaById = () => new Map(paprikaCoins().map((c) => [c.id, c]));
  const utcKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);

  function paprikaTickers() {
    const now = clock();
    return paprikaCoins().map((c) => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      rank: c.i + 1,
      total_supply: 1e9,
      max_supply: 0,
      beta_value: 1,
      first_data_at: '2020-01-01T00:00:00Z',
      last_updated: new Date(now).toISOString(),
      quotes: {
        USD: {
          price: c.price,
          volume_24h: c.volume,
          volume_24h_change_24h: 0,
          market_cap: c.cap,
          market_cap_change_24h: 0,
          percent_change_15m: 0,
          percent_change_30m: 0,
          percent_change_1h: c.today / 4,
          percent_change_6h: c.today / 2,
          percent_change_12h: c.today,
          percent_change_24h: ((1 + c.day / 100) * (1 + c.today / 100) - 1) * 100,
          percent_change_7d: c.day,
          ath_price: c.price * 3,
          ath_date: '2021-11-10T00:00:00Z',
          percent_from_price_ath: -60,
        },
      },
    }));
  }

  /**
   * Yahoo's list of every coin (CoinMarketCap's figures): the same coins, each with a close at every
   * 00:00 UTC that follows a fixed path, so a test running over several days knows each day's change.
   * Every 41st coin runs (+70% or so) on alternate days; TINY (under the floor) and THIN (barely traded)
   * triple on odd days. A few tickers carry CoinMarketCap's id, as Yahoo does when tickers clash.
   */
  const DAY_MS = 86_400_000;
  let paprikaDown = false;
  function coinCloseOn(c, n) {
    const r = rng(hash(`${c.id}:d${n}`));
    const special = c.id.startsWith('tiny-') || c.id.startsWith('thin-');
    const w = gauss(r) * 0.03 + (c.i % 41 === 9 ? ((n + c.i) % 2) * 0.55 : 0) + (special ? (n % 2) * 1.2 : 0);
    return c.base * Math.exp(w);
  }
  /**
   * Yahoo's bars for a mocked coin. Daily: a bar at each 00:00 UTC closing on the path, the last one at the
   * price now, rounded to six decimals as Yahoo's are (which only matters for the smallest prices). Hourly
   * (five days): full digits, moving along the path, each day's last bar closing on the day's close.
   */
  function coinBlock(c, days, interval = '1d') {
    const now = clock();
    const n = Math.floor(now / DAY_MS);
    const t = [];
    const close = [];
    if (interval === '1h' || interval === '60m') {
      const lastHour = Math.floor((now % DAY_MS) / 3_600_000);
      for (let d = n - 4; d <= n; d++) {
        const a = coinCloseOn(c, d - 1);
        const b = d === n ? c.price : coinCloseOn(c, d);
        const hours = d === n ? lastHour + 1 : 24;
        for (let h = 0; h < hours; h++) {
          t.push(d * 86_400 + h * 3600);
          close.push(a * Math.pow(b / a, (h + 1) / hours));
        }
      }
    } else {
      for (let d = n - days + 1; d <= n; d++) {
        t.push(d * 86_400);
        close.push(d === n ? c.price : Math.round(coinCloseOn(c, d) * 1e6) / 1e6);
      }
    }
    return {
      meta: { currency: 'USD', symbol: yahooCoinSymbol(c), instrumentType: 'CRYPTOCURRENCY', regularMarketTime: Math.floor(clock() / 1000), regularMarketPrice: c.price, previousClose: close[close.length - 2], chartPreviousClose: close[0] },
      timestamp: t,
      indicators: { quote: [{ close }] },
    };
  }
  const yahooCoinSymbol = (c) => (c.i % 50 === 7 ? `${c.symbol}${1000 + c.i}-USD` : `${c.symbol}-USD`);
  function yahooCryptoScreener(start, count) {
    const n = Math.floor(clock() / DAY_MS);
    const rows = paprikaCoins()
      .map((c) => {
        const prev = coinCloseOn(c, n - 1);
        return {
          language: 'en-US',
          region: 'US',
          quoteType: 'CRYPTOCURRENCY',
          typeDisp: 'Cryptocurrency',
          quoteSourceName: 'CoinMarketCap',
          currency: 'USD',
          exchange: 'CCC',
          coinImageUrl: `https://s2.coinmarketcap.com/static/img/coins/64x64/${1000 + c.i}.png`,
          marketCap: c.cap,
          volume24Hr: c.volume,
          regularMarketTime: Math.floor(clock() / 1000),
          regularMarketPrice: prev * (1 + c.today / 100),
          regularMarketPreviousClose: prev,
          shortName: `${c.name} USD`,
          symbol: yahooCoinSymbol(c),
        };
      })
      .sort((a, b) => b.marketCap - a.marketCap);
    const quotes = rows.slice(start, start + count);
    return { finance: { result: [{ id: 'all', title: 'All Cryptocurrencies', start, count: quotes.length, total: rows.length, quotes }], error: null } };
  }

  /**
   * Yahoo's stock screener (needs a cookie from fc.yahoo.com and the crumb that goes with it): the same
   * stocks as Nasdaq's list, for the last finished session, plus one row whose previous close is wrong
   * (as Yahoo's has been for a share consolidation), making a small move look like +900%.
   */
  let yahooStocksDown = false;
  let badYahooStock = null;
  function yahooStockScreener(body) {
    const rows = nasdaqScreener(null).data.rows;
    const ops = JSON.stringify(body?.query ?? {});
    const gainersOnly = ops.includes('"percentchange"');
    const toQuote = (r, prevClose) => {
      const price = parseFloat(r.lastsale.slice(1));
      return {
        symbol: r.symbol.replace(/\//g, '-').replace(/\^/g, '-P'),
        quoteType: 'EQUITY',
        exchange: 'NMS',
        shortName: r.name,
        longName: r.name,
        regularMarketPrice: price,
        regularMarketPreviousClose: prevClose ?? price / (1 + parseFloat(r.pctchange) / 100),
        regularMarketVolume: Number(r.volume),
        marketCap: Number(r.marketCap) || 0,
        regularMarketTime: Math.floor(Date.parse(`${lastSessionKey()}T21:00:00Z`) / 1000),
      };
    };
    const quotes = rows.map((r) => toQuote(r));
    const big = quotes.find((q) => q.marketCap > 1e11);
    if (big) big.regularMarketPreviousClose = big.regularMarketPrice / 10.08;
    badYahooStock = big?.symbol ?? null;
    const listed = quotes.filter((q) => q.marketCap >= 1e6 && (!gainersOnly || q.regularMarketPrice > q.regularMarketPreviousClose));
    listed.sort((a, b) => b.regularMarketPrice / b.regularMarketPreviousClose - a.regularMarketPrice / a.regularMarketPreviousClose);
    const size = Math.min(250, Number(body?.size) || 25);
    return { finance: { result: [{ start: 0, count: Math.min(size, listed.length), total: listed.length, quotes: listed.slice(0, size) }], error: null } };
  }
  function lastSessionKey() {
    const now = Date.now();
    const p = calendar.etParts(now);
    const today = calendar.tradingDay(p.y, p.m, p.d);
    if (today && p.minutes >= today.close + 15) return today.key;
    return calendar.prevTradingDay(p.y, p.m, p.d, false).key;
  }

  /**
   * Daily bars for a made-up small stock, agreeing with the lists: the listed change on each of the last
   * two finished sessions (Nasdaq's list can lag by one), ending at the listed price; flat before.
   */
  function smallStockBlock(sym) {
    const row = smallStocks.get(sym);
    if (!row) return null;
    const keys = [lastSessionKey()];
    while (keys.length < 22) {
      const [y, m, d] = keys[0].split('-').map(Number);
      keys.unshift(calendar.prevTradingDay(y, m, d, false).key);
    }
    const g = 1 + row.pct / 100;
    const close = keys.map((_, j) => {
      const back = keys.length - 1 - j;
      return back <= 2 ? row.price / Math.pow(g, back) : (row.price / g / g) * (1 + 0.01 * Math.sin(j));
    });
    return {
      meta: { currency: 'USD', symbol: sym, instrumentType: 'EQUITY', regularMarketTime: Math.floor(Date.parse(`${keys.at(-1)}T21:00:00Z`) / 1000), regularMarketPrice: row.price, previousClose: close.at(-2) },
      timestamp: keys.map((k) => Math.floor(Date.parse(`${k}T14:30:00Z`) / 1000)),
      indicators: { quote: [{ close }] },
    };
  }

  /** Yesterday's (UTC) biggest coin gainers, biggest first, among the coins over the floors. */
  function coinGainersByDay() {
    const n = Math.floor(clock() / DAY_MS);
    return paprikaCoins()
      .filter((c) => !c.id.startsWith('tiny-') && !c.id.startsWith('thin-'))
      .map((c) => ({ c, change: coinCloseOn(c, n - 1) / coinCloseOn(c, n - 2) }))
      .sort((a, b) => b.change - a.change)
      .map((x) => yahooCoinSymbol(x.c));
  }

  /** Answer an upstream request, or return null if this host is not mocked. */
  async function handle(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const host = url.hostname;
    const q = url.searchParams;

    if (host === 'fc.yahoo.com') {
      return new Response('Not Found', { status: 404, headers: { 'Set-Cookie': 'A3=d=mock&S=mock; Max-Age=31557600; Domain=.yahoo.com; Path=/; Secure; HttpOnly; SameSite=None' } });
    }
    if (host === 'query2.finance.yahoo.com' && url.pathname === '/v1/test/getcrumb') {
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      return cookie.includes('A3=') ? new Response('mockCrumb.1', { headers: { 'Content-Type': 'text/plain' } }) : new Response('Unauthorized', { status: 401 });
    }
    if (host === 'query2.finance.yahoo.com' && url.pathname === '/v1/finance/screener') {
      const cookie = new Headers(init?.headers).get('cookie') ?? '';
      if (yahooStocksDown) return json({ finance: { result: null, error: { code: 'Internal Server Error' } } }, 500);
      if (q.get('crumb') !== 'mockCrumb.1' || !cookie.includes('A3=')) return json({ finance: { result: null, error: { code: 'Unauthorized', description: 'Invalid Crumb' } } }, 401);
      return json(yahooStockScreener(JSON.parse(init?.body ?? '{}')));
    }

    if (host === 'query1.finance.yahoo.com' || host === 'query2.finance.yahoo.com') {
      if (url.pathname === '/v1/finance/screener/predefined/saved' && q.get('scrIds') === 'all_cryptocurrencies_us') {
        if (yahooCoinsDown) return json({ finance: { result: null, error: { code: 'Internal Server Error' } } }, 500);
        return json(yahooCryptoScreener(Number(q.get('start')) || 0, Math.min(250, Number(q.get('count')) || 25)));
      }
      if (url.pathname === '/v7/finance/spark') {
        const symbols = (q.get('symbols') ?? '').split(',').filter(Boolean);
        if (symbols.length > 20) return json({ spark: { result: null, error: { code: 'Bad Request' } } }, 400);
        const result = [];
        const ranked = coinBarsMissing || badCoinBar ? coinGainersByDay() : [];
        for (const sym of symbols) {
          if (madeUpStocks.has(sym) || stockBarsMissing.has(sym)) continue;
          const small = smallStockBlock(sym);
          if (small) {
            result.push({ symbol: sym, response: [small] });
            continue;
          }
          const coin = paprikaCoins().find((c) => yahooCoinSymbol(c) === sym);
          if (coin) {
            const at = ranked.indexOf(sym);
            if (at >= 0 && at < coinBarsMissing) continue;
            const b = coinBlock(coin, 30, q.get('interval') ?? '1d');
            // The bar that closes yesterday (UTC): the last one before today.
            const close = b.indicators.quote[0].close;
            const today = Math.floor(clock() / DAY_MS) * 86_400;
            const end = b.timestamp.reduce((m, x, i) => (x < today ? i : m), -1);
            if (badCoinBar && at === 0 && end >= 0) close[end] *= 1.3;
            result.push({ symbol: sym, response: [b] });
            continue;
          }
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
      // And for "BNB Chain ecosystem": BNB plus a different share.
      if (q.get('category') === 'binance-smart-chain') {
        list = list.filter((c, i) => c.id === 'binancecoin' || (i % 4 === 2 && !['bitcoin', 'ethereum', 'solana', 'ripple'].includes(c.id)));
      }
      // And for "Layer 2": known networks plus another share, with Nervos (which CoinGecko also files there).
      if (q.get('category') === 'layer-2') {
        const nervos = { ...list[list.length - 1], id: 'nervos-network', symbol: 'ckb', name: 'Nervos Network' };
        list = [...list.filter((c, i) => ['okb', 'mantle', 'arbitrum'].includes(c.id) || (i % 5 === 3 && !['bitcoin', 'ethereum', 'solana', 'ripple', 'binancecoin'].includes(c.id))), nervos];
      }
      return json(list.slice(0, per));
    }

    if (host === 'api.nasdaq.com' && url.pathname === '/api/screener/stocks') return json(nasdaqScreener());

    if (host === 'api.coinpaprika.com') {
      if (paprikaDown) return json({ error: 'Too many requests from this address' }, 402);
      const yesterday = utcKeyOf(clock() - 86_400_000);
      if (url.pathname === '/v1/tickers') return json(paprikaTickers());
      const latest = url.pathname.match(/^\/v1\/coins\/([^/]+)\/ohlcv\/latest$/);
      if (latest) {
        const c = paprikaById().get(decodeURIComponent(latest[1]));
        if (!c) return json([]);
        const close = c.price / (1 + c.today / 100);
        const open = close / (1 + c.day / 100);
        return json([{ time_open: `${yesterday}T00:00:00Z`, time_close: `${yesterday}T23:59:59Z`, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * 0.98, close, volume: c.volume, market_cap: c.cap }]);
      }
      const hist = url.pathname.match(/^\/v1\/tickers\/([^/]+)\/historical$/);
      if (hist) {
        const c = paprikaById().get(decodeURIComponent(hist[1]));
        if (!c) return json({ error: 'id not found' }, 404);
        const start = Date.parse(`${q.get('start')}T00:00:00Z`);
        const r = rng(hash(`${c.id}:hist`));
        const open = c.price / (1 + c.today / 100) / (1 + c.day / 100);
        const out = [];
        let p = open;
        const days = [];
        for (let t = start; t <= clock(); t += 86_400_000) days.push(t);
        // Walk back from yesterday's open so the series meets it at midnight.
        const back = days.filter((t) => utcKeyOf(t) <= yesterday).reverse();
        const vals = new Map();
        for (const t of back) {
          vals.set(t, p);
          p = p / (1 + gauss(r) * 0.04);
        }
        for (const t of days) out.push({ timestamp: new Date(t).toISOString().replace('.000', ''), price: vals.get(t) ?? c.price, volume_24h: c.volume, market_cap: c.cap });
        return json(out);
      }
      return json({ error: 'not mocked' }, 404);
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

    if (host === 'hn.algolia.com') return json(hnAnswer(Date.now()));
    if (host === 'www.reddit.com' && url.pathname.startsWith('/r/')) return json(redditAnswer(decodeURIComponent(url.pathname.split('/')[2] ?? ''), Date.now()));
    if (host === 'trends.google.com') {
      return new Response(trendsAnswer(q.get('geo') ?? 'US', Date.now()), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
    }
    if (host === 'lite-api.jup.ag') return json(jupiter());
    if (host === 'api.alternative.me') return json(fng());
    return null;
  }


  /* ── News board: stories covered by several outlets, plus Hacker News, Reddit and Google Trends ── */
  const STORY_SUBJECTS = {
    markets: ['Wall Street', 'Treasury yields', 'S&P 500', 'Dollar index', 'Nasdaq', 'Federal Reserve', 'Dow futures', 'Euro zone'],
    investing: ['Index funds', 'Berkshire', 'Dividend stocks', 'Vanguard', 'Small caps', 'Bond ETFs', 'Nvidia', 'Value investors'],
    'personal-finance': ['Savings accounts', 'Credit cards', 'Student loans', 'Social Security', 'Roth IRAs', 'Car insurance', 'Tax refunds', 'Retirees'],
    crypto: ['Bitcoin', 'Ethereum', 'Solana', 'Coinbase', 'Stablecoins', 'Binance', 'Ripple', 'Dogecoin'],
    'real-estate': ['Mortgage rates', 'Home prices', 'Zillow', 'Landlords', 'Office towers', 'Homebuilders', 'Renters', 'Redfin'],
    technology: ['OpenAI', 'Apple', 'Nvidia chips', 'Microsoft', 'Tesla robots', 'Google', 'Meta', 'Data centers'],
    policy: ['Senate', 'White House', 'SEC', 'Tariffs', 'Supreme Court', 'Treasury', 'Congress', 'Brussels'],
    business: ['Boeing', 'Walmart', 'Disney', 'Starbucks', 'Ford', 'Amazon', 'Nike', 'Pfizer'],
    commodities: ['Crude oil', 'Gold', 'Copper', 'Natural gas', 'Wheat', 'Lithium', 'Brent', 'Silver'],
    healthcare: ['Drugmakers', 'Hospitals', 'Medicare', 'Moderna', 'Insurers', 'Eli Lilly', 'Longevity labs', 'Pharmacies'],
  };
  const STORY_EVENTS = [
    'jumps after surprise earnings beat', 'faces probe over disclosure failures', 'announces sweeping restructuring plan', 'hits record as demand surges',
    'slumps amid supply disruption fears', 'wins landmark court ruling', 'unveils long-awaited product roadmap', 'plans major hiring spree',
    'warns about looming shortage', 'agrees takeover worth billions', 'braces for regulatory crackdown', 'posts unexpected quarterly loss',
    'launches pilot programme nationwide', 'delays flagship launch indefinitely', 'raises forecast following strong quarter', 'cuts guidance citing weak spending',
    'secures fresh funding round', 'pledges sharper cost discipline', 'settles lawsuit following mediation', 'expands partnership across continents',
    'tests new pricing structure', 'reveals data breach affecting customers', 'rallies on upgraded analyst outlook', 'stalls negotiations over licensing',
  ];
  // How many outlets run each story (index = story number).
  const STORY_OUTLETS = [5, 3, 2, 1, 6, 2, 1, 3, 1, 4, 2, 1, 4, 1, 2, 3, 1, 5, 2, 1, 3, 1, 2, 1];
  const STORY_OUTLET_NAMES = ['BBC Business', 'CNBC Markets', 'WSJ Markets', 'NYT Business', 'Guardian Business', 'CoinDesk', 'Reuters', 'Bloomberg'];
  const WORDING = [(t) => t, (t) => `${t}, analysts say`, (t) => `${t} - what to know`, (t) => `Why ${t}`, (t) => `${t} as investors react`, (t) => `Report: ${t}`];
  const REDDIT_TOPIC = { economics: 'markets', investing: 'investing', personalfinance: 'personal-finance', cryptocurrency: 'crypto', realestate: 'real-estate', technology: 'technology', politics: 'policy', business: 'business', energy: 'commodities', health: 'healthcare' };
  const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  /** Milliseconds since midnight in New York. */
  function sinceEtMidnight(now) {
    const p = Object.fromEntries(ETF.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    return ((Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000;
  }

  /**
   * 24 stories per topic: twelve released today (New York time), twelve yesterday
   * evening. Each is run by 1 to 6 outlets in slightly different words.
   */
  function newsStories(topic, now = Date.now()) {
    const since = Math.max(sinceEtMidnight(now), 40 * 60_000);
    const midnight = now - sinceEtMidnight(now);
    const subjects = STORY_SUBJECTS[topic] ?? STORY_SUBJECTS.markets;
    const off = hash(topic) % STORY_EVENTS.length;
    const stories = [];
    for (let i = 0; i < 24; i++) {
      const title = `${subjects[i % subjects.length]} ${STORY_EVENTS[(i * 7 + off) % STORY_EVENTS.length]}`;
      const first = i < 12 ? now - (since * (i + 0.4)) / 12 : midnight - ((i - 12) * 47 + 25) * 60_000;
      const k = STORY_OUTLETS[(i + off) % STORY_OUTLETS.length];
      const variants = [];
      for (let n = 0; n < k; n++) {
        const source = STORY_OUTLET_NAMES[(i + hash(topic) + n) % STORY_OUTLET_NAMES.length];
        variants.push({
          source,
          title: WORDING[n % WORDING.length](title),
          link: n === 0 ? `https://example.com/${topic}/${i}` : `https://${source.split(' ')[0].toLowerCase()}.example.com/${topic}/${i}-${n}`,
          publishedMs: Math.round(first + n * 9 * 60_000),
        });
      }
      stories.push({ i, topic, title, variants, publishedMs: Math.round(first) });
    }
    return stories;
  }

  /** The pool /api/headlines?pool=1 returns: every variant of every story, newest first. */
  function newsPool(topic, now = Date.now()) {
    return newsStories(topic, now)
      .flatMap((s) =>
        s.variants.map((v) => ({
          id: `${topic}-${s.i}-${v.source}`,
          title: v.title,
          link: v.link,
          summary: 'A short summary of the story appears here so the card has two or three lines of supporting text to show.',
          image: s.i % 5 === 4 ? null : `/__dev/img?i=${hash(topic) % 9 + s.i}`,
          source: v.source,
          publishedAt: new Date(v.publishedMs).toISOString(),
          publishedMs: v.publishedMs,
          mediaType: 'article',
          topic,
          type: 'article',
        })),
      )
      .sort((a, b) => b.publishedMs - a.publishedMs);
  }

  const allTopicStories = (now) => Object.keys(STORY_SUBJECTS).flatMap((t) => newsStories(t, now));

  function hnAnswer(now) {
    const hits = [];
    for (const s of allTopicStories(now)) {
      const h = hash(`hn${s.topic}${s.i}`);
      if (s.i % 3 !== 0 && s.i % 7 !== 2) continue;
      const v = s.variants[h % s.variants.length];
      hits.push({
        objectID: String(40_000_000 + (h % 900_000)),
        title: v.title,
        url: h % 2 ? s.variants[0].link : v.link,
        points: 40 + (h % 900),
        num_comments: h % 320,
        created_at_i: Math.floor(s.publishedMs / 1000) + 1800,
      });
    }
    hits.push({ objectID: '40999001', title: 'Show HN: A tiny database written in a weekend', url: 'https://example.org/tinydb', points: 212, num_comments: 64, created_at_i: Math.floor(now / 1000) - 7200 });
    return { hits, nbHits: hits.length };
  }

  function redditAnswer(subs, now) {
    const first = (subs.split('+')[0] ?? '').toLowerCase();
    const topic = REDDIT_TOPIC[first];
    const sub = subs.split('+')[0];
    const children = [];
    for (const s of topic ? newsStories(topic, now) : []) {
      const h = hash(`rd${s.topic}${s.i}`);
      if (s.i % 2 !== 0 && s.i % 5 !== 1) continue;
      const v = s.variants[(h >>> 3) % s.variants.length];
      children.push({
        kind: 't3',
        data: {
          title: s.i % 4 === 0 ? v.title : `Discussion: ${v.title}`,
          url: s.i % 3 === 0 ? s.variants[s.variants.length - 1].link : 'https://i.redd.it/mock.png',
          score: 120 + (h % 14_000),
          num_comments: 15 + (h % 1800),
          permalink: `/r/${sub}/comments/${(h % 1e6).toString(36)}/${s.i}/`,
          subreddit: sub,
          stickied: false,
        },
      });
    }
    children.push({ kind: 't3', data: { title: 'Weekly discussion thread: ask anything', url: 'https://www.reddit.com/r/mock/weekly', score: 55, num_comments: 410, permalink: `/r/${sub}/comments/weekly/thread/`, subreddit: sub } });
    return { kind: 'Listing', data: { children } };
  }

  function trendsAnswer(geo, now) {
    const traffic = ['20K+', '50K+', '100K+', '200K+', '500K+', '1M+', '2M+'];
    const geoIdx = ['US', 'GB', 'IN', 'CA', 'AU'].indexOf(geo);
    const items = [];
    for (const s of allTopicStories(now)) {
      if (s.i % 4 !== 1) continue;
      const h = hash(`tr${s.topic}${s.i}`);
      if ((h + geoIdx) % 3 === 0) continue;
      const query = `${s.title.split(' ').slice(0, 3).join(' ')}`;
      const url = h % 2 ? s.variants[0].link : s.variants[s.variants.length - 1].link;
      items.push(
        `<item><title>${query.replace(/&/g, '&amp;')}</title><ht:approx_traffic>${traffic[(h + geoIdx) % traffic.length]}</ht:approx_traffic>` +
          `<pubDate>${new Date(now).toUTCString()}</pubDate>` +
          `<ht:news_item><ht:news_item_title>${s.variants[0].title.replace(/&/g, '&amp;')}</ht:news_item_title><ht:news_item_url>${url}</ht:news_item_url><ht:news_item_source>Mock News</ht:news_item_source></ht:news_item></item>`,
      );
    }
    items.push('<item><title>weather tomorrow</title><ht:approx_traffic>1,000,000+</ht:approx_traffic></item>');
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss"><channel><title>Daily Search Trends</title>${items.join('')}</channel></rss>`;
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
      type: i % 4 === 3 || i % 5 === 2 ? 'video' : 'article',
    }));
    return {
      category,
      topic: category,
      items,
      pool: newsPool(category, now),
      feedsUsed: sources.slice(0, 4),
      feedsFailed: [],
      feedsQuiet: [],
      thin: false,
      note: null,
      stale: false,
      source: 'public-rss',
      fetchedAt: new Date(now).toISOString(),
    };
  }

  return {
    handle,
    headlines,
    livePrice,
    /** Fix the time the market-wide lists describe (null: the real time). */
    setClock(ms) {
      clockMs = ms;
    },
    /** Make Nasdaq's screener show a given session (null: the last finished one). */
    setNasdaqDay(key) {
      nasdaqDay = key;
    },
    /** The stock Yahoo's screener stand-in gives a wrong previous close (+900%). */
    get badYahooStock() {
      return badYahooStock;
    },
    /** Make Yahoo's stock screener fail, so Nasdaq's list is used. */
    setYahooStocksDown(down) {
      yahooStocksDown = !!down;
    },
    /** Make CoinPaprika refuse every request, as it does Cloudflare Functions once the shared allowance is used. */
    setPaprikaDown(down) {
      paprikaDown = !!down;
    },
    /** Make Yahoo's coin list fail. */
    setYahooCoinsDown(down) {
      yahooCoinsDown = !!down;
    },
    /** Take away the daily bars of the n biggest stock gainers on the last finished session (by the lists' figures); returns their Yahoo symbols. */
    setStockBarsMissing(n) {
      const special = new Set(['QWRNW', 'QPRF^A', 'QTNY', 'QTHN']);
      const rows = nasdaqScreener(null).data.rows.filter((r) => !special.has(r.symbol));
      rows.sort((a, b) => parseFloat(b.pctchange) - parseFloat(a.pctchange));
      stockBarsMissing = new Set(rows.slice(0, n).map((r) => r.symbol.replace(/\//g, '-')));
      return [...stockBarsMissing];
    },
    /** Take away the daily bars of yesterday's n biggest coin gainers; returns their Yahoo symbols. */
    setCoinBarsMissing(n) {
      coinBarsMissing = n;
      return coinGainersByDay().slice(0, n);
    },
    /** Give yesterday's biggest coin gainer a daily bar 30% off its listed close; returns its Yahoo symbol. */
    setBadCoinBar(on) {
      badCoinBar = !!on;
      return coinGainersByDay()[0];
    },
    /** Each mocked coin's close at the end of a UTC day (YYYY-MM-DD), by Yahoo symbol, for checking answers. */
    yahooCloses(dayKey) {
      const n = Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / DAY_MS);
      return Object.fromEntries(paprikaCoins().map((c) => [yahooCoinSymbol(c), coinCloseOn(c, n)]));
    },
  };
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
