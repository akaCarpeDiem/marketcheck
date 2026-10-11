/**
 * GET /api/chart?symbol=BTC-USD&range=1y&interval=1d
 * A price series for one symbol from Yahoo Finance, plus the quote details
 * Yahoo returns with it (previous close, day range, 52-week range, volume).
 */

import { cacheGet, cachePut, jsonResponse, type WaitUntil } from '../_shared/edgeCache';
import { fetchChart, type Series } from '../_shared/yahoo';

const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'ytd', 'max']);
const INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '1h', '1d', '1wk', '1mo']);

/** How long a series stays fresh, by bar size. */
function freshMs(interval: string): number {
  if (interval === '1d' || interval === '1wk' || interval === '1mo') return 10 * 60_000;
  return 60_000;
}

export async function onRequestGet(context: { request: Request; waitUntil?: WaitUntil }): Promise<Response> {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim();
  const range = (url.searchParams.get('range') ?? '1y').trim();
  const interval = (url.searchParams.get('interval') ?? '1d').trim();
  if (!symbol || symbol.length > 24) {
    return jsonResponse({ error: 'symbol query param required' }, { status: 400 });
  }
  if (!RANGES.has(range) || !INTERVALS.has(interval)) {
    return jsonResponse({ error: 'invalid range or interval' }, { status: 400 });
  }

  const key = `chart:${symbol}:${range}:${interval}`;
  const hit = await cacheGet<Series>(key);
  let series: Series | null = hit && Date.now() - hit.at < freshMs(interval) ? hit.data : null;
  let stale = false;
  if (!series) {
    series = await fetchChart(symbol, range, interval);
    if (series && series.c.length > 1) {
      cachePut(key, series, { keepSec: 86_400, waitUntil: context.waitUntil });
    } else if (hit) {
      series = hit.data;
      stale = true;
    }
  }

  const ok = !!series && series.c.length > 1;
  return jsonResponse(
    {
      symbol,
      range,
      interval,
      closes: series?.c ?? [],
      timestamps: series?.t ?? [],
      volumes: series?.v ?? [],
      meta: series
        ? {
            symbol: series.symbol,
            name: series.name ?? null,
            currency: series.currency ?? null,
            exchange: series.exchange ?? null,
            type: series.type ?? null,
            price: series.price,
            prevClose: series.prevClose,
            changePercent: series.changePercent,
            time: series.time,
            dayHigh: series.dayHigh ?? null,
            dayLow: series.dayLow ?? null,
            volume: series.volume ?? null,
            high52: series.high52 ?? null,
            low52: series.low52 ?? null,
          }
        : null,
      ok,
      stale,
      ...(ok ? {} : { error: 'No chart data for this symbol' }),
      fetchedAt: new Date().toISOString(),
    },
    { cacheControl: ok && !stale ? 'public, max-age=60' : 'public, max-age=10' },
  );
}
