/**
 * GET /api/sparklines?symbols=BND,VNQ,CPER,COPX[&range=1y|3mo|1mo]
 * A thinned close series per symbol for small charts: one Yahoo request for up
 * to 20 symbols. Default is one year of daily closes, 72 points. Each row also
 * carries the change over seven days, measured the same way as the stock tables:
 * the latest close against the close on or before the day a week earlier.
 */

import { mapPool } from '../_shared/cache';
import { cacheGet, cachePut, jsonResponse, type WaitUntil } from '../_shared/edgeCache';
import { downsample, fetchChart, fetchSpark } from '../_shared/yahoo';

type Row = { symbol: string; closes: number[]; ok: boolean; week: number | null };

function weekChange(t: number[], c: number[]): number | null {
  const n = Math.min(t.length, c.length);
  if (n < 2) return null;
  const last = c[n - 1]!;
  const limit = t[n - 1]! - 7 * 86_400 + 3600;
  for (let i = n - 2; i >= 0; i--) {
    if (t[i]! <= limit) {
      const base = c[i]!;
      return base > 0 && last > 0 ? ((last - base) / base) * 100 : null;
    }
  }
  return null;
}
const RANGES = new Set(['1mo', '3mo', '1y']);

export async function onRequestGet(context: { request: Request; waitUntil?: WaitUntil }): Promise<Response> {
  const url = new URL(context.request.url);
  const range = RANGES.has(url.searchParams.get('range') ?? '') ? url.searchParams.get('range')! : '1y';
  const symbols = (url.searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 24)
    .slice(0, 20);
  if (!symbols.length) {
    return jsonResponse({ error: 'symbols query param required' }, { status: 400 });
  }

  const key = `spark2:${range}:${symbols.join(',')}`;
  const hit = await cacheGet<Row[]>(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) {
    return jsonResponse(
      { series: hit.data, fetchedAt: new Date(hit.at).toISOString() },
      { cacheControl: 'public, max-age=300', headers: { 'X-Cache': 'HIT' } },
    );
  }

  const batch = await fetchSpark(symbols, range, '1d');
  const missing = symbols.filter((s) => (batch.get(s)?.c.length ?? 0) < 2);
  const extra = new Map<string, { t: number[]; c: number[] }>();
  if (missing.length) {
    const rows = await mapPool(missing, 4, async (s) => [s, await fetchChart(s, range, '1d')] as const);
    for (const [s, chart] of rows) if (chart) extra.set(s, { t: chart.t, c: chart.c });
  }
  const series: Row[] = symbols.map((s) => {
    const got = batch.get(s);
    const full = got && got.c.length > 1 ? { t: got.t, c: got.c } : (extra.get(s) ?? { t: [], c: [] });
    const closes = downsample(full.c, 72);
    return { symbol: s, closes, ok: closes.length > 1, week: weekChange(full.t, full.c) };
  });
  const complete = series.every((r) => r.ok);
  if (complete) cachePut(key, series, { keepSec: 86_400, waitUntil: context.waitUntil });
  else if (hit) {
    return jsonResponse(
      { series: series.map((r, i) => (r.ok ? r : (hit.data[i] ?? r))), fetchedAt: new Date().toISOString() },
      { cacheControl: 'public, max-age=30' },
    );
  }
  return jsonResponse(
    { series, fetchedAt: new Date().toISOString() },
    { cacheControl: complete ? 'public, max-age=300' : 'public, max-age=15', headers: { 'X-Cache': 'MISS' } },
  );
}
