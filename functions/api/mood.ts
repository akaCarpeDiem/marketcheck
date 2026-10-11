/**
 * GET /api/mood — the Crypto Fear & Greed Index from alternative.me (0 = extreme
 * fear, 100 = extreme greed), with yesterday, a week ago and a month ago.
 * Published once a day; cached here for 30 minutes.
 */

import { cached, jsonResponse, type WaitUntil } from '../_shared/edgeCache';

type Reading = { value: number; label: string; at: number };
type Mood = { now: Reading; yesterday: Reading | null; week: Reading | null; month: Reading | null };

async function load(): Promise<Mood> {
  const res = await fetch('https://api.alternative.me/fng/?limit=31&format=json', {
    headers: { Accept: 'application/json', 'User-Agent': 'MarketCheckDash/1.0 (+https://marketcheck.money)' },
  });
  if (!res.ok) throw new Error(`alternative.me HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ value?: string; value_classification?: string; timestamp?: string }>;
  };
  const rows: Reading[] = [];
  for (const d of json.data ?? []) {
    const value = Number(d.value);
    const at = Number(d.timestamp) * 1000;
    if (!Number.isFinite(value) || value < 0 || value > 100 || !Number.isFinite(at)) continue;
    rows.push({ value, label: d.value_classification || '', at });
  }
  if (!rows.length) throw new Error('alternative.me sent no readings');
  return { now: rows[0]!, yesterday: rows[1] ?? null, week: rows[7] ?? null, month: rows[30] ?? null };
}

export async function onRequestGet(context: { request: Request; waitUntil?: WaitUntil }): Promise<Response> {
  try {
    const hit = await cached<Mood>('mood:v1', {
      freshMs: 30 * 60_000,
      keepSec: 3 * 86_400,
      load,
      waitUntil: context.waitUntil,
      retryMs: 5 * 60_000,
    });
    return jsonResponse(
      { ok: true, ...hit.data, stale: hit.stale, source: 'alternative.me', fetchedAt: new Date(hit.at).toISOString() },
      { cacheControl: 'public, max-age=600' },
    );
  } catch (e) {
    return jsonResponse(
      { ok: false, error: e instanceof Error ? e.message : 'fetch failed' },
      { cacheControl: 'public, max-age=120' },
    );
  }
}
