/**
 * GET /api/cryptos — top coins by market cap.
 * Primary: CoinGecko. Durable last-good via KV LAYOUTS + Cache API.
 * Alternate: Binance public 24hr ticker (real prices + 24h %) when CG fails.
 * Never soft-return empty items when last-good or Binance data exists.
 */

const CG =
  'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h';

const KV_KEY = 'cache:cryptos:v1';
/** Fresh window before re-hitting CoinGecko (2–5 min). */
const FRESH_TTL_MS = 180_000;
/** Keep last-good in KV long enough to cover CG outages. */
const KV_TTL_SEC = 60 * 60 * 24;
const MEM_TTL_MS = 45_000;
const CACHE_API_URL = 'https://marketcheck.fun/__internal/cache/cryptos-v1';

type CGMarket = {
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
};

type CryptoItem = {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  ok: boolean;
  fallback: boolean;
  stale?: boolean;
};

type CachedPayload = {
  items: CryptoItem[];
  fetchedAt: string;
  source: string;
  stale?: boolean;
  ok?: boolean;
  error?: string;
};

type Env = { LAYOUTS?: KVNamespace };

type Ctx = { request: Request; env: Env };

let memCache: { at: number; body: string } | null = null;

const BINANCE_HOSTS = [
  'https://data-api.binance.vision',
  'https://api.binance.us',
  'https://api.binance.com',
] as const;

/** Approximate top market-cap order with Binance USDT pairs (stables use synthetic 1.0). */
const BINANCE_TOP: {
  id: string;
  symbol: string;
  name: string;
  pair: string | null;
  marketCap: number;
}[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', pair: 'BTCUSDT', marketCap: 1.7e12 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', pair: 'ETHUSDT', marketCap: 4.0e11 },
  { id: 'tether', symbol: 'USDT', name: 'Tether', pair: null, marketCap: 1.4e11 },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', pair: 'BNBUSDT', marketCap: 1.0e11 },
  { id: 'solana', symbol: 'SOL', name: 'Solana', pair: 'SOLUSDT', marketCap: 9.0e10 },
  { id: 'usd-coin', symbol: 'USDC', name: 'USDC', pair: 'USDCUSDT', marketCap: 6.0e10 },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', pair: 'XRPUSDT', marketCap: 1.5e11 },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', pair: 'DOGEUSDT', marketCap: 3.0e10 },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', pair: 'ADAUSDT', marketCap: 2.5e10 },
  { id: 'tron', symbol: 'TRX', name: 'TRON', pair: 'TRXUSDT', marketCap: 2.4e10 },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche', pair: 'AVAXUSDT', marketCap: 1.4e10 },
  { id: 'toncoin', symbol: 'TON', name: 'Toncoin', pair: 'TONUSDT', marketCap: 1.3e10 },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu', pair: 'SHIBUSDT', marketCap: 1.2e10 },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink', pair: 'LINKUSDT', marketCap: 1.1e10 },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot', pair: 'DOTUSDT', marketCap: 9e9 },
  { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', pair: 'BCHUSDT', marketCap: 8e9 },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin', pair: 'LTCUSDT', marketCap: 7e9 },
  { id: 'near', symbol: 'NEAR', name: 'NEAR Protocol', pair: 'NEARUSDT', marketCap: 6e9 },
  { id: 'uniswap', symbol: 'UNI', name: 'Uniswap', pair: 'UNIUSDT', marketCap: 6e9 },
  { id: 'internet-computer', symbol: 'ICP', name: 'Internet Computer', pair: 'ICPUSDT', marketCap: 5e9 },
  { id: 'stellar', symbol: 'XLM', name: 'Stellar', pair: 'XLMUSDT', marketCap: 4.5e9 },
  { id: 'hedera-hashgraph', symbol: 'HBAR', name: 'Hedera', pair: 'HBARUSDT', marketCap: 4e9 },
  { id: 'aptos', symbol: 'APT', name: 'Aptos', pair: 'APTUSDT', marketCap: 3.5e9 },
  { id: 'sui', symbol: 'SUI', name: 'Sui', pair: 'SUIUSDT', marketCap: 3.2e9 },
  { id: 'cosmos', symbol: 'ATOM', name: 'Cosmos', pair: 'ATOMUSDT', marketCap: 3e9 },
];

const CG_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'MarketCheckDash/1.0 (+https://marketcheck.fun)',
};

function jsonResponse(
  body: string,
  opts: { cacheControl?: string; xCache?: string; status?: number } = {},
): Response {
  return new Response(body, {
    status: opts.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': opts.cacheControl ?? 'public, max-age=30, s-maxage=60',
      'Access-Control-Allow-Origin': '*',
      ...(opts.xCache ? { 'X-Cache': opts.xCache } : {}),
    },
  });
}

function mapCgItems(data: CGMarket[]): CryptoItem[] {
  return data.map((c, i) => ({
    rank: c.market_cap_rank ?? i + 1,
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.image ?? null,
    price: c.current_price,
    changePercent: c.price_change_percentage_24h,
    marketCap: c.market_cap,
    ok: c.current_price != null,
    fallback: false,
  }));
}

function iconUrl(symbol: string): string {
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color/${symbol.toLowerCase()}.png`;
}

async function readKv(env: Env): Promise<{ payload: CachedPayload; at: number } | null> {
  if (!env.LAYOUTS) return null;
  try {
    const raw = await env.LAYOUTS.get(KV_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as CachedPayload & { storedAt?: number };
    if (!payload?.items?.length) return null;
    const at = payload.storedAt ?? (Date.parse(payload.fetchedAt) || 0);
    return { payload, at };
  } catch {
    return null;
  }
}

async function writeKv(env: Env, payload: CachedPayload): Promise<void> {
  if (!env.LAYOUTS) return;
  try {
    const stored = JSON.stringify({ ...payload, storedAt: Date.now() });
    await env.LAYOUTS.put(KV_KEY, stored, { expirationTtl: KV_TTL_SEC });
  } catch (e) {
    console.warn('[cryptos] KV put failed', e);
  }
}

async function readCacheApi(): Promise<CachedPayload | null> {
  try {
    const match = await caches.default.match(CACHE_API_URL);
    if (!match) return null;
    const payload = (await match.json()) as CachedPayload;
    if (!payload?.items?.length) return null;
    return payload;
  } catch {
    return null;
  }
}

async function writeCacheApi(payload: CachedPayload): Promise<void> {
  try {
    const res = new Response(JSON.stringify({ ...payload, storedAt: Date.now() }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${KV_TTL_SEC}`,
      },
    });
    await caches.default.put(CACHE_API_URL, res);
  } catch (e) {
    console.warn('[cryptos] Cache API put failed', e);
  }
}

async function persistGood(env: Env, payload: CachedPayload): Promise<string> {
  const body = JSON.stringify(payload);
  memCache = { at: Date.now(), body };
  await Promise.all([writeKv(env, payload), writeCacheApi(payload)]);
  return body;
}

type BnTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
};

async function fetchBinanceTickers(): Promise<Map<string, { price: number; change: number }>> {
  const map = new Map<string, { price: number; change: number }>();
  let lastErr: Error | null = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await fetch(`${host}/api/v3/ticker/24hr`, {
        headers: { Accept: 'application/json', 'User-Agent': CG_HEADERS['User-Agent'] },
      });
      if (!res.ok) {
        lastErr = new Error(`Binance HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as BnTicker[];
      if (!Array.isArray(json) || !json.length) {
        lastErr = new Error('Binance ticker empty');
        continue;
      }
      for (const t of json) {
        const price = Number(t.lastPrice);
        const change = Number(t.priceChangePercent);
        if (!Number.isFinite(price)) continue;
        map.set(t.symbol.toUpperCase(), {
          price,
          change: Number.isFinite(change) ? change : 0,
        });
      }
      if (map.size) return map;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error('Binance failed');
    }
  }
  if (!map.size && lastErr) throw lastErr;
  return map;
}

async function buildFromBinance(): Promise<CryptoItem[]> {
  const tickers = await fetchBinanceTickers();
  const items: CryptoItem[] = [];
  for (let i = 0; i < BINANCE_TOP.length; i++) {
    const row = BINANCE_TOP[i]!;
    if (!row.pair) {
      // Stablecoin peg — honest ~0% / $1 (prefer over demo zeros pretending to be live CG)
      items.push({
        rank: i + 1,
        id: row.id,
        symbol: row.symbol,
        name: row.name,
        image: iconUrl(row.symbol),
        price: 1,
        changePercent: 0,
        marketCap: row.marketCap,
        ok: true,
        fallback: false,
      });
      continue;
    }
    const t = tickers.get(row.pair);
    if (!t) continue;
    items.push({
      rank: i + 1,
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      image: iconUrl(row.symbol),
      price: t.price,
      changePercent: t.change,
      marketCap: row.marketCap,
      ok: true,
      fallback: false,
    });
  }
  // Re-rank after filtering missing pairs
  return items.map((it, idx) => ({ ...it, rank: idx + 1 }));
}

function ageMs(fetchedAt: string | undefined, storedAt?: number): number {
  if (storedAt && Number.isFinite(storedAt)) return Date.now() - storedAt;
  if (fetchedAt) {
    const t = Date.parse(fetchedAt);
    if (Number.isFinite(t)) return Date.now() - t;
  }
  return Number.POSITIVE_INFINITY;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const env = context?.env ?? ({} as Env);
  const now = Date.now();

  if (memCache && now - memCache.at < MEM_TTL_MS) {
    return jsonResponse(memCache.body, { xCache: 'MEM' });
  }

  // Fresh durable hit (KV / Cache API within FRESH_TTL)
  const kvHit = await readKv(env);
  if (kvHit && now - kvHit.at < FRESH_TTL_MS && kvHit.payload.items.length) {
    const body = JSON.stringify({
      ...kvHit.payload,
      stale: false,
      source: kvHit.payload.source || 'cache',
    });
    memCache = { at: now, body };
    return jsonResponse(body, { xCache: 'KV-FRESH' });
  }
  const apiHit = await readCacheApi();
  if (apiHit?.items?.length) {
    const storedAt = (apiHit as CachedPayload & { storedAt?: number }).storedAt;
    if (ageMs(apiHit.fetchedAt, storedAt) < FRESH_TTL_MS) {
      const body = JSON.stringify({ ...apiHit, stale: false });
      memCache = { at: now, body };
      return jsonResponse(body, { xCache: 'CF-FRESH' });
    }
  }

  let cgError: string | null = null;
  try {
    const res = await fetch(CG, { headers: CG_HEADERS });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = (await res.json()) as CGMarket[];
    if (!Array.isArray(data) || !data.length) throw new Error('CoinGecko empty');
    const items = mapCgItems(data);
    const payload: CachedPayload = {
      items,
      fetchedAt: new Date().toISOString(),
      source: 'coingecko',
      ok: true,
      stale: false,
    };
    const body = await persistGood(env, payload);
    return jsonResponse(body, { xCache: 'MISS' });
  } catch (e) {
    cgError = e instanceof Error ? e.message : 'fetch failed';
  }

  // Stale last-good (KV then Cache API) — never empty if we have it
  const staleKv = kvHit ?? (await readKv(env));
  if (staleKv?.payload?.items?.length) {
    const payload: CachedPayload = {
      ...staleKv.payload,
      items: staleKv.payload.items.map((it) => ({ ...it, stale: true, fallback: false })),
      stale: true,
      ok: true,
      source: 'cache',
      error: cgError ?? undefined,
      fetchedAt: staleKv.payload.fetchedAt,
    };
    const body = JSON.stringify(payload);
    memCache = { at: now, body };
    return jsonResponse(body, {
      cacheControl: 'public, max-age=15, s-maxage=30',
      xCache: 'KV-STALE',
    });
  }
  if (apiHit?.items?.length) {
    const payload: CachedPayload = {
      ...apiHit,
      items: apiHit.items.map((it) => ({ ...it, stale: true, fallback: false })),
      stale: true,
      ok: true,
      source: 'cache',
      error: cgError ?? undefined,
    };
    const body = JSON.stringify(payload);
    memCache = { at: now, body };
    return jsonResponse(body, {
      cacheControl: 'public, max-age=15, s-maxage=30',
      xCache: 'CF-STALE',
    });
  }

  // Alternate live path: Binance public 24hr ticker
  try {
    const items = await buildFromBinance();
    if (items.length) {
      const payload: CachedPayload = {
        items,
        fetchedAt: new Date().toISOString(),
        source: 'binance',
        ok: true,
        stale: false,
        error: cgError ?? undefined,
      };
      const body = await persistGood(env, payload);
      return jsonResponse(body, {
        cacheControl: 'public, max-age=30, s-maxage=60',
        xCache: 'BINANCE',
      });
    }
  } catch (e) {
    const bnErr = e instanceof Error ? e.message : 'Binance failed';
    cgError = cgError ? `${cgError}; ${bnErr}` : bnErr;
  }

  // Absolute last resort — empty (client may show demos; prefer never reaching here)
  return jsonResponse(
    JSON.stringify({
      items: [],
      ok: false,
      error: cgError || 'fetch failed',
      fetchedAt: new Date().toISOString(),
    }),
    { cacheControl: 'public, max-age=15', xCache: 'EMPTY' },
  );
}
