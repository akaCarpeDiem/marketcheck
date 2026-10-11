/**
 * JSON data cache for Pages Functions.
 *
 * Layers, fastest first:
 *   1. memory  — per isolate, gone when the isolate is recycled
 *   2. Cache API (`caches.default`) — per Cloudflare location, no daily write limit
 *   3. KV (optional) — global "last good" copy, written rarely
 *
 * KV has a daily write quota on the free plan (1,000 puts). The same namespace
 * stores saved layouts and sign-in codes, so market data must never spend that
 * quota: data caches go to the Cache API, and KV only gets an occasional
 * last-good snapshot (`kvEveryMs`, hours apart) for cold starts during an
 * upstream outage.
 */

export type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
};

export type WaitUntil = (promise: Promise<unknown>) => void;

type Entry<T> = { data: T; at: number; kvAt?: number };

export type CachedResult<T> = {
  data: T;
  /** When the data was fetched from upstream (ms). */
  at: number;
  /** True when upstream failed and this is an older copy. */
  stale: boolean;
  from: 'memory' | 'edge' | 'live' | 'kv';
};

const mem = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<CachedResult<unknown>>>();
/** When upstream last failed, per key. Stops every request from retrying a dead upstream. */
const failedAt = new Map<string, number>();

function edge(): Cache | null {
  try {
    const store = caches as CacheStorage & { default?: Cache };
    return store.default ?? null;
  } catch {
    return null;
  }
}

function edgeRequest(key: string): Request {
  return new Request(`https://marketcheck.internal/data/${encodeURIComponent(key)}`);
}

async function readEdge<T>(key: string): Promise<Entry<T> | null> {
  const c = edge();
  if (!c) return null;
  try {
    const hit = await c.match(edgeRequest(key));
    if (!hit) return null;
    const entry = (await hit.json()) as Entry<T>;
    if (!entry || typeof entry.at !== 'number') return null;
    return entry;
  } catch {
    return null;
  }
}

function writeEdge<T>(key: string, entry: Entry<T>, keepSec: number): Promise<unknown> {
  const c = edge();
  if (!c) return Promise.resolve();
  const res = new Response(JSON.stringify(entry), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${Math.max(60, Math.round(keepSec))}`,
    },
  });
  return c.put(edgeRequest(key), res).catch(() => undefined);
}

/**
 * Write a snapshot to KV unless the copy already there is younger than
 * `everyMs`. Every Cloudflare location runs this code with its own cache, so
 * without the check each one would write its own copy and together they would
 * use up the daily write allowance. Reads are plentiful; writes are not.
 * Never throws: a failed write (allowance used up) must not break the request.
 */
export async function kvPutIfOlder(
  kv: KvLike,
  kvKey: string,
  value: string,
  everyMs: number,
  ttlSec: number,
  /** Reads the time (ms) out of the stored copy. Default: its `at` field. */
  stamp: (stored: unknown) => number | null = (s) =>
    typeof (s as { at?: unknown })?.at === 'number' ? (s as { at: number }).at : null,
): Promise<boolean> {
  try {
    const raw = await kv.get(kvKey);
    if (raw) {
      const at = stamp(JSON.parse(raw));
      if (at != null && Date.now() - at < everyMs) return false;
    }
  } catch {
    /* unreadable copy: replace it */
  }
  try {
    await kv.put(kvKey, value, { expirationTtl: ttlSec });
    return true;
  } catch {
    return false;
  }
}

async function readKv<T>(kv: KvLike | null | undefined, kvKey: string): Promise<Entry<T> | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(kvKey);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.at !== 'number') return null;
    return entry;
  } catch {
    return null;
  }
}

export type CachedOpts<T> = {
  /** Serve from cache without calling upstream while younger than this. */
  freshMs: number;
  /** How long a copy may be served as stale after upstream fails (seconds). Default 24h. */
  keepSec?: number;
  load: () => Promise<T>;
  /** Reject empty or broken upstream results so they are never cached. */
  valid?: (data: T) => boolean;
  waitUntil?: WaitUntil;
  kv?: KvLike | null;
  /** KV key for the global last-good copy. Omit to skip KV entirely. */
  kvKey?: string;
  /** Minimum gap between KV writes. Default 6h. */
  kvEveryMs?: number;
  /** After a failed upstream call, serve the stale copy for this long before retrying. Default 30s. */
  retryMs?: number;
};

/**
 * Read-through cache with stale fallback. Throws only when upstream fails and
 * no copy exists anywhere.
 */
export async function cached<T>(key: string, opts: CachedOpts<T>): Promise<CachedResult<T>> {
  const now = Date.now();
  const m = mem.get(key) as Entry<T> | undefined;
  if (m && now - m.at < opts.freshMs) {
    return { data: m.data, at: m.at, stale: false, from: 'memory' };
  }

  const running = inflight.get(key) as Promise<CachedResult<T>> | undefined;
  if (running) return running;

  const task = (async (): Promise<CachedResult<T>> => {
    const keepSec = opts.keepSec ?? 86_400;
    const e = await readEdge<T>(key);
    // The newest copy we hold, whichever layer it came from.
    const held: Entry<T> | null = e && (!m || e.at >= m.at) ? e : (m ?? null);
    if (held && Date.now() - held.at < opts.freshMs) {
      mem.set(key, held);
      return { data: held.data, at: held.at, stale: false, from: held === e ? 'edge' : 'memory' };
    }
    const lastFail = failedAt.get(key);
    if (held && lastFail && Date.now() - lastFail < (opts.retryMs ?? 30_000)) {
      return { data: held.data, at: held.at, stale: true, from: held === e ? 'edge' : 'memory' };
    }

    try {
      const data = await opts.load();
      if (opts.valid && !opts.valid(data)) throw new Error('upstream returned no usable data');
      const at = Date.now();
      const entry: Entry<T> = { data, at, kvAt: held?.kvAt };
      const jobs: Promise<unknown>[] = [];
      if (opts.kv && opts.kvKey) {
        const every = opts.kvEveryMs ?? 6 * 3_600_000;
        if (!entry.kvAt || at - entry.kvAt >= every) {
          entry.kvAt = at;
          jobs.push(kvPutIfOlder(opts.kv, opts.kvKey, JSON.stringify({ data, at }), every, 7 * 86_400));
        }
      }
      mem.set(key, entry);
      failedAt.delete(key);
      jobs.push(writeEdge(key, entry, keepSec));
      const all = Promise.all(jobs);
      if (opts.waitUntil) opts.waitUntil(all);
      else await all;
      return { data, at, stale: false, from: 'live' };
    } catch (err) {
      failedAt.set(key, Date.now());
      const maxAge = keepSec * 1000;
      if (held && Date.now() - held.at < maxAge) {
        return { data: held.data, at: held.at, stale: true, from: held === e ? 'edge' : 'memory' };
      }
      if (opts.kv && opts.kvKey) {
        const k = await readKv<T>(opts.kv, opts.kvKey);
        if (k && Date.now() - k.at < 7 * 86_400_000) {
          mem.set(key, { ...k, kvAt: k.at });
          return { data: k.data, at: k.at, stale: true, from: 'kv' };
        }
      }
      throw err instanceof Error ? err : new Error('upstream failed');
    }
  })();

  inflight.set(key, task as Promise<CachedResult<unknown>>);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/** Plain get/put on the same layers, for values that are updated piecemeal. */
export async function cacheGet<T>(key: string): Promise<{ data: T; at: number } | null> {
  const m = mem.get(key) as Entry<T> | undefined;
  const e = await readEdge<T>(key);
  const held = e && (!m || e.at >= m.at) ? e : (m ?? null);
  if (!held) return null;
  mem.set(key, held);
  return { data: held.data, at: held.at };
}

export function cachePut<T>(
  key: string,
  data: T,
  opts?: { keepSec?: number; waitUntil?: WaitUntil },
): void {
  const entry: Entry<T> = { data, at: Date.now() };
  mem.set(key, entry);
  const job = writeEdge(key, entry, opts?.keepSec ?? 86_400);
  if (opts?.waitUntil) opts.waitUntil(job);
  else void job;
}

export function jsonResponse(
  body: unknown,
  opts?: { status?: number; cacheControl?: string; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: opts?.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': opts?.cacheControl ?? 'no-store',
      ...(opts?.headers ?? {}),
    },
  });
}
