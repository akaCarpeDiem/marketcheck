/**
 * Cloudflare Pages Function — Yahoo Finance chart series for sparklines / lookbacks.
 * GET /api/chart?symbol=BTC-USD&range=1y&interval=1d
 * Returns { symbol, closes, timestamps?, fetchedAt }. No API keys.
 */

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';

const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'ytd', 'max']);
const ALLOWED_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '1h', '1d', '1wk', '1mo']);

const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchYahooChart(
  symbol: string,
  range: string,
  interval: string,
): Promise<{ closes: number[]; timestamps: number[]; error?: string }> {
  const yahooUrl = `${YAHOO_CHART}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  let lastErr = 'fetch failed';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(yahooUrl, { headers: UA });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        if (
          (res.status === 404 || res.status === 429 || res.status === 502 || res.status === 503) &&
          attempt < 2
        ) {
          await sleep(140 + attempt * 200);
          continue;
        }
        return { closes: [], timestamps: [], error: lastErr };
      }
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
          error?: unknown;
        };
      };
      const result = json.chart?.result?.[0];
      if (!result) {
        lastErr = 'No chart result';
        if (attempt < 2) {
          await sleep(140 + attempt * 200);
          continue;
        }
        return { closes: [], timestamps: [], error: lastErr };
      }
      const timestampsRaw = result.timestamp ?? [];
      const raw = result.indicators?.quote?.[0]?.close ?? [];
      const closes: number[] = [];
      const timestamps: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c != null && Number.isFinite(c)) {
          closes.push(c);
          if (timestampsRaw[i] != null) timestamps.push(timestampsRaw[i]!);
        }
      }
      if (closes.length <= 1 && attempt < 2) {
        lastErr = 'Sparse series';
        await sleep(140 + attempt * 200);
        continue;
      }
      return { closes, timestamps };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'fetch failed';
      if (attempt < 2) await sleep(140 + attempt * 200);
    }
  }
  return { closes: [], timestamps: [], error: lastErr };
}

export async function onRequestGet(context: { request: Request }): Promise<Response> {
  const url = new URL(context.request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim();
  const range = (url.searchParams.get('range') ?? '1y').trim();
  const interval = (url.searchParams.get('interval') ?? '1d').trim();

  if (!symbol) {
    return new Response(JSON.stringify({ error: 'symbol query param required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!ALLOWED_RANGES.has(range) || !ALLOWED_INTERVALS.has(interval)) {
    return new Response(JSON.stringify({ error: 'invalid range or interval' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { closes, timestamps, error } = await fetchYahooChart(symbol, range, interval);
  const ok = closes.length > 1;

  return new Response(
    JSON.stringify({
      symbol,
      range,
      interval,
      closes,
      timestamps,
      ok,
      ...(error && !ok ? { error } : {}),
      fetchedAt: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Avoid CDN caching empty/error sparkline payloads for long.
        'Cache-Control': ok
          ? 'public, max-age=60, s-maxage=120'
          : 'public, max-age=10, s-maxage=15',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
