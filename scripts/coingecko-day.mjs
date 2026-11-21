#!/usr/bin/env node
/**
 * CoinGecko's side of "Yesterday's best buys": one UTC day's biggest coin gainers from CoinGecko's
 * full coin list, each measured close to close from CoinGecko's hourly prices.
 *
 * CoinGecko often refuses Cloudflare Functions (they reach it from shared addresses), so this runs
 * outside Cloudflare on a schedule, shortly after 00:00 UTC, and the file it writes is published on the
 * repo's `coin-data` branch (scripts/coingecko-publish.sh). functions/api/yesterday.ts reads it from
 * there and adds the coins Yahoo's list does not carry. Keyless public endpoints only.
 *
 *   node scripts/coingecko-day.mjs [YYYY-MM-DD] [out.json]
 *
 * 1. Every coin down to $250K market cap (about 18 pages of 250), with a week of hourly prices each.
 * 2. Each coin's change over the day from those prices, roughly (CoinGecko does not stamp them).
 * 3. The likeliest gainers measured exactly: price at 00:00 UTC on the day and on the next, market cap at
 *    the close, and the USD traded over the day (CoinGecko's 24h volume at the close), from the coin's
 *    hourly history.
 */
import { writeFile } from 'node:fs/promises';

const API = 'https://api.coingecko.com/api/v3';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'MarketCheckDash/1.0 (+https://marketcheck.money)' };
/** Coins measured exactly per day (one request each). */
const EXACT = Number(process.env.CG_EXACT || 160);
/** A price stamped further than this from 00:00 UTC is not taken as that moment's. */
const NEAR_S = 70 * 60;
const MIN_CAP_SCAN = 250_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const day = process.argv[2] || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const out = process.argv[3] || `coingecko-${day}.json`;
const t0 = Date.parse(`${day}T00:00:00Z`) / 1000;
const t1 = t0 + 86_400;
if (!Number.isFinite(t0)) throw new Error(`not a day: ${day}`);
if (Date.now() / 1000 < t1 + 300) throw new Error(`${day} has not ended yet (UTC)`);

async function get(path, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: HEADERS });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      console.error(`${path}: HTTP ${res.status}`);
    } catch (e) {
      console.error(`${path}: ${e.message}`);
    }
    await sleep(Math.min(90_000, 15_000 * (i + 1)));
  }
  throw new Error(`CoinGecko did not answer ${path}`);
}

// 1. The coin list.
const coins = new Map();
for (let page = 1; page <= 30; page++) {
  const list = await get(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=true`);
  if (!list?.length) break;
  for (const c of list) if (!coins.has(c.id)) coins.set(c.id, c);
  const caps = list.map((c) => c.market_cap || 0).sort((a, b) => a - b);
  console.error(`page ${page}: ${list.length} coins, median cap ${Math.round(caps[caps.length >> 1])}`);
  if (caps[caps.length >> 1] < MIN_CAP_SCAN) break;
  await sleep(6_500);
}

// 2. A rough change for each coin over the day, from its week of hourly prices (the last at last_updated).
const rough = [];
let compared = 0;
for (const c of coins.values()) {
  if ((c.market_cap || 0) >= 1_000_000) compared++;
  const p = c.sparkline_in_7d?.price;
  if (!p?.length || !(c.market_cap >= 500_000) || !(c.total_volume >= 25_000)) continue;
  const end = Date.parse(c.last_updated) / 1000;
  const at = (t) => p[Math.round(p.length - 1 - (end - t) / 3600)];
  const a = at(t0);
  const b = at(t1);
  if (a > 0 && b > 0) rough.push({ c, change: (b / a - 1) * 100 });
}
rough.sort((x, y) => y.change - x.change);

// 3. The likeliest gainers measured exactly.
const nearest = (arr, t) => {
  let best = null;
  for (const [ms, v] of arr ?? []) if (v != null && (!best || Math.abs(ms / 1000 - t) < Math.abs(best[0] / 1000 - t))) best = [ms, v];
  return best && Math.abs(best[0] / 1000 - t) <= NEAR_S ? best[1] : null;
};
const rows = [];
let missing = 0;
for (const { c } of rough.slice(0, EXACT)) {
  await sleep(5_000);
  const h = await get(`/coins/${encodeURIComponent(c.id)}/market_chart/range?vs_currency=usd&from=${t0 - 7200}&to=${t1 + 7200}`, 5).catch(() => null);
  const from = nearest(h?.prices, t0);
  const to = nearest(h?.prices, t1);
  if (!(from > 0 && to > 0)) {
    missing++;
    continue;
  }
  const change = (to / from - 1) * 100;
  rows.push({
    id: c.id,
    symbol: String(c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.image || null,
    from,
    to,
    change,
    marketCap: nearest(h.market_caps, t1) || 0,
    traded: nearest(h.total_volumes, t1) || 0,
  });
}
rows.sort((a, b) => b.change - a.change);
const file = { day, at: new Date().toISOString(), source: 'CoinGecko', scanned: coins.size, compared, measured: rows.length, missing, rows };
await writeFile(out, JSON.stringify(file));
console.error(`${day}: ${coins.size} coins scanned, ${compared} over $1M, ${rows.length} measured exactly (${missing} without history) -> ${out}`);
