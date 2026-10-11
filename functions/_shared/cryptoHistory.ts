/**
 * 4-hour and 8-hour changes for coins.
 *
 * CoinGecko publishes changes over 1h, 24h, 7d, 30d and 1y, but nothing in
 * between, and no free source has 4h or 8h for the whole list. So the site
 * keeps its own record: once an hour it stores the price of every coin in the
 * list (one small KV entry, 24 writes a day in total), and a change over 4 or
 * 8 hours is today's price against the recorded price that long ago. Both
 * ends come from the same source, so these figures agree with the others.
 *
 * Consequences worth knowing:
 * - After the record starts (first deploy, or after a gap), 4h figures appear
 *   once four hours of history exist, and 8h figures after eight.
 * - The price "4 hours ago" is read between the two hourly records around that
 *   moment. If there is no record close enough, the figure is left empty
 *   instead of being measured over the wrong window.
 */
import { cacheGet, cachePut, type KvLike, type WaitUntil } from './edgeCache';

const HOUR = 3_600_000;
const KEY = (bucket: number): string => `snap:crypto:v1:${bucket}`;
/** Records are needed for 8 hours; kept a little longer. */
const KEEP_SEC = 11 * 3600;
/** Two records further apart than this are not joined: something was missed in between. */
const MAX_GAP_MS = 2.5 * HOUR;
/** A single record this close to the wanted moment may stand in for it. */
const NEAR_MS = 12 * 60_000;

export type Snapshot = { at: number; p: Record<string, number> };
export type IntradayTf = '4h' | '8h';
export const INTRADAY_MS: Record<IntradayTf, number> = { '4h': 4 * HOUR, '8h': 8 * HOUR };

const mem = new Map<number, { snap: Snapshot | null; checkedAt: number }>();
const written = new Set<number>();

function isSnapshot(v: unknown): v is Snapshot {
  const s = v as Snapshot | null;
  return !!s && typeof s.at === 'number' && !!s.p && typeof s.p === 'object';
}

/** Store this hour's prices unless some location already has. Never throws. */
export async function recordSnapshot(
  kv: KvLike,
  prices: Array<{ id: string; price: number | null }>,
  at: number,
): Promise<boolean> {
  const bucket = Math.floor(at / HOUR);
  if (written.has(bucket)) return false;
  written.add(bucket);
  if (written.size > 48) for (const b of written) if (b < bucket - 24) written.delete(b);
  try {
    if (await kv.get(KEY(bucket))) return false;
  } catch {
    /* unreadable: try to write anyway */
  }
  const p: Record<string, number> = {};
  for (const c of prices) {
    if (c.price != null && c.price > 0) p[c.id] = Number(c.price.toPrecision(7));
  }
  if (Object.keys(p).length < 50) {
    written.delete(bucket);
    return false;
  }
  const snap: Snapshot = { at, p };
  try {
    await kv.put(KEY(bucket), JSON.stringify(snap), { expirationTtl: KEEP_SEC });
    mem.set(bucket, { snap, checkedAt: at });
    return true;
  } catch {
    // For example the daily write allowance is used up. Try again later in the hour.
    written.delete(bucket);
    return false;
  }
}

async function readSnapshot(kv: KvLike, bucket: number, now: number, waitUntil?: WaitUntil): Promise<Snapshot | null> {
  const m = mem.get(bucket);
  if (m?.snap) return m.snap;
  // A missing record for the hour still running may yet be written; an older one will not appear.
  const recheckMs = bucket >= Math.floor(now / HOUR) - 1 ? 2 * 60_000 : 20 * 60_000;
  if (m && now - m.checkedAt < recheckMs) return null;
  const edge = await cacheGet<Snapshot>(`snap:${bucket}`);
  if (edge && isSnapshot(edge.data)) {
    mem.set(bucket, { snap: edge.data, checkedAt: now });
    return edge.data;
  }
  let snap: Snapshot | null = null;
  try {
    const raw = await kv.get(KEY(bucket));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (isSnapshot(parsed)) snap = parsed;
    }
  } catch {
    snap = null;
  }
  mem.set(bucket, { snap, checkedAt: now });
  if (mem.size > 64) for (const b of mem.keys()) if (b < bucket - 24) mem.delete(b);
  if (snap) cachePut(`snap:${bucket}`, snap, { keepSec: KEEP_SEC, waitUntil });
  return snap;
}

/** The recorded price of each coin at moment `t`, read between the records around it. */
export function pricesAt(snaps: Snapshot[], t: number): Map<string, number> {
  const out = new Map<string, number>();
  let before: Snapshot | null = null;
  let after: Snapshot | null = null;
  for (const s of snaps) {
    if (s.at <= t && (!before || s.at > before.at)) before = s;
    if (s.at >= t && (!after || s.at < after.at)) after = s;
  }
  if (before && after && after.at - before.at <= MAX_GAP_MS) {
    const span = after.at - before.at;
    const w = span > 0 ? (t - before.at) / span : 0;
    for (const id of Object.keys(before.p)) {
      const a = before.p[id]!;
      const b = after.p[id];
      if (b == null || !(a > 0) || !(b > 0)) continue;
      out.set(id, a + (b - a) * w);
    }
    return out;
  }
  const near = [before, after].filter((s): s is Snapshot => !!s && Math.abs(s.at - t) <= NEAR_MS)[0];
  if (near) for (const id of Object.keys(near.p)) if (near.p[id]! > 0) out.set(id, near.p[id]!);
  return out;
}

/** Fill in `ch['4h']` and `ch['8h']` on each coin from the record. Missing history leaves them null. */
export async function attachIntraday(
  coins: Array<{ id: string; price: number | null; ch: Record<string, number | null | undefined> }>,
  kv: KvLike | null | undefined,
  now: number,
  waitUntil?: WaitUntil,
): Promise<void> {
  for (const tf of Object.keys(INTRADAY_MS) as IntradayTf[]) {
    let then = new Map<string, number>();
    if (kv) {
      const t = now - INTRADAY_MS[tf];
      const b = Math.floor(t / HOUR);
      const snaps = (await Promise.all([b - 1, b, b + 1].map((x) => readSnapshot(kv, x, now, waitUntil)))).filter(
        (s): s is Snapshot => !!s,
      );
      then = pricesAt(snaps, t);
    }
    for (const c of coins) {
      const was = then.get(c.id);
      c.ch[tf] = was != null && c.price != null && c.price > 0 ? ((c.price - was) / was) * 100 : null;
    }
  }
}

/** For tests: forget what this isolate remembers. */
export function resetHistoryMemory(): void {
  mem.clear();
  written.clear();
}
