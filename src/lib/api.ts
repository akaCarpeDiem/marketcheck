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

export async function getJson<T>(url: string, opts: GetOpts = {}): Promise<T> {
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
