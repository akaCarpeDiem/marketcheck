/**
 * GET /api/markets?symbols=AAPL,MSFT,^GSPC          quotes (price, day change, market cap when known)
 * GET /api/markets?symbols=BND,VNQ&phase=mcaps      market caps only
 *
 * Quotes come from Yahoo Finance: one request for the whole batch.
 * The browser asks for 15 symbols at a time and this caps a request at 20,
 * because Yahoo's batch endpoint takes 20 and Workers limit subrequests.
 *
 * Market cap: symbols in the site's stock/ETF lists use the shared share-count
 * book (no extra request). Any other stock is looked up at Yahoo and kept in
 * the edge cache for a day. Nothing here writes to KV.
 */

import { mapPool } from '../_shared/cache';
import { cacheGet, cachePut, jsonResponse, type KvLike, type WaitUntil } from '../_shared/edgeCache';
import { inEquityUniverse, universeMarketCaps } from '../_shared/equityUniverse';
import { fetchQuotes, fetchTrailingMarketCap, wantsMarketCap, type Quote } from '../_shared/yahoo';

type Ctx = { request: Request; env?: { LAYOUTS?: KvLike }; waitUntil?: WaitUntil };

/** Shares outstanding for symbols outside the universe: symbol -> shares. */
async function lookupShares(symbol: string, price: number, waitUntil?: WaitUntil): Promise<number | null> {
  const key = `shares:${symbol}`;
  const hit = await cacheGet<{ shares: number | null }>(key);
  if (hit && Date.now() - hit.at < (hit.data.shares ? 86_400_000 : 3_600_000)) return hit.data.shares;
  const cap = await fetchTrailingMarketCap(symbol);
  const shares = cap && price > 0 ? cap.value / price : null;
  cachePut(key, { shares }, { keepSec: 7 * 86_400, waitUntil });
  return shares ?? hit?.data.shares ?? null;
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const url = new URL(context.request.url);
  const phase = url.searchParams.get('phase') === 'mcaps' ? 'mcaps' : 'quotes';
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 24)
    .slice(0, 20);

  if (!symbols.length) {
    return jsonResponse({ error: 'symbols query param required' }, { status: 400 });
  }

  const cacheKey = `quotes:${symbols.join(',')}`;
  let quotes: Quote[];
  const hit = await cacheGet<Quote[]>(cacheKey);
  let fromCache = false;
  if (hit && Date.now() - hit.at < 15_000) {
    quotes = hit.data;
    fromCache = true;
  } else {
    quotes = await fetchQuotes(symbols);
    const complete = quotes.every((q) => q.ok);
    if (complete) cachePut(cacheKey, quotes, { keepSec: 600, waitUntil: context.waitUntil });
    else if (hit && Date.now() - hit.at < 10 * 60_000) {
      // Fill rows Yahoo dropped this time from the last complete answer.
      quotes = quotes.map((q, i) => (q.ok ? q : (hit.data[i] ?? q)));
    }
  }

  const prices = new Map<string, number>();
  quotes.forEach((q, i) => {
    if (q.ok && q.price != null && wantsMarketCap(symbols[i]!)) prices.set(symbols[i]!, q.price);
  });
  const caps = await universeMarketCaps(
    context.env,
    new Map([...prices].filter(([s]) => inEquityUniverse(s))),
  );
  const others = [...prices].filter(([s]) => !inEquityUniverse(s)).slice(0, 12);
  if (others.length) {
    const rows = await mapPool(others, 6, async ([sym, price]) => {
      const shares = await lookupShares(sym, price, context.waitUntil);
      return [sym, shares != null ? shares * price : null] as const;
    });
    for (const [sym, cap] of rows) if (cap != null) caps.set(sym, cap);
  }

  const out = quotes.map((q, i) => ({
    ...q,
    requested: symbols[i],
    symbol: q.symbol || symbols[i],
    marketCap: caps.get(symbols[i]!) ?? null,
    ...(phase === 'mcaps' ? { ok: caps.has(symbols[i]!) } : {}),
  }));
  const anyFail = out.some((q) => !q.ok || q.price == null);
  return jsonResponse(
    { quotes: out, fetchedAt: new Date().toISOString(), phase },
    {
      cacheControl: anyFail ? 'public, max-age=5' : 'public, max-age=15',
      headers: { 'X-Cache': fromCache ? 'HIT' : 'MISS' },
    },
  );
}
