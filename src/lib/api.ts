/** fetch with a time limit and JSON parsing. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

function signalFor(ms: number, outer?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  const onAbort = () => ctl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) onAbort();
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctl.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

export type GetOpts = { timeout?: number; signal?: AbortSignal };

/**
 * Read-only endpoints that /api/batch can answer. Calls to them made within a few milliseconds of each other
 * (a page load, refresh timers that fall due together) travel as one request: one Function call instead of
 * one each. Each caller still gets exactly the body (or the HTTP error) the endpoint itself returns, as soon
 * as its own part is ready, and keeps its own time limit.
 */
const BATCHABLE = /^\/api\/(?:bootstrap|cryptos|equities|markets|sparklines|mood|headlines|game\/board)(?:\?|$)/;
const BATCH_WINDOW_MS = 25;
const BATCH_MAX = 16;

type Waiting = { url: string; resolve: (v: unknown) => void; reject: (e: unknown) => void; settled: boolean; timer: ReturnType<typeof setTimeout> };
let waiting: Waiting[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
/** Set when this deployment has no /api/batch (for example a tab opened before a rollback): ask one by one. */
let batchOff = false;

export function getJson<T>(url: string, opts: GetOpts = {}): Promise<T> {
  if (batchOff || opts.signal || !BATCHABLE.test(url) || typeof ReadableStream === 'undefined' || typeof TextDecoder === 'undefined') return getOne<T>(url, opts);
  return new Promise<T>((resolve, reject) => {
    const w: Waiting = { url, resolve: resolve as (v: unknown) => void, reject, settled: false, timer: 0 as unknown as ReturnType<typeof setTimeout> };
    w.timer = setTimeout(() => settle(w, undefined, new DOMException('Timed out', 'TimeoutError')), opts.timeout ?? 15_000);
    waiting.push(w);
    flushTimer ??= setTimeout(flush, BATCH_WINDOW_MS);
  });
}

function settle(w: Waiting, value: unknown, error?: unknown): void {
  if (w.settled) return;
  w.settled = true;
  clearTimeout(w.timer);
  if (error !== undefined) w.reject(error);
  else w.resolve(value);
}

/** The time left is not tracked per caller after a fallback; their own timers still apply. */
function alone(w: Waiting): void {
  if (w.settled) return;
  getOne(w.url, { timeout: 60_000 }).then(
    (v) => settle(w, v),
    (e) => settle(w, undefined, e),
  );
}

function flush(): void {
  flushTimer = undefined;
  const all = waiting;
  waiting = [];
  for (let i = 0; i < all.length; i += BATCH_MAX) void send(all.slice(i, i + BATCH_MAX));
}

async function send(group: Waiting[]): Promise<void> {
  if (group.length === 1 || batchOff) {
    group.forEach(alone);
    return;
  }
  const answered = new Set<number>();
  try {
    const res = await fetch('/api/batch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ r: group.map((w) => w.url) }),
    });
    if (res.status === 404 || res.status === 405) batchOff = true;
    if (!res.ok || !res.body) throw new Error(`batch HTTP ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const take = (line: string) => {
      if (!line.trim()) return;
      const p = JSON.parse(line) as { i: number; s: number; b: unknown };
      const w = group[p.i];
      if (!w) return;
      answered.add(p.i);
      if (p.s >= 200 && p.s < 300) settle(w, p.b);
      else settle(w, undefined, new ApiError(`HTTP ${p.s}`, p.s));
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        take(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      if (done) break;
      if (group.every((w) => w.settled)) {
        void reader.cancel().catch(() => undefined);
        break;
      }
    }
    take(buf);
  } catch {
    /* fall through: anything not answered is asked on its own, as before batching */
  }
  group.forEach((w, i) => {
    if (!answered.has(i)) alone(w);
  });
}

async function getOne<T>(url: string, opts: GetOpts = {}): Promise<T> {
  const { signal, done } = signalFor(opts.timeout ?? 15_000, opts.signal);
  try {
    const res = await fetch(url, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as T;
  } finally {
    done();
  }
}

export async function sendJson<T>(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
  opts: GetOpts = {},
): Promise<T> {
  const { signal, done } = signalFor(opts.timeout ?? 15_000, opts.signal);
  try {
    const res = await fetch(url, {
      method,
      signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* no body */
    }
    if (!res.ok) {
      const code = (data as { error?: string } | null)?.error;
      throw new ApiError(code || `HTTP ${res.status}`, res.status, data);
    }
    return data as T;
  } finally {
    done();
  }
}
